import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteBindParams, SQLiteRunResult } from 'expo-sqlite';

import type { SQLiteConnection } from '@/shared/infrastructure/db/SQLiteConnection';

export class SQLiteTestDatabase implements SQLiteConnection {
  readonly native: DatabaseSync;

  constructor(databasePath = ':memory:') {
    this.native = new DatabaseSync(databasePath);
  }

  async execAsync(source: string): Promise<void> {
    this.native.exec(source);
  }

  async runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult> {
    const result = this.native.prepare(source).run(...toNodeParams(params));
    return {
      lastInsertRowId: Number(result.lastInsertRowid),
      changes: Number(result.changes),
    };
  }

  async getFirstAsync<T>(source: string, params: SQLiteBindParams): Promise<T | null> {
    const row = this.native.prepare(source).get(...toNodeParams(params));
    return row ? (row as T) : null;
  }

  async getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]> {
    return this.native.prepare(source).all(...toNodeParams(params)) as T[];
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.native.exec('BEGIN IMMEDIATE;');
    try {
      await task();
      this.native.exec('COMMIT;');
    } catch (error) {
      this.native.exec('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.native.close();
  }
}

function toNodeParams(params: SQLiteBindParams): SQLInputValue[] {
  if (!Array.isArray(params)) {
    throw new TypeError('SQLite tests currently use positional bind parameters only.');
  }

  return params.map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return value;
  });
}
