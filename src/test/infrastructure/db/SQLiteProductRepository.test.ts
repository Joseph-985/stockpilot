import { randomUUID } from 'expo-crypto';
import type { ProductDraft } from '@/features/products/domain/product';
import { ProductDraftSchema } from '@/features/products/domain/validation';
import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { SQLiteProductRepository } from '@/shared/infrastructure/db/repositories/SQLiteProductRepository';
import { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '20000000-0000-4000-8000-000000000001'),
}));

const storeId = '20000000-0000-4000-8000-000000000001';
const otherStoreId = '30000000-0000-4000-8000-000000000001';

function draft(overrides: Partial<ProductDraft> = {}) {
  return ProductDraftSchema.parse({
    sku: 'TEE-001',
    name: 'Basic Cotton Top',
    description: null,
    category: 'Clothing',
    price: '3500.50',
    cost: null,
    lowStockThreshold: 3,
    ...overrides,
  });
}

describe('SQLiteProductRepository', () => {
  let database: SQLiteTestDatabase;
  let idSequence: number;
  let timestampSequence: number;
  let repository: SQLiteProductRepository;

  beforeEach(async () => {
    database = new SQLiteTestDatabase();
    idSequence = 0;
    timestampSequence = 0;
    await initializeDatabase(database);
    repository = makeRepository();
  });

  afterEach(() => {
    database.close();
  });

  it('creates one product and one immutable create command', async () => {
    const created = await repository.create(storeId, draft());
    const commands = await readCommands();
    const payload = JSON.parse(commands[0].payload_json) as {
      protocol_version: number;
      payload: { id: string; price_minor: number; local_revision: number };
    };

    expect(created).toMatchObject({
      storeId,
      sku: 'TEE-001',
      priceMinor: 350050,
      costMinor: null,
      localRevision: 1,
      serverVersion: 0,
      syncStatus: 'pending',
      deletedAt: null,
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: 'product.create',
      entity_id: created.id,
      expected_server_version: null,
      depends_on_command_id: null,
      local_sequence: 1,
    });
    expect(payload).toEqual({
      protocol_version: 1,
      payload: expect.objectContaining({
        id: created.id,
        price_minor: 350050,
        local_revision: 1,
      }),
    });
  });

  it('generates separate UUIDv4 identities for the product and its stable command', async () => {
    jest
      .mocked(randomUUID)
      .mockReset()
      .mockImplementation(() => '20000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('50000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('60000000-0000-4000-8000-000000000001');
    const defaultRepository = new SQLiteProductRepository(database);

    const product = await defaultRepository.create(storeId, draft());
    const command = (await readCommands())[0];

    expect(jest.mocked(randomUUID)).toHaveBeenCalledTimes(2);
    expect(product.id).toBe('50000000-0000-4000-8000-000000000001');
    expect(command.command_id).toBe('60000000-0000-4000-8000-000000000001');
    expect(command.command_id).not.toBe(product.id);
  });

  it('rolls back the product when the outbox insert fails', async () => {
    await database.execAsync(`
      CREATE TRIGGER fail_outbox_insert
      BEFORE INSERT ON outbox_commands
      BEGIN
        SELECT RAISE(ABORT, 'injected outbox failure');
      END;
    `);

    await expect(repository.create(storeId, draft())).rejects.toThrow('injected outbox failure');
    expect(await countRows('local_products')).toBe(0);
    expect(await countRows('outbox_commands')).toBe(0);
  });

  it('rolls back update and archive changes when their outbox inserts fail', async () => {
    const created = await repository.create(storeId, draft());
    await database.execAsync(`
      CREATE TRIGGER fail_outbox_insert
      BEFORE INSERT ON outbox_commands
      BEGIN
        SELECT RAISE(ABORT, 'injected outbox failure');
      END;
    `);

    await expect(
      repository.update(storeId, created.id, draft({ price: '3800.00' })),
    ).rejects.toThrow('injected outbox failure');
    await expect(repository.archive(storeId, created.id)).rejects.toThrow(
      'injected outbox failure',
    );

    expect(await repository.getById(storeId, created.id)).toMatchObject({
      priceMinor: 350050,
      localRevision: 1,
      deletedAt: null,
    });
    expect(await countRows('outbox_commands')).toBe(1);
  });

  it('rejects active SKUs case-insensitively and permits reuse after archive', async () => {
    const product = await repository.create(storeId, draft({ sku: 'tee-001' }));

    await expect(repository.create(storeId, draft({ sku: 'TEE-001' }))).rejects.toMatchObject({
      code: 'duplicate_sku',
    });
    await repository.archive(storeId, product.id);
    const replacement = await repository.create(storeId, draft({ sku: 'tee-001' }));

    expect(replacement.sku).toBe('TEE-001');
    expect(await countRows('local_products')).toBe(2);
    expect(await countRows('outbox_commands')).toBe(3);
  });

  it('keeps create and successive edit/archive commands ordered with immutable snapshots', async () => {
    const created = await repository.create(storeId, draft());
    const firstEdit = await repository.update(storeId, created.id, draft({ price: '3800.00' }));
    const secondEdit = await repository.update(storeId, created.id, draft({ price: '3900.25' }));
    const archived = await repository.archive(storeId, created.id);
    const commands = await readCommands();
    const snapshots = commands.map(
      (command) =>
        JSON.parse(command.payload_json) as {
          payload: { price_minor: number; local_revision: number };
        },
    );

    expect(commands.map((command) => command.type)).toEqual([
      'product.create',
      'product.update',
      'product.update',
      'product.delete',
    ]);
    expect(commands.map((command) => command.local_sequence)).toEqual([1, 2, 3, 4]);
    expect(new Set(commands.map((command) => command.command_id)).size).toBe(4);
    expect(
      commands
        .slice(1)
        .every((command) => command.depends_on_command_id === commands[0].command_id),
    ).toBe(true);
    expect(snapshots.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ price_minor: 350050, local_revision: 1 }),
      expect.objectContaining({ price_minor: 380000, local_revision: 2 }),
      expect.objectContaining({ price_minor: 390025, local_revision: 3 }),
      expect.objectContaining({ price_minor: 390025, local_revision: 4 }),
    ]);
    expect([firstEdit.localRevision, secondEdit.localRevision, archived.localRevision]).toEqual([
      2, 3, 4,
    ]);
    expect(archived.serverVersion).toBe(created.serverVersion);
    expect(await repository.getById(storeId, created.id)).toBeNull();
    expect(await repository.getById(storeId, created.id, { includeArchived: true })).toMatchObject({
      deletedAt: expect.any(String),
      localRevision: 4,
    });
  });

  it('preserves a server version and records it as the update precondition', async () => {
    const created = await repository.create(storeId, draft());
    await database.runAsync(
      `UPDATE local_products SET server_version = 8, sync_status = 'synced' WHERE id = ?;`,
      [created.id],
    );
    await database.runAsync(
      `UPDATE outbox_commands SET status = 'acknowledged' WHERE entity_id = ?;`,
      [created.id],
    );

    const updated = await repository.update(storeId, created.id, draft({ price: '3600.00' }));
    const commands = await readCommands();

    expect(updated.serverVersion).toBe(8);
    expect(commands[1].expected_server_version).toBe(8);
    expect(commands[1].depends_on_command_id).toBeNull();
  });

  it('keeps list/search/getById scoped to the requested store', async () => {
    await database.runAsync(
      `INSERT INTO local_store_identity (store_id, identity_kind, is_current, created_at)
       VALUES (?, 'local_demo', 0, ?);`,
      [otherStoreId, '2026-01-01T00:00:00.000Z'],
    );
    const storeAProduct = await repository.create(storeId, draft({ sku: 'A-001' }));
    const storeBProduct = await repository.create(otherStoreId, draft({ sku: 'B-001' }));

    expect(await repository.list(storeId)).toMatchObject([{ id: storeAProduct.id }]);
    expect(await repository.list(storeId, { query: 'b-001' })).toEqual([]);
    expect(await repository.getById(storeId, storeBProduct.id)).toBeNull();
    await expect(
      repository.update(storeId, storeBProduct.id, draft({ sku: 'B-002' })),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(repository.archive(storeId, storeBProduct.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await repository.getById(otherStoreId, storeBProduct.id)).toMatchObject({
      deletedAt: null,
      localRevision: 1,
    });
  });

  it('uses parameterized values for SQL-like product names and SKUs', async () => {
    const product = await repository.create(
      storeId,
      draft({
        name: "Basic Top'); DROP TABLE local_products;--",
        sku: "SKU'); DROP TABLE outbox_commands;--",
      }),
    );

    expect(await repository.getById(storeId, product.id)).toMatchObject({
      name: "Basic Top'); DROP TABLE local_products;--",
      sku: "SKU'); DROP TABLE OUTBOX_COMMANDS;--",
    });
    expect(await repository.list(storeId, { query: 'DROP TABLE OUTBOX_COMMANDS;--' })).toHaveLength(
      1,
    );
    expect(await countRows('local_products')).toBe(1);
    expect(await countRows('outbox_commands')).toBe(1);
  });

  it('matches Unicode names case-insensitively and normalizes canonical equivalents', async () => {
    const product = await repository.create(
      storeId,
      draft({ name: 'Straße Café', sku: 'UNICODE-001' }),
    );

    expect(await repository.list(storeId, { query: 'STRASSE' })).toMatchObject([
      { id: product.id },
    ]);
    expect(await repository.list(storeId, { query: 'cafe\u0301' })).toMatchObject([
      { id: product.id },
    ]);
  });

  it('serializes overlapping writers that share the same database connection', async () => {
    const secondRepository = makeRepository();
    const results = await Promise.allSettled([
      repository.create(storeId, draft({ sku: 'CONCURRENT-1' })),
      secondRepository.create(storeId, draft({ sku: 'concurrent-1' })),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'duplicate_sku' },
    });
    expect(await countRows('local_products')).toBe(1);
    expect(await countRows('outbox_commands')).toBe(1);
  });

  function makeRepository() {
    return new SQLiteProductRepository(database, {
      createId: () => {
        idSequence += 1;
        return `10000000-0000-4000-8000-${String(idSequence).padStart(12, '0')}`;
      },
      now: () => {
        timestampSequence += 1;
        return new Date(Date.UTC(2026, 0, 1, 0, 0, timestampSequence)).toISOString();
      },
    });
  }

  async function readCommands() {
    return database.getAllAsync<{
      local_sequence: number;
      command_id: string;
      type: string;
      entity_id: string;
      payload_json: string;
      expected_server_version: number | null;
      depends_on_command_id: string | null;
    }>(
      `SELECT local_sequence, command_id, type, entity_id, payload_json,
        expected_server_version, depends_on_command_id
       FROM outbox_commands
       WHERE store_id = ?
       ORDER BY local_sequence ASC;`,
      [storeId],
    );
  }

  async function countRows(table: 'local_products' | 'outbox_commands') {
    const result = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table};`,
      [],
    );
    return result?.count ?? 0;
  }
});
