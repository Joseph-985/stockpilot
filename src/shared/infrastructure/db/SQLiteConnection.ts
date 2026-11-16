import type { SQLiteBindParams, SQLiteRunResult } from 'expo-sqlite';

/** Small async database surface shared by Expo SQLite and integration-test adapters. */
export interface SQLiteConnection {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SQLiteBindParams): Promise<SQLiteRunResult>;
  getFirstAsync<T>(source: string, params: SQLiteBindParams): Promise<T | null>;
  getAllAsync<T>(source: string, params: SQLiteBindParams): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
