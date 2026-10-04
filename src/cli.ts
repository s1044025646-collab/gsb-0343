import * as path from "node:path";
import { Store } from "./store.js";
import { Service } from "./service.js";
import { DecodeReport, DATA_POSITIONS } from "./secded.js";

const dataDir = process.env.SECDED_DATA_DIR ?? path.join(process.cwd(), "data");
const service = new Service(new Store(path.join(dataDir, "secded.sqlite")));

function showCode(label: string, code: string) {
  const bits = code.split("").map((b, i) => b).join(" ");
  const pos = code.split("").map((_, i) => String(i + 1)).join(" ");
  console.log(`  ${label}: ${bits}`);
  console.log(`  ${"位置".padEnd(label.length - 2 > 0 ? label.length - 2 : 0, " ")}  ${pos}`);
}

function showReport(report: DecodeReport) {
  console.log(`接收码字: ${report.received.split("").join(" ")}  (位置 1..8)`);
  console.log("校验方程（偶校验，组内异或应为 0）:");
  for (const c of report.parityChecks) {
    console.log(`  组 {${c.group.join(",")}}: 异或 = ${c.xor} ${c.xor ? "<- 失败" : ""}`);
  }
  console.log(`综合征 S = ${report.syndrome}（二进制 ${report.syndrome.toString(2).padStart(3, "0")}，对应位置 ${report.syndrome || "无"}）`);
  console.log(`整体奇偶（含位置8）: ${report.overallParityOk ? "通过" : "失败"}`);
  const verdictText = { no_error: "未检测到错误", corrected: "已纠正单错", double_error: "检测到双位错误，不可纠正，拒绝输出可信数据" }[report.verdict];
  console.log(`判定: ${verdictText}`);
  if (report.correctedPosition !== null) {
    console.log(`纠正位置: ${report.correctedPosition}`);
    console.log(`纠正前: ${report.received.split("").join(" ")}`);
    console.log(`纠正后: ${report.correctedCode!.split("").join(" ")}`);
    console.log(`纠正后重新校验: ${report.recheckOk ? "通过" : "失败"}`);
  }
  if (report.data !== null) {
    console.log(`提取数据（位置 ${DATA_POSITIONS.join(",")}）: ${report.data}`);
  } else {
    console.log("数据: （不可信，不输出）");
  }
  console.log("注意: 结论仅在每码字至多两位错误的保证范围内成立；三位及以上错误可能误判或漏检。");
}

function fail(e: any): never {
  console.error(`错误 [${e?.code ?? "ERR_INTERNAL"}]: ${e?.message ?? e}`);
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  switch (cmd) {
    case "encode": {
      const r = service.encode(args[0]);
      console.log(`数据: ${r.data}`);
      showCode("码字", r.code);
      break;
    }
    case "check": {
      const r = service.check(args[0], args[1]);
      console.log(`独立核验报告 #${r.id}`);
      showReport(r.report);
      break;
    }
    case "experiment": {
      const [sub, ...rest] = args;
      if (sub === "create") {
        const r = service.createExperiment(rest[0]);
        console.log(`实验 #${r.id} 已创建  数据=${r.data} 编码=${r.encoded}`);
      } else if (sub === "flip") {
        const id = Number(rest[0]);
        const positions = rest.slice(1).map(Number);
        const r = service.flip(id, positions);
        console.log(`实验 #${id} 已翻转位置 ${r.flips.join(",")}  接收码字=${r.received}`);
      } else if (sub === "decode") {
        const r = service.decodeExperiment(Number(rest[0]));
        showReport(r.report);
        if (r.match !== null) console.log(`对照原数据 ${r.originalData}: ${r.match ? "一致" : "不一致"}（仅统计，不参与判断）`);
      } else if (sub === "list") {
        for (const e of service.listExperiments()) {
          console.log(`#${e.id} [${e.status}] 数据=${e.data} 编码=${e.encoded} 翻转=[${e.flips.join(",")}] 接收=${e.received ?? "-"}`);
        }
      } else if (sub === "show") {
        const e = service.getExperiment(Number(rest[0]));
        console.log(JSON.stringify(e, null, 2));
      } else {
        console.error("用法: experiment <create|flip|decode|list|show> ..."); process.exit(2);
      }
      break;
    }
    case "layout": {
      const l = service.layout();
      console.log(`规则版本: ${l.ruleVersion}`);
      for (const p of l.positions) console.log(`  位置 ${p.position}: ${p.role}${p.dataIndex !== null ? ` (数据位 d${p.dataIndex + 1})` : ""}`);
      for (const [g, members] of Object.entries(l.parityGroups)) console.log(`  校验组 p${g}: 位置 {${members.join(",")}}`);
      console.log(`保证范围: ${l.guarantee}`);
      break;
    }
    case "demo": {
      const { runDemo } = await import("./demo.js");
      runDemo(service);
      break;
    }
    default:
      console.log(`用法:
  encode <dddd>                 编码四位数据
  check <cccccccc> [version]    独立核验外部八位码字
  experiment create <dddd>      创建故障实验
  experiment flip <id> <p...>   翻转指定位置（1..8，不重复）
  experiment decode <id>        解码并展示报告
  experiment list|show [id]     查看实验
  layout                        查看位布局
  demo                          运行四类手工样例演示`);
  }
} catch (e) { fail(e); }
