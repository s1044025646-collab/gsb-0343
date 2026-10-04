import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { decode, encode, flip, SecdedError } from "../src/secded";
import { Store } from "../src/db";

const allData = Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, "0"));
const combos2: number[][] = [];
for (let a = 1; a <= 8; a++) for (let b = a + 1; b <= 8; b++) combos2.push([a, b]);

test("手工核算样例: 1011 -> 01100110", () => {
  assert.equal(encode("1011"), "01100110");
  assert.equal(encode("0000"), "00000000");
  assert.equal(encode("1111"), "11111111");
});

test("16 种数据无错往返", () => {
  for (const d of allData) {
    const r = decode(encode(d));
    assert.equal(r.decision, "NO_ERROR");
    assert.equal(r.data, d);
    assert.equal(r.syndrome, 0);
    assert.ok(r.overallParityOk);
  }
});

test("每种码字的全部 8 个单翻转均可纠正并恢复原码字", () => {
  for (const d of allData) {
    const cw = encode(d);
    for (let p = 1; p <= 8; p++) {
      const r = decode(flip(cw, [p]));
      assert.equal(r.corrected, cw, `data=${d} pos=${p}`);
      assert.equal(r.data, d);
      assert.equal(r.correctedPosition, p);
      assert.ok(!r.overallParityOk);
    }
  }
});

test("每种码字的全部 28 个双翻转必须拒绝可信输出", () => {
  for (const d of allData) {
    const cw = encode(d);
    for (const pair of combos2) {
      const r = decode(flip(cw, pair));
      assert.equal(r.decision, "DOUBLE_ERROR_DETECTED", `data=${d} pair=${pair}`);
      assert.equal(r.data, null);
      assert.equal(r.corrected, null);
    }
  }
});

test("三位错误反例: 超出保证，可能误判（不自动识别）", () => {
  const cw = encode("1011"); // 01101010
  const r = decode(flip(cw, [1, 2, 3])); // 综合征0 + 整体奇 -> 误判为位置8
  assert.equal(r.decision, "CORRECTED_OVERALL_PARITY");
  assert.notEqual(r.data, "1011");
});

test("输入校验: 长度/非法字符/前导零/重复位置/批量上限", () => {
  assert.throws(() => encode("101"), SecdedError);
  assert.throws(() => encode("10a1"), /0\/1/);
  assert.throws(() => decode("0110101"), SecdedError);
  assert.throws(() => decode("0110101x"), SecdedError);
  assert.equal(encode("0001"), "11010010"); // 前导零保留
  assert.throws(() => flip("01101010", [3, 3]), /重复/);
  assert.throws(() => flip("01101010", [0]), SecdedError);
  assert.throws(() => flip("01101010", [9]), SecdedError);
  assert.throws(() => flip("01101010", []), SecdedError);
  assert.throws(() => decode("01101010", "v0"), /规则版本/);
});

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "secded-")), "t.db");
}

test("实验: 注入解码原子写入，重复注入被拒绝，重启读取一致", () => {
  const db = tmpDb();
  const s1 = new Store(db);
  const { id, codeword } = s1.createExperiment("1011");
  const { received, report } = s1.injectAndDecode(id, [6]);
  assert.equal(received, flip(codeword, [6]));
  assert.equal(report.data, "1011");
  assert.throws(() => s1.injectAndDecode(id, [1]), (e: any) => e.code === "ALREADY_DECODED");
  const before = s1.getExperiment(id);
  s1.close();
  const s2 = new Store(db); // 模拟重启
  const after = s2.getExperiment(id);
  assert.equal(after.received, before.received);
  const r2 = decode(after.received!);
  assert.equal(r2.decision, "CORRECTED_DATA_OR_PARITY");
  assert.equal(r2.correctedPosition, 6);
  s2.close();
});

test("独立核验外部码字无需登记原文，报告入库", () => {
  const s = new Store(tmpDb());
  const r = s.verifyStandalone("01101110"); // 1011 码字位置6翻转
  assert.equal(r.decision, "CORRECTED_DATA_OR_PARITY");
  assert.equal(r.data, "1011");
  assert.equal(s.listStandaloneReports().length, 1);
  s.close();
});

test("统计在解码后对照原数据，但不进入判断路径", () => {
  const s = new Store(tmpDb());
  const { id } = s.createExperiment("0101");
  s.injectAndDecode(id, [1, 2]);
  const exp = s.getExperiment(id);
  const stats = JSON.parse(exp.stats!);
  assert.equal(stats.dataRecovered, false);
  assert.equal(stats.errorCount, 2);
  s.close();
});
