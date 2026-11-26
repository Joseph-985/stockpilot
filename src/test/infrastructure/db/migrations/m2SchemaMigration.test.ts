import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { ensureLocalDemoStoreIdentity } from '@/shared/infrastructure/db/localStoreIdentity';
import { applyMigrations } from '@/shared/infrastructure/db/migrations/applyMigrations';
import { migrations } from '@/shared/infrastructure/db/migrations';
import { inventorySalesMigration } from '@/shared/infrastructure/db/migrations/inventorySales';
import type { DatabaseMigration } from '@/shared/infrastructure/db/migrations/types';
import type { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';
import { SQLiteTestDatabase as TestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '10000000-0000-4000-8000-000000000001',
}));

const storeId = '10000000-0000-4000-8000-000000000001';
const productId = '20000000-0000-4000-8000-000000000001';
const commandIds = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];

type ExistingCommand = {
  local_sequence: number;
  command_id: string;
  type: string;
  entity_id: string;
  payload_json: string;
  expected_server_version: number | null;
  depends_on_command_id: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
};

describe('M2 database migrations', () => {
  it('creates all new tables on a fresh install and safely reruns', async () => {
    const database = new TestDatabase();
    try {
      await initializeDatabase(database);

      const tables = await database.getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
          'local_stock_balances', 'local_stock_movements', 'local_sales', 'local_sale_items'
        ) ORDER BY name;`,
        [],
      );
      expect(tables.map(({ name }) => name)).toEqual([
        'local_sale_items',
        'local_sales',
        'local_stock_balances',
        'local_stock_movements',
      ]);

      const before = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );
      await initializeDatabase(database);
      const after = await database.getFirstAsync<{ user_version: number }>(
        'PRAGMA user_version;',
        [],
      );
      expect(before?.user_version).toBe(6);
      expect(after?.user_version).toBe(6);
    } finally {
      database.close();
    }
  });

  it('preserves populated M1 products and every outbox command while allowing M2 types', async () => {
    const database = await createPopulatedM1Database();
    try {
      const before = await readCommands(database);
      const beforeSequence = await database.getFirstAsync<{ seq: number }>(
        "SELECT seq FROM sqlite_sequence WHERE name = 'outbox_commands';",
        [],
      );
      expect(before).toHaveLength(2);
      expect(beforeSequence?.seq).toBe(20);

      await applyMigrations(database, migrations);

      const after = await readCommands(database);
      expect(after).toEqual(before);
      await applyMigrations(database, migrations);
      expect(await readCommands(database)).toEqual(before);
      expect(
        await database.getFirstAsync<{ sku: string; price_minor: number; server_version: number }>(
          'SELECT sku, price_minor, server_version FROM local_products WHERE store_id = ? AND id = ?;',
          [storeId, productId],
        ),
      ).toEqual({ sku: 'TEE-001', price_minor: 350000, server_version: 7 });
      expect(
        await database.getAllAsync<{ command_id: string; product_id: string }>(
          'SELECT command_id, product_id FROM outbox_commands ORDER BY local_sequence;',
          [],
        ),
      ).toEqual([
        { command_id: commandIds[0], product_id: productId },
        { command_id: commandIds[1], product_id: productId },
      ]);

      const m2Types = ['inventory.stock_in', 'inventory.adjust', 'sale.create'] as const;
      for (const [index, type] of m2Types.entries()) {
        await database.runAsync(
          `INSERT INTO outbox_commands (
            command_id, store_id, type, entity_id, product_id, payload_json, created_at
          ) VALUES (?, ?, ?, ?, NULL, ?, ?);`,
          [
            `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            storeId,
            type,
            `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            JSON.stringify({ protocol_version: 1 }),
            '2026-11-16T12:00:00.000Z',
          ],
        );
      }

      const appended = await database.getAllAsync<{ type: string; local_sequence: number }>(
        'SELECT type, local_sequence FROM outbox_commands WHERE command_id NOT IN (?, ?) ORDER BY local_sequence;',
        commandIds,
      );
      expect(appended.map(({ type }) => type)).toEqual(m2Types);
      expect(appended[0].local_sequence).toBeGreaterThan(20);

      const fkState = await database.getFirstAsync<{ foreign_keys: number }>(
        'PRAGMA foreign_keys;',
        [],
      );
      expect(fkState?.foreign_keys).toBe(1);
      expect(await database.getAllAsync('PRAGMA foreign_key_check;', [])).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('enforces same-store foreign keys inside the active write transaction', async () => {
    const database = new TestDatabase();
    try {
      await initializeDatabase(database);
      await expect(
        database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO local_stock_balances (store_id, product_id, updated_at)
             VALUES (?, ?, ?);`,
            [storeId, productId, '2026-11-16T12:00:00.000Z'],
          );
        }),
      ).rejects.toThrow(/foreign key/i);
      expect(
        await database.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM local_stock_balances;',
          [],
        ),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('rejects cross-store balance, sale-item, and movement links', async () => {
    const database = await createPopulatedM1Database();
    try {
      await applyMigrations(database, migrations);
      const otherStoreId = '60000000-0000-4000-8000-000000000001';
      const otherProductId = '70000000-0000-4000-8000-000000000001';
      const saleId = '80000000-0000-4000-8000-000000000001';

      await database.runAsync(
        `INSERT INTO local_store_identity (store_id, identity_kind, is_current, created_at)
         VALUES (?, 'local_demo', 0, ?);`,
        [otherStoreId, '2026-11-16T12:00:00.000Z'],
      );
      await database.runAsync(
        `INSERT INTO local_products (
          id, store_id, sku, sku_search, name, name_search, price_minor,
          low_stock_threshold, server_version, local_revision, sync_status,
          created_at, updated_at
        ) VALUES (?, ?, 'OTHER-001', 'other-001', 'Other Store Item', 'other store item',
          100, 0, 0, 1, 'pending', ?, ?);`,
        [otherProductId, otherStoreId, '2026-11-16T12:00:00.000Z', '2026-11-16T12:00:00.000Z'],
      );
      await database.runAsync(
        `INSERT INTO local_sales (
          id, store_id, checkout_request_id, payment_method, total_minor, occurred_at, created_at
        ) VALUES (?, ?, ?, 'cash', 1, ?, ?);`,
        [
          saleId,
          storeId,
          '90000000-0000-4000-8000-000000000001',
          '2026-11-16T12:00:00.000Z',
          '2026-11-16T12:00:00.000Z',
        ],
      );

      await expect(
        database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO local_stock_balances (store_id, product_id, updated_at)
             VALUES (?, ?, ?);`,
            [storeId, otherProductId, '2026-11-16T12:00:00.000Z'],
          );
        }),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO local_sale_items (
              store_id, sale_id, product_id, product_name_snapshot, sku_snapshot,
              quantity, unit_price_minor, line_total_minor
            ) VALUES (?, ?, ?, 'Other Store Item', 'OTHER-001', 1, 100, 100);`,
            [storeId, saleId, otherProductId],
          );
        }),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        database.withTransactionAsync(async () => {
          await database.runAsync(
            `INSERT INTO local_stock_movements (
              id, store_id, product_id, delta_quantity, kind, source_command_id, occurred_at
            ) VALUES (?, ?, ?, 1, 'stock_in', ?, ?);`,
            [
              'a0000000-0000-4000-8000-000000000001',
              storeId,
              otherProductId,
              commandIds[0],
              '2026-11-16T12:00:00.000Z',
            ],
          );
        }),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      database.close();
    }
  });

  it('protects committed sale and movement snapshots from edits and deletes', async () => {
    const database = await createPopulatedM1Database();
    try {
      await applyMigrations(database, migrations);
      const saleId = '80000000-0000-4000-8000-000000000001';
      const commandId = '90000000-0000-4000-8000-000000000001';
      await database.runAsync(
        `INSERT INTO local_sales (id, store_id, checkout_request_id, payment_method, total_minor, occurred_at, created_at)
         VALUES (?, ?, ?, 'cash', 100, ?, ?);`,
        [saleId, storeId, commandId, '2026-11-16T12:00:00.000Z', '2026-11-16T12:00:00.000Z'],
      );
      await database.runAsync(
        `INSERT INTO local_sale_items (store_id, sale_id, product_id, product_name_snapshot, sku_snapshot,
          quantity, unit_price_minor, line_total_minor) VALUES (?, ?, ?, 'Snapshot name', 'TEE-001', 1, 100, 100);`,
        [storeId, saleId, productId],
      );
      await database.runAsync(
        `INSERT INTO outbox_commands (command_id, store_id, type, entity_id, payload_json, created_at)
         VALUES (?, ?, 'sale.create', ?, '{}', ?);`,
        [commandId, storeId, saleId, '2026-11-16T12:00:00.000Z'],
      );
      await database.runAsync(
        `INSERT INTO local_stock_movements (id, store_id, product_id, delta_quantity, kind, sale_id,
          source_command_id, occurred_at) VALUES (?, ?, ?, -1, 'sale', ?, ?, ?);`,
        [
          'a0000000-0000-4000-8000-000000000001',
          storeId,
          productId,
          saleId,
          commandId,
          '2026-11-16T12:00:00.000Z',
        ],
      );

      await expect(
        database.runAsync('DELETE FROM local_sales WHERE id = ?;', [saleId]),
      ).rejects.toThrow(/immutable/);
      await expect(
        database.runAsync('UPDATE local_sales SET total_minor = 200 WHERE id = ?;', [saleId]),
      ).rejects.toThrow(/immutable/);
      await expect(
        database.runAsync('DELETE FROM local_sale_items WHERE sale_id = ?;', [saleId]),
      ).rejects.toThrow(/immutable/);
      await expect(
        database.runAsync('UPDATE local_sale_items SET unit_price_minor = 200 WHERE sale_id = ?;', [
          saleId,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        database.runAsync('DELETE FROM local_stock_movements WHERE sale_id = ?;', [saleId]),
      ).rejects.toThrow(/immutable/);
      await expect(
        database.runAsync(
          'UPDATE local_stock_movements SET delta_quantity = -2 WHERE sale_id = ?;',
          [saleId],
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        database.runAsync('UPDATE outbox_commands SET payload_json = ? WHERE command_id = ?;', [
          '{"changed":true}',
          commandId,
        ]),
      ).rejects.toThrow(/immutable/);
      await database.runAsync("UPDATE local_sales SET status = 'confirmed' WHERE id = ?;", [
        saleId,
      ]);
      await expect(
        database.runAsync("UPDATE local_sales SET status = 'pending' WHERE id = ?;", [saleId]),
      ).rejects.toThrow(/immutable/);
    } finally {
      database.close();
    }
  });

  it('rolls back the outbox rebuild, schema creation, and version on migration failure', async () => {
    const database = await createPopulatedM1Database();
    try {
      const before = await readCommands(database);
      const failedMigration: DatabaseMigration = {
        ...inventorySalesMigration,
        async up(connection) {
          await inventorySalesMigration.up(connection);
          throw new Error('Injected M2 schema migration failure.');
        },
      };

      await expect(
        applyMigrations(database, [...migrations.slice(0, 4), failedMigration]),
      ).rejects.toThrow('Injected M2 schema migration failure.');

      expect(await readCommands(database)).toEqual(before);
      expect(
        await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;', []),
      ).toEqual({ user_version: 3 });
      expect(
        await database.getFirstAsync<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_sales';`,
          [],
        ),
      ).toBeNull();
      expect(
        await database.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys;', []),
      ).toEqual({ foreign_keys: 1 });
    } finally {
      database.close();
    }
  });
});

