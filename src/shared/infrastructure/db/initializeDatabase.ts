import type { SQLiteDatabase } from 'expo-sqlite';

import { applyMigrations } from './migrations/applyMigrations';

export async function initializeDatabase(database: SQLiteDatabase): Promise<void> {
  await database.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await applyMigrations(database);
}
