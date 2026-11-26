import type { SQLiteConnection } from '../SQLiteConnection';

import { migrations } from './index';
import { getPendingMigrations, type DatabaseMigration } from './types';

export async function applyMigrations(
  database: SQLiteConnection,
  registeredMigrations: readonly DatabaseMigration[] = migrations,
): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const currentVersion = row?.user_version ?? 0;
  const pending = getPendingMigrations(currentVersion, registeredMigrations);

  if (pending.length === 0) return;

  const requiresForeignKeySuspension = pending.some(
    (migration) => migration.requiresForeignKeysDisabled,
  );
  if (!requiresForeignKeySuspension) {
    await runMigrationsInTransaction(database, pending);
    return;
  }

  const initiallyEnabled = await database.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys;',
    [],
  );
  if (initiallyEnabled?.foreign_keys !== 1) {
    throw new Error('Foreign keys must be enabled before the outbox migration.');
  }

  await database.execAsync('PRAGMA foreign_keys = OFF;');
  const disabled = await database.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys;',
    [],
  );
  if (disabled?.foreign_keys !== 0) {
    throw new Error('SQLite foreign-key enforcement could not be suspended for migration.');
  }

  let migrationFailed = false;
  try {
    await database.withTransactionAsync(async () => {
      for (const migration of pending) {
        await migration.up(database);
        await database.execAsync(`PRAGMA user_version = ${migration.version}`);
      }

      const violations = await database.getAllAsync<{ table: string }>(
        'PRAGMA foreign_key_check;',
        [],
      );
      if (violations.length > 0) {
        throw new Error(
          `SQLite migration produced foreign-key violations in: ${[...new Set(violations.map(({ table }) => table))].join(', ')}.`,
        );
      }
    });
  } catch (error) {
    migrationFailed = true;
    throw error;
  } finally {
    await database.execAsync('PRAGMA foreign_keys = ON;');
    const restored = await database.getFirstAsync<{ foreign_keys: number }>(
      'PRAGMA foreign_keys;',
      [],
    );
    if (restored?.foreign_keys !== 1 && !migrationFailed) {
      throw new Error('SQLite foreign-key enforcement could not be restored after migration.');
    }
  }
}

async function runMigrationsInTransaction(
  database: SQLiteConnection,
  migrations: readonly DatabaseMigration[],
): Promise<void> {
  await database.withTransactionAsync(async () => {
    for (const migration of migrations) {
      await migration.up(database);
      await database.execAsync(`PRAGMA user_version = ${migration.version}`);
    }
  });
}