async function createPopulatedM1Database(): Promise<SQLiteTestDatabase> {
  const database = new TestDatabase();
  await database.execAsync('PRAGMA foreign_keys = ON;');
  await applyMigrations(database, migrations.slice(0, 3));
  await ensureLocalDemoStoreIdentity(
    database,
    () => storeId,
    () => '2026-11-16T12:00:00.000Z',
  );
  await database.runAsync(
    `INSERT INTO local_products (
      id, store_id, sku, sku_search, name, name_search, description, category,
      price_minor, cost_minor, low_stock_threshold, server_version, local_revision,
      sync_status, created_at, updated_at, deleted_at
    ) VALUES (?, ?, 'TEE-001', 'tee-001', 'Basic Cotton Top', 'basic cotton top', NULL, NULL,
      350000, NULL, 3, 7, 2, 'pending', ?, ?, NULL);`,
    [productId, storeId, '2026-11-16T12:00:00.000Z', '2026-11-16T12:00:00.000Z'],
  );
  await insertLegacyCommand(database, {
    localSequence: 4,
    commandId: commandIds[0],
    type: 'product.create',
    dependency: null,
    payload: '{"protocol_version":1,"payload":{"local_revision":1}}',
  });
  await insertLegacyCommand(database, {
    localSequence: 9,
    commandId: commandIds[1],
    type: 'product.update',
    dependency: commandIds[0],
    payload: '{"protocol_version":1,"payload":{"local_revision":2}}',
  });
  await insertLegacyCommand(database, {
    localSequence: 20,
    commandId: '30000000-0000-4000-8000-000000000003',
    type: 'product.delete',
    dependency: commandIds[0],
    payload: '{"protocol_version":1,"payload":{"local_revision":3}}',
  });
  await database.runAsync('DELETE FROM outbox_commands WHERE local_sequence = 20;', []);
  return database;
}

async function insertLegacyCommand(
  database: SQLiteTestDatabase,
  command: {
    localSequence: number;
    commandId: string;
    type: string;
    dependency: string | null;
    payload: string;
  },
): Promise<void> {
  await database.runAsync(
    `INSERT INTO outbox_commands (
      local_sequence, command_id, store_id, type, entity_id, payload_json,
      expected_server_version, depends_on_command_id, status, attempts,
      next_attempt_at, last_error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'pending', 0, NULL, NULL, ?);`,
    [
      command.localSequence,
      command.commandId,
      storeId,
      command.type,
      productId,
      command.payload,
      command.dependency,
      '2026-11-16T12:00:00.000Z',
    ],
  );
}

function readCommands(database: SQLiteTestDatabase): Promise<ExistingCommand[]> {
  return database.getAllAsync<ExistingCommand>(
    `SELECT local_sequence, command_id, type, entity_id, payload_json,
      expected_server_version, depends_on_command_id, status, attempts,
      next_attempt_at, last_error, created_at
     FROM outbox_commands ORDER BY local_sequence;`,
    [],
  );
}
