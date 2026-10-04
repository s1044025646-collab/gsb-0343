import { Store } from "./store.js";
import * as S from "./secded.js";

/** 业务服务层：API 与 CLI 共用。 */
export class Service {
  constructor(public store: Store) {}

  encode(data: string) {
    S.assertBits(data, 4, "数据");
    const code = S.encode(data);
    return { ruleVersion: S.RULE_VERSION, data, code };
  }

  /** 独立核验外部码字，无需登记原文。 */
  check(received: string, ruleVersion: string = S.RULE_VERSION) {
    const report = S.decode(received, ruleVersion);
    const id = this.store.saveStandaloneReport(received, report);
    return { id, report };
  }

  createExperiment(data: string) {
    S.assertBits(data, 4, "数据");
    const encoded = S.encode(data);
    const id = this.store.createExperiment(data, encoded);
    return { id, data, encoded };
  }

  flip(id: number, positions: number[]) {
    S.validateFlipPositions(positions);
    const row = this.store.getExperiment(id);
    if (!row) throw new S.SecdedError("ERR_NOT_FOUND", `实验 ${id} 不存在`);
    if (row.status === "decoded") throw new S.SecdedError("ERR_ALREADY_DECODED", `实验 ${id} 已解码，不能再注入`);
    const base = row.received ?? row.encoded;
    const received = S.flipBits(base, positions);
    const allFlips = [...(JSON.parse(row.flips) as number[]), ...positions];
    this.store.recordFlips(id, allFlips, received);
    return { id, flips: allFlips, received };
  }

  /** 解码实验：判断路径只用接收码字与规则版本；原数据仅用于事后统计。 */
  decodeExperiment(id: number) {
    const row = this.store.getExperiment(id);
    if (!row) throw new S.SecdedError("ERR_NOT_FOUND", `实验 ${id} 不存在`);
    if (!row.received) throw new S.SecdedError("ERR_NOT_FLIPPED", `实验 ${id} 尚未注入翻转`);
    const report = S.decode(row.received, row.rule_version);
    const match = report.data === null ? null : report.data === row.data;
    this.store.recordDecode(id, report, match);
    return { id, report, originalData: row.data, encoded: row.encoded, match };
  }

  getExperiment(id: number) {
    const row = this.store.getExperiment(id);
    if (!row) throw new S.SecdedError("ERR_NOT_FOUND", `实验 ${id} 不存在`);
    return { ...row, flips: JSON.parse(row.flips), report: row.report ? JSON.parse(row.report) : null };
  }

  listExperiments() {
    return this.store.listExperiments().map((r) => ({ ...r, flips: JSON.parse(r.flips), report: r.report ? JSON.parse(r.report) : null }));
  }

  layout() { return S.bitLayout(); }
}
