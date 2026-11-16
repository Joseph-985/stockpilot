import type { SQLiteConnection } from './SQLiteConnection';

import { ensureLocalDemoStoreIdentity } from './localStoreIdentity';
import { applyMigrations } from './migrations/applyMigrations';

export async function initializeDatabase(database: SQLiteConnection): Promise<void> {
  await database.execAsync('PRAGMA journal_mode = WAL;');
  await database.execAsync('PRAGMA foreign_keys = ON;');

  const foreignKeys = await database.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys;',
    [],
  );
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error('SQLite foreign-key enforcement could not be enabled.');
  }

  await applyMigrations(database);
  await ensureLocalDemoStoreIdentity(database);
}
