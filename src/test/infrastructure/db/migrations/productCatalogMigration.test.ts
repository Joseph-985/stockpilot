import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { migrations } from '@/shared/infrastructure/db/migrations';
import { applyMigrations } from '@/shared/infrastructure/db/migrations/applyMigrations';
import { productCatalogMigration } from '@/shared/infrastructure/db/migrations/productCatalog';
import { productSearchNormalizationMigration } from '@/shared/infrastructure/db/migrations/productSearchNormalization';
import { localStoreIdentityCurrentMigration } from '@/shared/infrastructure/db/migrations/localStoreIdentityCurrent';
import type { DatabaseMigration } from '@/shared/infrastructure/db/migrations/types';
import { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '20000000-0000-4000-8000-000000000001',
}));

describe('product catalog migration', () => {
  it('repairs an existing identity table without is_current and preserves its store ID', async () => {
    const database = new SQLiteTestDatabase();
    try {
      await database.execAsync(`
        CREATE TABLE local_store_identity (
          store_id TEXT PRIMARY KEY NOT NULL,
          identity_kind TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO local_store_identity (store_id, identity_kind, created_at)
          VALUES ('30000000-0000-4000-8000-000000000001', 'local_demo', '2026-01-01T00:00:00.000Z');
        PRAGMA user_version = 2;
      `);

      await applyMigrations(database, [
        productCatalogMigration,
        productSearchNormalizationMigration,
        localStoreIdentityCurrentMigration,
      ]);
      const identity = await database.getFirstAsync<{
        store_id: string;
        is_current: number;
      }>('SELECT store_id, is_current FROM local_store_identity;', []);
      const version = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );

      expect(identity).toEqual({
        store_id: '30000000-0000-4000-8000-000000000001',
        is_current: 1,
      });
      expect(version?.user_version).toBe(3);

      await applyMigrations(database, [
        productCatalogMigration,
        productSearchNormalizationMigration,
        localStoreIdentityCurrentMigration,
      ]);
      expect(
        await database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM local_store_identity WHERE is_current = 1;',
          [],
        ),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('upgrades an existing M0 database, enables WAL/FKs, and safely reruns', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'stockpilot-m1-migration-'));
    const database = new SQLiteTestDatabase(join(directory, 'stockpilot.db'));

    try {
      await database.execAsync(`
        CREATE TABLE m0_existing_data (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO m0_existing_data (id, value) VALUES (1, 'preserve-me');
      `);

      await initializeDatabase(database);
      const store = await database.getFirstAsync<{ store_id: string; identity_kind: string }>(
        'SELECT store_id, identity_kind FROM local_store_identity WHERE is_current = 1;',
        [],
      );
      const version = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );
      const journal = await database.getFirstAsync<{ journal_mode: string }>(
        'PRAGMA journal_mode;',
        [],
      );
      const foreignKeys = await database.getFirstAsync<{ foreign_keys: number }>(
        'PRAGMA foreign_keys;',
        [],
      );
      const oldData = await database.getFirstAsync<{ value: string }>(
        'SELECT value FROM m0_existing_data WHERE id = 1;',
        [],
      );

      expect(version?.user_version).toBe(6);
      expect(journal?.journal_mode.toLowerCase()).toBe('wal');
      expect(foreignKeys?.foreign_keys).toBe(1);
      expect(store).toEqual({
        store_id: '20000000-0000-4000-8000-000000000001',
        identity_kind: 'local_demo',
      });
      expect(oldData?.value).toBe('preserve-me');

      await initializeDatabase(database);
      const stores = await database.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM local_store_identity;',
        [],
      );
      const repeatedVersion = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );
      expect(stores?.count).toBe(1);
      expect(repeatedVersion?.user_version).toBe(6);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('adds Unicode search columns and backfills existing v1 products without replacing rows', async () => {
    const database = new SQLiteTestDatabase();
    try {
      await applyMigrations(database, [productCatalogMigration]);
      await database.runAsync(
        `INSERT INTO local_store_identity (store_id, identity_kind, is_current, created_at)
         VALUES (?, 'local_demo', 1, ?);`,
        ['30000000-0000-4000-8000-000000000001', '2026-01-01T00:00:00.000Z'],
      );
      await database.runAsync(
        `INSERT INTO local_products (
          id, store_id, sku, name, description, category, price_minor, cost_minor,
          low_stock_threshold, server_version, local_revision, sync_status,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, 350000, NULL, 0, 0, 1, 'pending', ?, ?, NULL);`,
        [
          '40000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          'CAFÉ-001',
          'Straße Café',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
        ],
      );

      await applyMigrations(database, migrations);

      const product = await database.getFirstAsync<{
        id: string;
        name: string;
        sku_search: string;
        name_search: string;
      }>(`SELECT id, name, sku_search, name_search FROM local_products WHERE id = ?;`, [
        '40000000-0000-4000-8000-000000000001',
      ]);
      const version = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );
      expect(product).toEqual({
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Straße Café',
        sku_search: 'café-001',
        name_search: 'strasse café',
      });
      expect(version?.user_version).toBe(6);
    } finally {
      database.close();
    }
  });

  it('rolls back the additive search migration and retains the v1 schema version on backfill failure', async () => {
    const database = new SQLiteTestDatabase();
    try {
      await applyMigrations(database, [productCatalogMigration]);
      await database.runAsync(
        `INSERT INTO local_store_identity (store_id, identity_kind, is_current, created_at)
         VALUES (?, 'local_demo', 1, ?);`,
        ['30000000-0000-4000-8000-000000000001', '2026-01-01T00:00:00.000Z'],
      );
      await database.runAsync(
        `INSERT INTO local_products (
          id, store_id, sku, name, description, category, price_minor, cost_minor,
          low_stock_threshold, server_version, local_revision, sync_status,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, 'TEE-001', 'Cotton shirt', NULL, NULL, 350000, NULL, 0, 0, 1, 'pending', ?, ?, NULL);`,
        [
          '40000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
        ],
      );
      await database.execAsync(`
        CREATE TRIGGER fail_product_search_backfill BEFORE UPDATE ON local_products
        BEGIN SELECT RAISE(ABORT, 'injected search migration failure'); END;
      `);

      await expect(
        applyMigrations(database, [productCatalogMigration, productSearchNormalizationMigration]),
      ).rejects.toThrow('injected search migration failure');

      const version = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );
      const searchColumn = await database.getFirstAsync<{ name: string }>(
        `SELECT name FROM pragma_table_info('local_products') WHERE name = 'name_search';`,
        [],
      );
      expect(version?.user_version).toBe(1);
      expect(searchColumn).toBeNull();
      expect(
        await database.getFirstAsync<{ name: string }>(
          'SELECT name FROM local_products WHERE id = ?;',
          ['40000000-0000-4000-8000-000000000001'],
        ),
      ).toEqual({ name: 'Cotton shirt' });
    } finally {
      database.close();
    }
  });

  it('rolls back DDL and user_version when a migration fails', async () => {
    const database = new SQLiteTestDatabase();
    const failedMigration: DatabaseMigration = {
      version: 1,
      name: 'deliberately-failing-test',
      async up(connection) {
        await connection.execAsync('CREATE TABLE should_rollback (id INTEGER PRIMARY KEY);');
        throw new Error('Injected migration failure.');
      },
    };

    await expect(applyMigrations(database, [failedMigration])).rejects.toThrow(
      'Injected migration failure.',
    );
    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version;',
      [],
    );
    const table = await database.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback';`,
      [],
    );
    expect(version?.user_version).toBe(0);
    expect(table).toBeNull();
    database.close();
  });
});
