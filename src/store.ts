import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { DecodeReport, RULE_VERSION } from "./secded.js";

export interface ExperimentRow {
  id: number;
  rule_version: string;
  data: string;
  encoded: string;
  flips: string; // JSON number[]
  received: string | null;
  report: string | null; // JSON DecodeReport
  status: "encoded" | "flipped" | "decoded";
  match: number | null; // 解码数据是否与原数据一致（仅统计，不参与判断）
  created_at: string;
}

export class Store {
  db: DatabaseSync;
  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_version TEXT NOT NULL,
        data TEXT NOT NULL,
        encoded TEXT NOT NULL,
        flips TEXT NOT NULL DEFAULT '[]',
        received TEXT,
        report TEXT,
        status TEXT NOT NULL,
        match INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS standalone_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_version TEXT NOT NULL,
        received TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.db.prepare("INSERT OR IGNORE INTO rules(version, description) VALUES (?, ?)").run(
      RULE_VERSION,
      "扩展汉明 (8,4) SECDED，偶校验，位置1/2/4校验位，3/5/6/7数据位，8整体奇偶位"
    );
  }

  createExperiment(data: string, encoded: string): number {
    const r = this.db.prepare(
      "INSERT INTO experiments(rule_version, data, encoded, flips, status, created_at) VALUES (?,?,?,'[]','encoded',?)"
    ).run(RULE_VERSION, data, encoded, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  getExperiment(id: number): ExperimentRow | undefined {
    return this.db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as unknown as ExperimentRow | undefined;
  }

  listExperiments(): ExperimentRow[] {
    return this.db.prepare("SELECT * FROM experiments ORDER BY id").all() as unknown as ExperimentRow[];
  }

  /** 记录翻转操作（更新接收码字），不改动原始数据与编码。 */
  recordFlips(id: number, flips: number[], received: string): void {
    const r = this.db.prepare(
      "UPDATE experiments SET flips = ?, received = ?, status = 'flipped' WHERE id = ?"
    ).run(JSON.stringify(flips), received, id);
    if (r.changes === 0) throw Object.assign(new Error(`实验 ${id} 不存在`), { code: "ERR_NOT_FOUND" });
  }

  /** 解码结果与状态原子写入；失败（如已解码）不覆盖已有记录。 */
  recordDecode(id: number, report: DecodeReport, match: boolean | null): void {
    const tx = this.db;
    tx.exec("BEGIN IMMEDIATE");
    try {
      const row = this.getExperiment(id);
      if (!row) throw Object.assign(new Error(`实验 ${id} 不存在`), { code: "ERR_NOT_FOUND" });
      if (row.status === "decoded") throw Object.assign(new Error(`实验 ${id} 已解码，拒绝覆盖`), { code: "ERR_ALREADY_DECODED" });
      if (!row.received) throw Object.assign(new Error(`实验 ${id} 尚未注入翻转`), { code: "ERR_NOT_FLIPPED" });
      tx.prepare(
        "UPDATE experiments SET report = ?, status = 'decoded', match = ? WHERE id = ?"
      ).run(JSON.stringify(report), match === null ? null : match ? 1 : 0, id);
      tx.exec("COMMIT");
    } catch (e) {
      tx.exec("ROLLBACK");
      throw e;
    }
  }

  /** 独立核验报告：外部码字无需登记原文。 */
  saveStandaloneReport(received: string, report: DecodeReport): number {
    const r = this.db.prepare(
      "INSERT INTO standalone_reports(rule_version, received, report, created_at) VALUES (?,?,?,?)"
    ).run(RULE_VERSION, received, JSON.stringify(report), new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  listStandaloneReports() {
    return this.db.prepare("SELECT * FROM standalone_reports ORDER BY id").all();
  }

  close() { this.db.close(); }
}
