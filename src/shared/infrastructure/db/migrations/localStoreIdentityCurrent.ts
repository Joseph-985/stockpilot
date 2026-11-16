import type { DatabaseMigration } from './types';

type ColumnInfo = { name: string };
type StoreIdentityRow = { store_id: string };

/** Repairs databases created before local store identity tracked its active row. */
export const localStoreIdentityCurrentMigration: DatabaseMigration = {
  version: 3,
  name: 'local-store-identity-current-flag',
  async up(database) {
    const columns = await database.getAllAsync<ColumnInfo>(
      "PRAGMA table_info('local_store_identity');",
      [],
    );

    if (!columns.some((column) => column.name === 'is_current')) {
      await database.execAsync(
        `ALTER TABLE local_store_identity
         ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1));`,
      );
    }

    const currentStore = await database.getFirstAsync<StoreIdentityRow>(
      `SELECT store_id FROM local_store_identity
       WHERE is_current = 1 AND identity_kind = 'local_demo'
       ORDER BY created_at, store_id LIMIT 1;`,
      [],
    );
    const fallbackStore = currentStore
      ? null
      : await database.getFirstAsync<StoreIdentityRow>(
          `SELECT store_id FROM local_store_identity
           WHERE identity_kind = 'local_demo'
           ORDER BY created_at, store_id LIMIT 1;`,
          [],
        );
    const selectedStore = currentStore ?? fallbackStore;

    await database.runAsync('UPDATE local_store_identity SET is_current = 0;', []);
    if (selectedStore) {
      await database.runAsync(
        'UPDATE local_store_identity SET is_current = 1 WHERE store_id = ?;',
        [selectedStore.store_id],
      );
    }

    await database.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_store_identity_current
        ON local_store_identity(is_current) WHERE is_current = 1;
    `);
  },
};
