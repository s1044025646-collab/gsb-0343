/** Hamming(8,4) SECDED 核心逻辑。位置 1..8，字符串下标 0 对应位置 1。 */

export const RULE_VERSION = "hamming-8-4-secded-v1";
export const MAX_BATCH = 256;

/** 校验组：每组覆盖的位置（1 起始） */
export const PARITY_GROUPS: { bit: number; positions: number[] }[] = [
  { bit: 1, positions: [1, 3, 5, 7] },
  { bit: 2, positions: [2, 3, 6, 7] },
  { bit: 4, positions: [4, 5, 6, 7] },
];
export const DATA_POSITIONS = [3, 5, 6, 7];
export const OVERALL_PARITY_POSITION = 8;

export class SecdedError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function assertBits(s: string, len: number, what: string): void {
  if (typeof s !== "string" || s.length !== len || !/^[01]+$/.test(s)) {
    throw new SecdedError(
      "INVALID_INPUT",
      `${what}必须是长度 ${len} 的 0/1 字符串，保留前导零，收到: ${JSON.stringify(s)}`
    );
  }
}

const bitAt = (word: string, pos: number): number => word.charCodeAt(pos - 1) - 48;

/** 编码：4 位数据 -> 8 位码字（偶校验） */
export function encode(data: string): string {
  assertBits(data, 4, "数据");
  const w = new Array<number>(9).fill(0);
  DATA_POSITIONS.forEach((pos, i) => (w[pos] = data.charCodeAt(i) - 48));
  for (const g of PARITY_GROUPS) {
    let x = 0;
    for (const p of g.positions) if (p !== g.bit) x ^= w[p];
    w[g.bit] = x; // 偶校验
  }
  let overall = 0;
  for (let p = 1; p <= 7; p++) overall ^= w[p];
  w[8] = overall;
  return w.slice(1).join("");
}

export interface ParityCheckDetail {
  bit: number;
  positions: number[];
  bits: string;
  xor: number;
}

export type Decision =
  | "NO_ERROR"
  | "CORRECTED_DATA_OR_PARITY"
  | "CORRECTED_OVERALL_PARITY"
  | "DOUBLE_ERROR_DETECTED";

export interface DecodeReport {
  ruleVersion: string;
  received: string;
  checks: ParityCheckDetail[];
  syndrome: number; // 0..7
  overallParityOk: boolean;
  decision: Decision;
  correctedPosition: number | null; // 1..8
  corrected: string | null;
  data: string | null; // 仅在未检出错误/已纠正时给出
  guarantee: string;
}

export function extractData(word: string): string {
  return toData(word);
}
function toData(word: string): string {
  return DATA_POSITIONS.map((p) => word[p - 1]).join("");
}

/**
 * 解码：仅依据 8 位码字与规则版本，不接触原始数据。
 * 保证范围：每码字至多 2 位错误。>=3 位错误可能误判或漏检。
 */
export function decode(received: string, ruleVersion: string = RULE_VERSION): DecodeReport {
  assertBits(received, 8, "码字");
  if (ruleVersion !== RULE_VERSION) {
    throw new SecdedError("UNKNOWN_RULE_VERSION", `不支持的规则版本: ${ruleVersion}`);
  }
  const checks: ParityCheckDetail[] = PARITY_GROUPS.map((g) => {
    let x = 0;
    for (const p of g.positions) x ^= bitAt(received, p);
    return {
      bit: g.bit,
      positions: g.positions,
      bits: g.positions.map((p) => received[p - 1]).join(""),
      xor: x,
    };
  });
  const syndrome = checks[0].xor * 1 + checks[1].xor * 2 + checks[2].xor * 4;
  let all = 0;
  for (let p = 1; p <= 8; p++) all ^= bitAt(received, p);
  const overallParityOk = all === 0;

  let decision: Decision;
  let correctedPosition: number | null = null;
  let corrected: string | null = null;
  let data: string | null = null;

  if (syndrome === 0 && overallParityOk) {
    decision = "NO_ERROR";
    corrected = received;
    data = toData(received);
  } else if (syndrome !== 0 && !overallParityOk) {
    decision = "CORRECTED_DATA_OR_PARITY";
    correctedPosition = syndrome;
    corrected = flip(received, [syndrome]);
    data = toData(corrected);
  } else if (syndrome === 0 && !overallParityOk) {
    decision = "CORRECTED_OVERALL_PARITY";
    correctedPosition = 8;
    corrected = flip(received, [8]);
    data = toData(corrected);
  } else {
    decision = "DOUBLE_ERROR_DETECTED";
  }

  return {
    ruleVersion,
    received,
    checks,
    syndrome,
    overallParityOk,
    decision,
    correctedPosition,
    corrected,
    data,
    guarantee:
      "结论仅在每码字至多 2 位错误的保证范围内有效；3 位及以上错误可能误判或漏检，" +
      "NO_ERROR 不代表任意损坏下数据都正确。",
  };
}

/** 翻转指定位置（1..8，不重复） */
export function flip(word: string, positions: number[]): string {
  assertBits(word, 8, "码字");
  if (!Array.isArray(positions) || positions.length === 0) {
    throw new SecdedError("INVALID_POSITIONS", "翻转位置不能为空数组");
  }
  if (positions.length > MAX_BATCH) {
    throw new SecdedError("BATCH_LIMIT", `批量操作超过上限 ${MAX_BATCH}`);
  }
  const seen = new Set<number>();
  for (const p of positions) {
    if (!Number.isInteger(p) || p < 1 || p > 8) {
      throw new SecdedError("INVALID_POSITION", `翻转位置必须是 1..8 的整数，收到: ${p}`);
    }
    if (seen.has(p)) {
      throw new SecdedError("DUPLICATE_POSITION", `翻转位置重复: ${p}`);
    }
    seen.add(p);
  }
  const arr = word.split("");
  for (const p of seen) arr[p - 1] = arr[p - 1] === "0" ? "1" : "0";
  return arr.join("");
}

/** 位布局说明 */
export function layout() {
  return {
    ruleVersion: RULE_VERSION,
    positions: Array.from({ length: 8 }, (_, i) => {
      const pos = i + 1;
      const role =
        pos === 8
          ? "整体奇偶校验位"
          : PARITY_GROUPS.some((g) => g.bit === pos)
            ? `校验位 p${pos}`
            : `数据位 d${DATA_POSITIONS.indexOf(pos) + 1}`;
      return { position: pos, role };
    }),
    parityGroups: PARITY_GROUPS,
    dataPositions: DATA_POSITIONS,
    convention: "偶校验；位置从 1 开始编号；字符串下标 0 即位置 1（显示顺序）。",
  };
}
