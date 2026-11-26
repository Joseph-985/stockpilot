import type { ProductDraft } from '@/features/products/domain/product';
import { ProductDraftSchema } from '@/features/products/domain/validation';
import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { SQLiteInventoryRepository } from '@/shared/infrastructure/db/repositories/SQLiteInventoryRepository';
import { SQLiteProductRepository } from '@/shared/infrastructure/db/repositories/SQLiteProductRepository';
import { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({
  randomUUID: () => '20000000-0000-4000-8000-000000000001',
}));

const storeId = '20000000-0000-4000-8000-000000000001';
const otherStoreId = '30000000-0000-4000-8000-000000000001';

function draft(overrides: Partial<ProductDraft> = {}) {
  return ProductDraftSchema.parse({
    sku: 'TEE-001',
    name: 'Basic Cotton Top',
    description: null,
    category: 'Clothing',
    price: '3500.00',
    cost: null,
    lowStockThreshold: 3,
    ...overrides,
  });
}

describe('SQLiteInventoryRepository', () => {
  let database: SQLiteTestDatabase;
  let products: SQLiteProductRepository;
  let inventory: SQLiteInventoryRepository;
  let id: number;

  beforeEach(async () => {
    database = new SQLiteTestDatabase();
    await initializeDatabase(database);
    id = 0;
    products = new SQLiteProductRepository(database, {
      createId: nextId,
      now: () => timestamp,
    });
    inventory = new SQLiteInventoryRepository(database, {
      createId: nextId,
      now: () => timestamp,
    });
  });

  afterEach(() => database.close());

  it('stocks in positive integer units with one movement and one ordered pending command', async () => {
    const product = await products.create(storeId, draft());
    const result = await inventory.stockIn({
      storeId,
      productId: product.id,
      quantity: 20,
      note: 'Opening stock',
    });
    const rows = await database.getAllAsync<{
      type: string;
      entity_id: string;
      local_sequence: number;
      command_id: string;
    }>(
      `SELECT type, entity_id, local_sequence, command_id FROM outbox_commands WHERE type LIKE 'inventory.%' ORDER BY local_sequence;`,
      [],
    );
    const movements = await inventory.listMovements(storeId, product.id);

    expect(result).toMatchObject({
      status: 'success',
      balance: { baseQuantity: 0, pendingDelta: 20, estimatedAvailable: 20 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'inventory.stock_in',
      entity_id: movements[0].id,
    });
    expect(movements).toMatchObject([
      {
        deltaQuantity: 20,
        kind: 'stock_in',
        reason: 'Opening stock',
        syncStatus: 'pending',
      },
    ]);
    expect(await inventory.listBalances(storeId)).toMatchObject([
      { productId: product.id, estimatedAvailable: 20 },
    ]);
  });

  it('applies signed adjustments and rejects zero, fractional, unsafe or insufficient deltas without writes', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({
      storeId,
      productId: product.id,
      quantity: 20,
      note: null,
    });
    const result = await inventory.adjustStock({
      storeId,
      productId: product.id,
      deltaQuantity: -1,
      reason: 'Damaged item',
    });
    expect(result).toMatchObject({
      status: 'success',
      balance: { estimatedAvailable: 19 },
    });

    for (const deltaQuantity of [0, 1.2, Number.MAX_SAFE_INTEGER + 1, -20]) {
      const invalid = await inventory.adjustStock({
        storeId,
        productId: product.id,
        deltaQuantity,
        reason: 'Invalid attempt',
      });
      expect(['validation_error', 'insufficient_stock']).toContain(invalid.status);
    }
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 19,
      pendingDelta: 19,
    });
    expect(await count('local_stock_movements')).toBe(2);
    expect(await count('outbox_commands')).toBe(3);
    expect(
      await database.getAllAsync<{ type: string; local_sequence: number; command_id: string }>(
        `SELECT type, local_sequence, command_id FROM outbox_commands ORDER BY local_sequence;`,
        [],
      ),
    ).toEqual([
      { type: 'product.create', local_sequence: 1, command_id: expect.any(String) },
      { type: 'inventory.stock_in', local_sequence: 2, command_id: expect.any(String) },
      { type: 'inventory.adjust', local_sequence: 3, command_id: expect.any(String) },
    ]);
  });

  it('rejects archived products and products outside the requested store', async () => {
    await database.runAsync(
      `INSERT INTO local_store_identity (store_id, identity_kind, is_current, created_at) VALUES (?, 'local_demo', 0, ?);`,
      [otherStoreId, timestamp],
    );
    const product = await products.create(otherStoreId, draft());
    expect(
      await inventory.stockIn({
        storeId,
        productId: product.id,
        quantity: 2,
        note: null,
      }),
    ).toEqual({ status: 'product_unavailable' });
    await products.archive(otherStoreId, product.id);
    expect(
      await inventory.adjustStock({
        storeId: otherStoreId,
        productId: product.id,
        deltaQuantity: 1,
        reason: 'Found stock',
      }),
    ).toEqual({ status: 'product_unavailable' });
    expect(await count('local_stock_movements')).toBe(0);
    expect(await count('outbox_commands')).toBe(2);
  });

  it('rolls back balance and movement when outbox insertion fails', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 8, note: null });
    await database.execAsync(`
      CREATE TRIGGER fail_inventory_outbox BEFORE INSERT ON outbox_commands
      WHEN NEW.type IN ('inventory.stock_in', 'inventory.adjust')
      BEGIN SELECT RAISE(ABORT, 'injected inventory outbox failure'); END;
    `);

    await expect(
      inventory.adjustStock({
        storeId,
        productId: product.id,
        deltaQuantity: -2,
        reason: 'Rollback check',
      }),
    ).resolves.toMatchObject({ status: 'persistence_failure' });
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      pendingDelta: 8,
      estimatedAvailable: 8,
    });
    expect(await count('local_stock_movements')).toBe(1);
    expect(await count('outbox_commands')).toBe(2);
  });

  it('rolls back the balance and outbox command when movement insertion fails', async () => {
    const product = await products.create(storeId, draft());
    await database.execAsync(`
      CREATE TRIGGER fail_movement_insert BEFORE INSERT ON local_stock_movements
      BEGIN SELECT RAISE(ABORT, 'injected movement failure'); END;
    `);

    await expect(
      inventory.stockIn({ storeId, productId: product.id, quantity: 4, note: null }),
    ).resolves.toMatchObject({ status: 'persistence_failure' });
    expect(await count('local_stock_balances')).toBe(0);
    expect(await count('local_stock_movements')).toBe(0);
    expect(await count('outbox_commands')).toBe(1);
  });

  it('serializes overlapping adjustments on the shared native SQLite connection', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({
      storeId,
      productId: product.id,
      quantity: 1,
      note: null,
    });
    const secondRepository = new SQLiteInventoryRepository(database, {
      createId: nextId,
      now: () => timestamp,
    });
    const results = await Promise.all([
      inventory.adjustStock({
        storeId,
        productId: product.id,
        deltaQuantity: -1,
        reason: 'Sale loss',
      }),
      secondRepository.adjustStock({
        storeId,
        productId: product.id,
        deltaQuantity: -1,
        reason: 'Breakage',
      }),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['insufficient_stock', 'success']);
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 0,
      pendingDelta: 0,
      hasPendingChanges: true,
    });
    expect(await count('local_stock_movements')).toBe(2);
    expect(await count('outbox_commands')).toBe(3);
  });

  it('keeps user-provided audit text parameterized and preserves command dependency order', async () => {
    const product = await products.create(storeId, draft());
    const malicious = "Damaged'); DROP TABLE local_stock_movements;--";
    const result = await inventory.adjustStock({
      storeId,
      productId: product.id,
      deltaQuantity: 1,
      reason: malicious,
    });
    expect(result).toMatchObject({ status: 'success' });
    expect(await inventory.listMovements(storeId, product.id)).toMatchObject([
      { reason: malicious },
    ]);
    const commands = await database.getAllAsync<{
      type: string;
      depends_on_command_id: string | null;
      local_sequence: number;
    }>(
      `SELECT type, depends_on_command_id, local_sequence FROM outbox_commands ORDER BY local_sequence;`,
      [],
    );
    expect(commands.map(({ type }) => type)).toEqual(['product.create', 'inventory.adjust']);
    expect(commands[1].depends_on_command_id).not.toBeNull();
    expect(commands[1].local_sequence).toBeGreaterThan(commands[0].local_sequence);
    expect(await count('local_stock_movements')).toBe(1);
  });

  async function count(
    table: 'local_stock_balances' | 'local_stock_movements' | 'outbox_commands',
  ) {
    const result = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table};`,
      [],
    );
    return result?.count ?? 0;
  }

  function nextId() {
    id += 1;
    return `40000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  }
});

const timestamp = '2026-11-16T10:00:00.000Z';
