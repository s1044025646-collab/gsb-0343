import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { encode, decode, flipBits, RULE_VERSION, SecdedError } from "../src/secded.js";
import { Store } from "../src/store.js";
import { Service } from "../src/service.js";

const allData = Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, "0"));
const pairs: number[][] = [];
for (let a = 1; a <= 8; a++) for (let b = a + 1; b <= 8; b++) pairs.push([a, b]);

test("手工样例：1011 -> 01100110", () => {
  assert.equal(encode("1011"), "01100110");
});

test("16 种数据无错往返", () => {
  for (const d of allData) {
    const code = encode(d);
    const r = decode(code, RULE_VERSION);
    assert.equal(r.verdict, "no_error", d);
    assert.equal(r.data, d);
  }
});

test("每种码字全部 8 个单翻转均可恢复原码字", () => {
  for (const d of allData) {
    const code = encode(d);
    for (let p = 1; p <= 8; p++) {
      const r = decode(flipBits(code, [p]), RULE_VERSION);
      assert.equal(r.verdict, "corrected", `${d} pos ${p}`);
      assert.equal(r.correctedPosition, p);
      assert.equal(r.correctedCode, code);
      assert.equal(r.data, d);
      assert.equal(r.recheckOk, true);
    }
  }
});

test("每种码字全部 28 个双翻转均拒绝可信输出", () => {
  assert.equal(pairs.length, 28);
  for (const d of allData) {
    const code = encode(d);
    for (const [a, b] of pairs) {
      const r = decode(flipBits(code, [a, b]), RULE_VERSION);
      assert.equal(r.verdict, "double_error", `${d} [${a},${b}]`);
      assert.equal(r.data, null);
      assert.equal(r.correctedCode, null);
    }
  }
});

test("三位错误反例：可能误判（不保证识别）", () => {
  const code = encode("1011");
  const r = decode(flipBits(code, [1, 2, 3]), RULE_VERSION);
  // 该样例被误判为位置8单错，输出错误数据——仅用于说明超出保证范围
  assert.equal(r.verdict, "corrected");
  assert.equal(r.correctedPosition, 8);
  assert.notEqual(r.data, "1011");
});

test("输入校验：非法长度/字符/前导零", () => {
  assert.throws(() => encode("101"), SecdedError);
  assert.throws(() => encode("10a1"), SecdedError);
  assert.throws(() => decode("0110011", RULE_VERSION), SecdedError);
  assert.throws(() => decode("011001100", RULE_VERSION), SecdedError);
  const z = encode("0001");
  assert.equal(z.length, 8);
  assert.equal(decode(z, RULE_VERSION).data, "0001", "前导零保留");
  assert.throws(() => decode(encode("0000"), "wrong-version"), SecdedError);
});

test("翻转位置校验：范围与重复", () => {
  assert.throws(() => flipBits("01100110", [0]), SecdedError);
  assert.throws(() => flipBits("01100110", [9]), SecdedError);
  assert.throws(() => flipBits("01100110", [3, 3]), (e: any) => e.code === "ERR_DUPLICATE_POSITION");
  assert.throws(() => flipBits("01100110", []), SecdedError);
});

function tmpService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secded-"));
  const store = new Store(path.join(dir, "t.sqlite"));
  return { store, service: new Service(store), dir };
}

test("实验流程：编码与接收分开保存，纠正不改写证据", () => {
  const { service, store } = tmpService();
  const { id, encoded } = service.createExperiment("1011");
  service.flip(id, [6]);
  const r = service.decodeExperiment(id);
  assert.equal(r.report.data, "1011");
  assert.equal(r.match, true);
  const row = store.getExperiment(id)!;
  assert.equal(row.encoded, encoded);
  assert.equal(row.received, flipBits(encoded, [6]));
  assert.equal(row.status, "decoded");
  store.close();
});

test("事务：重复解码拒绝且不覆盖已有记录", () => {
  const { service, store } = tmpService();
  const { id } = service.createExperiment("1011");
  service.flip(id, [6]);
  const first = service.decodeExperiment(id);
  assert.throws(() => service.decodeExperiment(id), (e: any) => e.code === "ERR_ALREADY_DECODED");
  const row = store.getExperiment(id)!;
  assert.deepEqual(JSON.parse(row.report!), first.report);
  store.close();
});

test("事务回滚：recordDecode 失败不留下部分写入", () => {
  const { service, store } = tmpService();
  const { id } = service.createExperiment("1011");
  service.flip(id, [6]);
  // 人为制造已解码状态后尝试写入 -> 抛错且事务回滚，原记录不变
  store.db.prepare("UPDATE experiments SET status='decoded', report='{\"sentinel\":1}' WHERE id=?").run(id);
  assert.throws(() => store.recordDecode(id, decode(flipBits(encode("1011"), [6]), RULE_VERSION), true));
  const row = store.getExperiment(id)!;
  assert.equal(row.report, '{"sentinel":1}');
  store.close();
});

test("独立核验：外部码字无需登记原文", () => {
  const { service, store } = tmpService();
  const { id, report } = service.check("01100111"); // 手工构造：位置8翻转
  assert.equal(report.verdict, "corrected");
  assert.equal(report.correctedPosition, 8);
  assert.equal(report.data, "1011");
  assert.ok(id > 0);
  store.close();
});

test("重启后按保存的接收码字得到相同判断", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secded-"));
  const dbPath = path.join(dir, "t.sqlite");
  const s1 = new Service(new Store(dbPath));
  const { id } = s1.createExperiment("1011");
  s1.flip(id, [2, 5]);
  const before = s1.decodeExperiment(id).report;
  s1.store.close();
  // 模拟重启
  const s2 = new Service(new Store(dbPath));
  const row = s2.getExperiment(id);
  const again = decode(row.received!, RULE_VERSION);
  assert.deepEqual(again, before);
  assert.equal(again.verdict, "double_error");
  s2.store.close();
});
