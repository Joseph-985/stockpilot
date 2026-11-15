import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from './index';
import { getPendingMigrations, type DatabaseMigration } from './types';

export async function applyMigrations(
  database: SQLiteDatabase,
  registeredMigrations: readonly DatabaseMigration[] = migrations,
): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;
  const pending = getPendingMigrations(currentVersion, registeredMigrations);

  if (pending.length === 0) return;

  await database.withTransactionAsync(async () => {
    for (const migration of pending) {
      await migration.up(database);
      await database.execAsync(`PRAGMA user_version = ${migration.version}`);
    }
  });
}
