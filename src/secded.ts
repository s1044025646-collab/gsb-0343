/** 扩展汉明 (8,4) SECDED 核心逻辑。位置编号 1..8，与字符串下标 0..7 一一对应（位置 i = s[i-1]）。偶校验。 */

export const RULE_VERSION = "hamming-secded-8-4-even-v1";

export const PARITY_GROUPS: Record<number, number[]> = {
  1: [1, 3, 5, 7],
  2: [2, 3, 6, 7],
  4: [4, 5, 6, 7],
};
export const DATA_POSITIONS = [3, 5, 6, 7];
export const OVERALL_PARITY_POSITION = 8;
export const MAX_FLIPS_PER_CALL = 8;
export const MAX_BATCH_EXPERIMENTS = 256;

export class SecdedError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export function assertBits(s: string, len: number, what: string): void {
  if (typeof s !== "string" || s.length !== len || !/^[01]+$/.test(s)) {
    throw new SecdedError("ERR_INVALID_BITS", `${what} 必须是长度 ${len} 的 0/1 字符串，保留前导零，收到: ${JSON.stringify(s)}`);
  }
}

export function assertRuleVersion(v: string): void {
  if (v !== RULE_VERSION) {
    throw new SecdedError("ERR_RULE_VERSION", `不支持的规则版本: ${JSON.stringify(v)}，当前为 ${RULE_VERSION}`);
  }
}

export function bitAt(code: string, pos: number): number {
  return code.charCodeAt(pos - 1) - 48;
}

export interface ParityCheck {
  group: number[];
  xor: number;
}

/** 编码 4 位数据 -> 8 位码字（偶校验）。 */
export function encode(data: string): string {
  assertBits(data, 4, "数据");
  const bits = new Array<number>(9).fill(0);
  DATA_POSITIONS.forEach((pos, i) => (bits[pos] = data.charCodeAt(i) - 48));
  for (const g of [1, 2, 4]) {
    let x = 0;
    for (const p of PARITY_GROUPS[g]) if (p !== g) x ^= bits[p];
    bits[g] = x; // 偶校验：校验位使组内异或为 0
  }
  let all = 0;
  for (let p = 1; p <= 7; p++) all ^= bits[p];
  bits[8] = all;
  return bits.slice(1).join("");
}

export interface DecodeReport {
  ruleVersion: string;
  received: string;
  parityChecks: { group: number[]; xor: number }[];
  syndrome: number; // 0..7，非零即出错位置（1..7）
  overallParityOk: boolean;
  verdict: "no_error" | "corrected" | "double_error";
  correctedPosition: number | null; // 1..8
  correctedCode: string | null;
  data: string | null; // 仅在可信时输出
  recheckOk: boolean | null; // 纠正后重新校验结果
}

/** 解码：只依赖接收码字与规则版本，不读取原始数据。 */
export function decode(received: string, ruleVersion: string): DecodeReport {
  assertRuleVersion(ruleVersion);
  assertBits(received, 8, "接收码字");
  const parityChecks: ParityCheck[] = [];
  let syndrome = 0;
  for (const g of [1, 2, 4]) {
    let x = 0;
    for (const p of PARITY_GROUPS[g]) x ^= bitAt(received, p);
    parityChecks.push({ group: PARITY_GROUPS[g], xor: x });
    if (x) syndrome |= g;
  }
  let all = 0;
  for (let p = 1; p <= 8; p++) all ^= bitAt(received, p);
  const overallParityOk = all === 0;

  const report: DecodeReport = {
    ruleVersion,
    received,
    parityChecks,
    syndrome,
    overallParityOk,
    verdict: "no_error",
    correctedPosition: null,
    correctedCode: null,
    data: null,
    recheckOk: null,
  };

  if (syndrome === 0 && overallParityOk) {
    report.verdict = "no_error";
    report.correctedCode = received;
  } else if (syndrome !== 0 && !overallParityOk) {
    report.verdict = "corrected";
    report.correctedPosition = syndrome;
    report.correctedCode = flipBits(received, [syndrome]);
  } else if (syndrome === 0 && !overallParityOk) {
    report.verdict = "corrected";
    report.correctedPosition = 8;
    report.correctedCode = flipBits(received, [8]);
  } else {
    // syndrome != 0 && overallParityOk：双位错误，不可纠正
    report.verdict = "double_error";
    return report;
  }

  // 成功路径：重新校验纠正后的码字，再提取数据
  const recheck = computeChecksOnly(report.correctedCode!);
  report.recheckOk = recheck.syndrome === 0 && recheck.overallOk;
  if (!report.recheckOk) {
    report.verdict = "double_error";
    report.correctedCode = null;
    report.correctedPosition = null;
    return report;
  }
  report.data = DATA_POSITIONS.map((p) => bitAt(report.correctedCode!, p)).join("");
  return report;
}

function computeChecksOnly(code: string): { syndrome: number; overallOk: boolean } {
  let syndrome = 0;
  for (const g of [1, 2, 4]) {
    let x = 0;
    for (const p of PARITY_GROUPS[g]) x ^= bitAt(code, p);
    if (x) syndrome |= g;
  }
  let all = 0;
  for (let p = 1; p <= 8; p++) all ^= bitAt(code, p);
  return { syndrome, overallOk: all === 0 };
}

export function validateFlipPositions(positions: number[]): void {
  if (!Array.isArray(positions) || positions.length === 0 || positions.length > MAX_FLIPS_PER_CALL) {
    throw new SecdedError("ERR_FLIP_POSITIONS", `翻转位置数组长度须在 1..${MAX_FLIPS_PER_CALL}`);
  }
  const seen = new Set<number>();
  for (const p of positions) {
    if (!Number.isInteger(p) || p < 1 || p > 8) {
      throw new SecdedError("ERR_FLIP_POSITIONS", `翻转位置必须是 1..8 的整数，收到: ${p}`);
    }
    if (seen.has(p)) {
      throw new SecdedError("ERR_DUPLICATE_POSITION", `翻转位置重复: ${p}`);
    }
    seen.add(p);
  }
}

export function flipBits(code: string, positions: number[]): string {
  assertBits(code, 8, "码字");
  validateFlipPositions(positions);
  const arr = code.split("");
  for (const p of positions) arr[p - 1] = arr[p - 1] === "0" ? "1" : "0";
  return arr.join("");
}

export function bitLayout() {
  return {
    ruleVersion: RULE_VERSION,
    positions: Array.from({ length: 8 }, (_, i) => {
      const pos = i + 1;
      const role = pos === 8 ? "overall_parity" : DATA_POSITIONS.includes(pos) ? "data" : "parity";
      return { position: pos, role, dataIndex: role === "data" ? DATA_POSITIONS.indexOf(pos) : null };
    }),
    parityGroups: PARITY_GROUPS,
    guarantee: "每码字至多两位错误：单错可纠正，双错可检测。三位及以上错误可能误判或漏检。",
  };
}
