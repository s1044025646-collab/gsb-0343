import { Service } from "./service.js";
import { flipBits } from "./secded.js";

/** 手工核算样例：数据 1011 -> 码字 01100110
 *  p1(1,3,5,7): 1^0^1=0 -> p1=0
 *  p2(2,3,6,7): 1^1^1=1 -> p2=1
 *  p4(4,5,6,7): 0^1^1=0 -> p4=0
 *  p8: 0^1^1^0^0^1^1=0 -> p8=0
 */
export function runDemo(service: Service) {
  const data = "1011";
  const code = service.encode(data).code;
  console.log(`=== 手工样例：数据 ${data} -> 码字 ${code} ===\n`);

  const cases: [string, number[]][] = [
    ["数据位错误（位置6，d3）", [6]],
    ["普通校验位错误（位置2，p2）", [2]],
    ["整体校验位错误（位置8，p8）", [8]],
    ["双位错误（位置3和5）", [3, 5]],
  ];
  for (const [title, flips] of cases) {
    const received = flipBits(code, flips);
    console.log(`--- ${title}: 翻转 [${flips.join(",")}] -> 接收 ${received}`);
    const { report } = service.check(received);
    console.log(`    综合征=${report.syndrome} 整体奇偶=${report.overallParityOk ? "通过" : "失败"} 判定=${report.verdict} 纠正位置=${report.correctedPosition ?? "-"} 数据=${report.data ?? "(不输出)"}\n`);
  }

  console.log("--- 反例：三位错误（位置1,2,3）超出保证范围");
  const bad = flipBits(code, [1, 2, 3]);
  const r = service.check(bad).report;
  console.log(`    接收 ${bad} 综合征=${r.syndrome} 判定=${r.verdict} 纠正位置=${r.correctedPosition} 数据=${r.data}`);
  console.log("    -> 被误判为位置8单错并输出错误数据，说明三位及以上错误不在保证范围内。");
}
