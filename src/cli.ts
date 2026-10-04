import * as path from "node:path";
import { Store } from "./db";
import { DecodeReport, encode, decode, flip, layout, PARITY_GROUPS } from "./secded";

const DATA_DIR = process.env.SECDED_DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(DATA_DIR, "secded.db"));

function showWord(word: string): string {
  return word.split("").map((b, i) => `${i + 1}:${b}`).join(" ");
}

function showReport(r: DecodeReport): void {
  console.log(`  接收码字: ${r.received}  (${showWord(r.received)})`);
  for (const c of r.checks) {
    console.log(`  校验组 p${c.bit} 覆盖位置 [${c.positions.join(",")}] 位=${c.bits} XOR=${c.xor}`);
  }
  console.log(`  综合征 S = ${r.syndrome}，整体奇偶: ${r.overallParityOk ? "通过(偶)" : "失败(奇)"}`);
  console.log(`  判定: ${r.decision}`);
  if (r.correctedPosition !== null) {
    console.log(`  纠正位置: ${r.correctedPosition}`);
    console.log(`  纠正前:   ${showWord(r.received)}`);
    console.log(`  纠正后:   ${showWord(r.corrected!)}`);
    console.log(`  提取数据(位置3,5,6,7): ${r.data}`);
  } else if (r.decision === "NO_ERROR") {
    console.log(`  提取数据(位置3,5,6,7): ${r.data}`);
  } else {
    console.log(`  不可纠正的双位错误，不输出可信数据。`);
  }
  console.log(`  保证范围: ${r.guarantee}`);
}

function die(msg: string): never {
  console.error(`错误: ${msg}`);
  process.exit(2);
}

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "layout": {
    const l = layout();
    console.log(l.convention);
    for (const p of l.positions) console.log(`  位置 ${p.position}: ${p.role}`);
    for (const g of PARITY_GROUPS) console.log(`  p${g.bit} = XOR(位置 ${g.positions.join(",")})，偶校验`);
    console.log(`  位置 8 = XOR(位置 1..7)，整体偶校验`);
    break;
  }
  case "encode": {
    const data = args[0] ?? die("用法: cli encode <4位01串>");
    const cw = encode(data);
    console.log(`数据 ${data} -> 码字 ${cw}  (${showWord(cw)})`);
    break;
  }
  case "decode": {
    const cw = args[0] ?? die("用法: cli decode <8位01串>");
    showReport(decode(cw));
    break;
  }
  case "verify": {
    const cw = args[0] ?? die("用法: cli verify <8位01串>");
    showReport(store.verifyStandalone(cw));
    break;
  }
  case "flip": {
    const cw = args[0] ?? die("用法: cli flip <8位码字> <位置...>");
    const positions = args.slice(1).map(Number);
    console.log(`翻转后: ${flip(cw, positions)}`);
    break;
  }
  case "experiment": {
    const sub = args[0];
    if (sub === "create") {
      const r = store.createExperiment(args[1] ?? die("用法: cli experiment create <4位数据>"));
      console.log(`实验 #${r.id} 已创建，码字 ${r.codeword}`);
    } else if (sub === "inject") {
      const id = Number(args[1]);
      const positions = args.slice(2).map(Number);
      const { received, report } = store.injectAndDecode(id, positions);
      console.log(`实验 #${id} 注入翻转 [${positions.join(",")}]，接收码字 ${received}`);
      showReport(report);
      const exp = store.getExperiment(id);
      console.log(`  统计(解码后对照): ${exp.stats}`);
    } else if (sub === "list") {
      for (const e of store.listExperiments()) {
        console.log(`#${e.id} data=${e.data} codeword=${e.codeword} received=${e.received ?? "-"} status=${e.status}`);
      }
    } else if (sub === "show") {
      const e = store.getExperiment(Number(args[1]));
      console.log(JSON.stringify(e, null, 2));
    } else die("用法: cli experiment create|inject|list|show ...");
    break;
  }
  default:
    console.log(`用法: node dist/cli.js <命令>
  layout                        显示位布局与校验方程
  encode <dddd>                 编码 4 位数据
  decode <cccccccc>             解码 8 位码字（不入库）
  verify <cccccccc>             独立核验外部码字（报告入库）
  flip <cccccccc> <pos...>      翻转指定位置(1..8)
  experiment create <dddd>      创建故障实验
  experiment inject <id> <pos...>  注入翻转并解码（原子写入）
  experiment list|show [id]     查看实验`);
}
