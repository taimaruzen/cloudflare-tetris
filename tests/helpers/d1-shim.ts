/**
 * テスト用：Node 組み込みの SQLite で Cloudflare D1 の API を再現する最小実装。
 * 本番と同じマイグレーション SQL を流し込み、Worker のコードをそのまま動かす。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

type Row = Record<string, unknown>;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : (p as SQLInputValue))));
  }

  async first<T = Row>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Row | undefined;
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }

  async all<T = Row>() {
    return this.exec<T>();
  }

  async run() {
    return this.exec();
  }

  exec<T = Row>() {
    const stmt = this.db.prepare(this.sql);
    const isRead = /^\s*(SELECT|WITH)/i.test(this.sql);
    if (isRead) {
      const results = stmt.all(...this.params) as T[];
      return { success: true, results, meta: { changes: 0, last_row_id: 0 } };
    }
    const r = stmt.run(...this.params);
    return { success: true, results: [] as T[], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class D1Shim {
  readonly raw: DatabaseSync;
  constructor(migrationsDir: string) {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');
    for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort()) {
      this.raw.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.raw, sql);
  }

  /** D1 と同じく、バッチはトランザクションとして実行する */
  async batch(stmts: Statement[]) {
    this.raw.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.exec());
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
}
