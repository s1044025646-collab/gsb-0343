import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DecodeReport, RULE_VERSION, SecdedError, decode, encode, flip,
} from "./secded";

export interface ExperimentRow {
  id: number;
  rule_version: string;
  data: string;
  codeword: string;
  received: string | null;
  flips: string | null;
  status: string;
  report: string | null;
  stats: string | null;
}

export class Store {
  private db: DatabaseSync;
  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS rules (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_version TEXT NOT NULL REFERENCES rules(version),
        data TEXT NOT NULL,
        codeword TEXT NOT NULL,
        received TEXT,
        flips TEXT,
        status TEXT NOT NULL DEFAULT 'ENCODED',
        report TEXT,
        stats TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS standalone_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_version TEXT NOT NULL,
        received TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO rules(version, description) VALUES
        ('${RULE_VERSION}', 'Hamming(8,4) SECDED，偶校验，位置1/2/4校验位，3/5/6/7数据位，8整体奇偶');
    `);
  }
  close(): void { this.db.close(); }

  createExperiment(data: string): { id: number; codeword: string } {
    const codeword = encode(data);
    const r = this.db
      .prepare("INSERT INTO experiments(rule_version, data, codeword) VALUES (?,?,?)")
      .run(RULE_VERSION, data, codeword);
    return { id: Number(r.lastInsertRowid), codeword };
  }

  getExperiment(id: number): ExperimentRow {
    const row = this.db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as
      | ExperimentRow | undefined;
    if (!row) throw new SecdedError("NOT_FOUND", `实验不存在: ${id}`);
    return row;
  }

  listExperiments(): ExperimentRow[] {
    return this.db.prepare("SELECT * FROM experiments ORDER BY id").all() as unknown as ExperimentRow[];
  }

  /**
   * 注入翻转并解码，原子写入；失败不覆盖已有记录。
   * 解码路径只使用接收码字与规则版本，不读原始数据。
   */
  injectAndDecode(id: number, positions: number[]): { received: string; report: DecodeReport } {
    const exp = this.getExperiment(id);
    if (exp.status === "DECODED") {
      throw new SecdedError("ALREADY_DECODED", `实验 ${id} 已完成解码，不能重复注入`);
    }
    const received = flip(exp.codeword, positions);
    const report = decode(received, exp.rule_version); // 仅码字+版本
    // 统计（在解码完成后才对照原数据，不进入判断路径）
    const stats = {
      flips: positions,
      errorCount: positions.length,
      originalData: exp.data,
      decodedData: report.data,
      dataRecovered: report.data !== null && report.data === exp.data,
      codewordRecovered: report.corrected !== null && report.corrected === exp.codeword,
    };
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "UPDATE experiments SET received=?, flips=?, status='DECODED', report=?, stats=? WHERE id=? AND status != 'DECODED'"
        )
        .run(received, JSON.stringify(positions), JSON.stringify(report), JSON.stringify(stats), id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { received, report };
  }

  /** 独立核验外部码字，无需登记原文 */
  verifyStandalone(received: string): DecodeReport {
    const report = decode(received, RULE_VERSION);
    this.db
      .prepare("INSERT INTO standalone_reports(rule_version, received, report) VALUES (?,?,?)")
      .run(RULE_VERSION, received, JSON.stringify(report));
    return report;
  }

  listStandaloneReports() {
    return this.db.prepare("SELECT * FROM standalone_reports ORDER BY id").all();
  }
}
