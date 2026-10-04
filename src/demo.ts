import { execSync } from "node:child_process";
const run = (c: string) => {
  console.log(`\n$ ${c}`);
  console.log(execSync(`"${process.execPath}" dist/cli.js ${c}`, { encoding: "utf8" }).trim());
};
// 手工核算样例：数据 1011 -> 码字 01100110
// 位置3,5,6,7 = 1,0,1,1
// p1=XOR(3,5,7)=1^0^1=0; p2=XOR(3,6,7)=1^1^1=1; p4=XOR(5,6,7)=0^1^1=0
// 位1..7 = 0110011，p8=XOR(1..7)=0
run("layout");
run("encode 1011");
console.log("\n=== 场景1: 数据位错误（翻转位置6） ===");
run("decode 01100010");
console.log("\n=== 场景2: 普通校验位错误（翻转位置2） ===");
run("decode 00100110");
console.log("\n=== 场景3: 整体校验位错误（翻转位置8） ===");
run("decode 01100111");
console.log("\n=== 场景4: 双位错误（翻转位置3和5），必须拒绝可信输出 ===");
run("decode 01001110");
console.log("\n=== 反例: 三位错误（翻转位置1,2,3）超出保证，被误判为位置8错误 ===");
run("decode 10000110");
console.log("\n=== 实验流程（故障注入 + 原子落库 + 统计对照） ===");
run("experiment create 1011");
run("experiment inject 1 6");
run("experiment list");
