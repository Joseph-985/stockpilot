import type { ProductDraft } from '@/features/products/domain/product';
import { ProductDraftSchema } from '@/features/products/domain/validation';
import { createSale } from '@/features/sales/application/saleUseCases';
import type { CheckoutInput } from '@/features/sales/domain/sale';
import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { SQLiteInventoryRepository } from '@/shared/infrastructure/db/repositories/SQLiteInventoryRepository';
import { SQLiteProductRepository } from '@/shared/infrastructure/db/repositories/SQLiteProductRepository';
import { SQLiteSaleRepository } from '@/shared/infrastructure/db/repositories/SQLiteSaleRepository';
import { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({ randomUUID: () => '20000000-0000-4000-8000-000000000001' }));

const storeId = '20000000-0000-4000-8000-000000000001';
const otherStoreId = '30000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-16T10:00:00.000Z';

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

describe('SQLiteSaleRepository', () => {
  let database: SQLiteTestDatabase;
  let products: SQLiteProductRepository;
  let inventory: SQLiteInventoryRepository;
  let sales: SQLiteSaleRepository;
  let id: number;

  beforeEach(async () => {
    database = new SQLiteTestDatabase();
    await initializeDatabase(database);
    id = 0;
    products = new SQLiteProductRepository(database, { createId: nextId, now: () => timestamp });
    inventory = new SQLiteInventoryRepository(database, { createId: nextId, now: () => timestamp });
    sales = new SQLiteSaleRepository(database, { createId: nextId, now: () => timestamp });
  });

  afterEach(() => database.close());

  it('atomically saves a multi-item sale, stock deductions, snapshots and one sale command', async () => {
    const first = await products.create(storeId, draft());
    const second = await products.create(
      storeId,
      draft({ sku: 'CAP-001', name: 'Cotton Cap', price: '1250.00' }),
    );
    await inventory.stockIn({ storeId, productId: first.id, quantity: 5, note: null });
    await inventory.stockIn({ storeId, productId: second.id, quantity: 7, note: null });

    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000001', [
        { productId: first.id, quantity: 2, expectedUnitPriceMinor: first.priceMinor },
        { productId: second.id, quantity: 3, expectedUnitPriceMinor: second.priceMinor },
      ]),
    );
    expect(result).toMatchObject({
      status: 'success',
      sale: { totalMinor: 1075000, status: 'pending', paymentMethod: 'cash' },
    });
    if (result.status !== 'success') throw new Error('Expected the sale to commit.');
    expect(result.sale.items).toMatchObject([
      {
        productId: first.id,
        productNameSnapshot: 'Basic Cotton Top',
        skuSnapshot: 'TEE-001',
        quantity: 2,
        unitPriceMinor: 350000,
        lineTotalMinor: 700000,
      },
      {
        productId: second.id,
        productNameSnapshot: 'Cotton Cap',
        skuSnapshot: 'CAP-001',
        quantity: 3,
        unitPriceMinor: 125000,
        lineTotalMinor: 375000,
      },
    ]);
    expect(await inventory.getBalance(storeId, first.id)).toMatchObject({
      estimatedAvailable: 3,
      pendingDelta: 3,
      hasPendingChanges: true,
    });
    expect(await inventory.getBalance(storeId, second.id)).toMatchObject({
      estimatedAvailable: 4,
      pendingDelta: 4,
      hasPendingChanges: true,
    });
    expect(await count('local_sales')).toBe(1);
    expect(await count('local_sale_items')).toBe(2);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(2);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(1);
    expect(await count('outbox_commands', "type = 'inventory.adjust'")).toBe(0);
    const saleCommand = await database.getFirstAsync<{ command_id: string; payload_json: string }>(
      `SELECT command_id, payload_json FROM outbox_commands WHERE type = 'sale.create' LIMIT 1;`,
      [],
    );
    expect(JSON.parse(saleCommand?.payload_json ?? '{}')).toMatchObject({
      command_id: saleCommand?.command_id,
      type: 'sale.create',
      payload: {
        sale_id: result.sale.id,
        checkout_request_id: result.sale.checkoutRequestId,
        total_minor: 1075000,
        items: expect.arrayContaining([
          expect.objectContaining({
            product_id: first.id,
            product_name_snapshot: 'Basic Cotton Top',
            unit_price_minor: 350000,
          }),
          expect.objectContaining({
            product_id: second.id,
            product_name_snapshot: 'Cotton Cap',
            unit_price_minor: 125000,
          }),
        ]),
      },
    });
    expect(
      await database.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys;', []),
    ).toEqual({ foreign_keys: 1 });
  });

  it('coalesces duplicate cart lines and calculates the combined total exactly', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 10, note: null });
    const request = input('50000000-0000-4000-8000-000000000002', [
      { productId: product.id, quantity: 2, expectedUnitPriceMinor: product.priceMinor },
      { productId: product.id, quantity: 3, expectedUnitPriceMinor: product.priceMinor },
    ]);

    const result = await createSale(sales, request);
    expect(result).toMatchObject({
      status: 'success',
      sale: { totalMinor: 1750000, items: [{ quantity: 5, lineTotalMinor: 1750000 }] },
    });
    expect(await count('local_sale_items')).toBe(1);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(1);
  });

  it('returns the committed sale for a repeated stable checkout request without a second command', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 4, note: null });
    const checkout = input('50000000-0000-4000-8000-000000000003', [
      { productId: product.id, quantity: 2, expectedUnitPriceMinor: product.priceMinor },
    ]);
    const first = await sales.create(checkout);
    const commandBefore = await database.getFirstAsync<{ command_id: string }>(
      `SELECT command_id FROM outbox_commands WHERE type = 'sale.create' LIMIT 1;`,
      [],
    );
    const replay = await sales.create({ ...checkout, customerName: 'Changed replay body' });
    const commandAfter = await database.getFirstAsync<{ command_id: string }>(
      `SELECT command_id FROM outbox_commands WHERE type = 'sale.create' LIMIT 1;`,
      [],
    );

    expect(first.status).toBe('success');
    expect(replay).toMatchObject({ status: 'duplicate_attempt' });
    if (first.status !== 'success' || replay.status !== 'duplicate_attempt')
      throw new Error('Expected original and replay results.');
    expect(replay.sale).toEqual(first.sale);
    expect(commandAfter?.command_id).toBe(commandBefore?.command_id);
    expect(await count('local_sales')).toBe(1);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(1);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(1);
  });

  it('allows a different checkout request when estimated stock remains available', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 3, note: null });
    const first = await sales.create(
      input('50000000-0000-4000-8000-000000000004', [
        { productId: product.id, quantity: 1, expectedUnitPriceMinor: product.priceMinor },
      ]),
    );
    const second = await sales.create(
      input('50000000-0000-4000-8000-000000000005', [
        { productId: product.id, quantity: 1, expectedUnitPriceMinor: product.priceMinor },
      ]),
    );
    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    expect(await count('local_sales')).toBe(2);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(2);
  });

  it('blocks a stale reviewed price and preserves stock and sale tables', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 5, note: null });
    await products.update(storeId, product.id, draft({ price: '3600.00' }));
    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000006', [
        { productId: product.id, quantity: 2, expectedUnitPriceMinor: 350000 },
      ]),
    );

    expect(result).toEqual({
      status: 'price_changed',
      productId: product.id,
      expectedUnitPriceMinor: 350000,
      currentUnitPriceMinor: 360000,
    });
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 5,
    });
    expect(await count('local_sales')).toBe(0);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(0);
  });

  it('rejects unavailable products and insufficient stock without partial changes', async () => {
    await database.runAsync(
      `INSERT INTO local_store_identity (store_id, identity_kind, is_current, created_at) VALUES (?, 'local_demo', 0, ?);`,
      [otherStoreId, timestamp],
    );
    const active = await products.create(storeId, draft());
    const otherStoreProduct = await products.create(otherStoreId, draft({ sku: 'OTHER-001' }));
    await inventory.stockIn({ storeId, productId: active.id, quantity: 1, note: null });

    expect(
      await sales.create(
        input('50000000-0000-4000-8000-000000000007', [
          {
            productId: otherStoreProduct.id,
            quantity: 1,
            expectedUnitPriceMinor: otherStoreProduct.priceMinor,
          },
        ]),
      ),
    ).toMatchObject({ status: 'product_unavailable', productId: otherStoreProduct.id });
    await products.archive(storeId, active.id);
    expect(
      await sales.create(
        input('50000000-0000-4000-8000-000000000008', [
          { productId: active.id, quantity: 1, expectedUnitPriceMinor: active.priceMinor },
        ]),
      ),
    ).toMatchObject({ status: 'product_unavailable', productId: active.id });
    expect(await count('local_sales')).toBe(0);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(0);

    const second = await products.create(
      storeId,
      draft({ sku: 'SECOND-001', name: 'Second product' }),
    );
    expect(
      await sales.create(
        input('50000000-0000-4000-8000-000000000016', [
          { productId: second.id, quantity: 1, expectedUnitPriceMinor: second.priceMinor },
        ]),
      ),
    ).toMatchObject({
      status: 'insufficient_stock',
      productId: second.id,
      requestedQuantity: 1,
      estimatedAvailable: 0,
    });
  });

  it('rolls back header and item writes when the sale outbox insert fails', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 5, note: null });
    await database.execAsync(`
      CREATE TRIGGER fail_sale_outbox BEFORE INSERT ON outbox_commands
      WHEN NEW.type = 'sale.create'
      BEGIN SELECT RAISE(ABORT, 'injected sale outbox failure'); END;
    `);

    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000009', [
        { productId: product.id, quantity: 2, expectedUnitPriceMinor: product.priceMinor },
      ]),
    );
    expect(result).toMatchObject({ status: 'persistence_failure' });
    expect(await count('local_sales')).toBe(0);
    expect(await count('local_sale_items')).toBe(0);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(0);
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 5,
    });
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(0);
  });

  it('rolls back every write when a sale item insert fails', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 5, note: null });
    await database.execAsync(`
      CREATE TRIGGER fail_sale_item BEFORE INSERT ON local_sale_items
      BEGIN SELECT RAISE(ABORT, 'injected sale item failure'); END;
    `);

    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000017', [
        { productId: product.id, quantity: 2, expectedUnitPriceMinor: product.priceMinor },
      ]),
    );
    expect(result).toMatchObject({ status: 'persistence_failure' });
    expect(await count('local_sales')).toBe(0);
    expect(await count('local_sale_items')).toBe(0);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(0);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(0);
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 5,
    });
  });

  it('rolls back sale, items, command and projection when movement insertion fails', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 5, note: null });
    await database.execAsync(`
      CREATE TRIGGER fail_sale_movement BEFORE INSERT ON local_stock_movements
      WHEN NEW.kind = 'sale'
      BEGIN SELECT RAISE(ABORT, 'injected sale movement failure'); END;
    `);

    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000010', [
        { productId: product.id, quantity: 2, expectedUnitPriceMinor: product.priceMinor },
      ]),
    );
    expect(result).toMatchObject({ status: 'persistence_failure' });
    expect(await count('local_sales')).toBe(0);
    expect(await count('local_sale_items')).toBe(0);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(0);
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 5,
    });
  });

  it('rolls back every write when a later product decrement fails', async () => {
    const first = await products.create(storeId, draft());
    const second = await products.create(storeId, draft({ sku: 'CAP-001', name: 'Cotton Cap' }));
    await inventory.stockIn({ storeId, productId: first.id, quantity: 5, note: null });
    await inventory.stockIn({ storeId, productId: second.id, quantity: 5, note: null });
    await database.execAsync(`
      CREATE TRIGGER fail_second_sale_decrement BEFORE UPDATE ON local_stock_balances
      WHEN OLD.product_id = '${second.id}'
      BEGIN SELECT RAISE(ABORT, 'injected later balance failure'); END;
    `);

    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000011', [
        { productId: first.id, quantity: 1, expectedUnitPriceMinor: first.priceMinor },
        { productId: second.id, quantity: 1, expectedUnitPriceMinor: second.priceMinor },
      ]),
    );
    expect(result).toMatchObject({ status: 'persistence_failure' });
    expect(await count('local_sales')).toBe(0);
    expect(await count('local_sale_items')).toBe(0);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(0);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(0);
    expect(await inventory.getBalance(storeId, first.id)).toMatchObject({ estimatedAvailable: 5 });
    expect(await inventory.getBalance(storeId, second.id)).toMatchObject({ estimatedAvailable: 5 });
  });

  it('serializes overlapping last-unit checkouts so only one sale commits', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 1, note: null });
    const secondRepository = new SQLiteSaleRepository(database, {
      createId: nextId,
      now: () => timestamp,
    });
    const requests = [
      input('50000000-0000-4000-8000-000000000012', [
        { productId: product.id, quantity: 1, expectedUnitPriceMinor: product.priceMinor },
      ]),
      input('50000000-0000-4000-8000-000000000013', [
        { productId: product.id, quantity: 1, expectedUnitPriceMinor: product.priceMinor },
      ]),
    ];
    const results = await Promise.all([
      sales.create(requests[0]),
      secondRepository.create(requests[1]),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual(['insufficient_stock', 'success']);
    expect(await inventory.getBalance(storeId, product.id)).toMatchObject({
      estimatedAvailable: 0,
    });
    expect(await count('local_sales')).toBe(1);
    expect(await count('local_stock_movements', "kind = 'sale'")).toBe(1);
    expect(await count('outbox_commands', "type = 'sale.create'")).toBe(1);
  });

  it('keeps historical snapshots after a later product edit and scopes sale reads by store', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 3, note: null });
    const result = await sales.create(
      input('50000000-0000-4000-8000-000000000014', [
        { productId: product.id, quantity: 1, expectedUnitPriceMinor: product.priceMinor },
      ]),
    );
    if (result.status !== 'success') throw new Error('Expected the sale to commit.');
    await products.update(
      storeId,
      product.id,
      draft({ name: 'Updated product name', price: '3900.00' }),
    );

    expect(await sales.getById(storeId, result.sale.id)).toMatchObject({
      items: [
        {
          productNameSnapshot: 'Basic Cotton Top',
          skuSnapshot: 'TEE-001',
          unitPriceMinor: 350000,
          lineTotalMinor: 350000,
        },
      ],
      totalMinor: 350000,
    });
    expect(await sales.getById(otherStoreId, result.sale.id)).toBeNull();
    expect(await sales.list(storeId)).toHaveLength(1);
  });

  it('rejects a daily aggregate that exceeds the supported exact-money limit', async () => {
    for (let index = 1; index <= 2; index += 1) {
      await database.runAsync(
        `INSERT INTO local_sales (
          id, store_id, checkout_request_id, payment_method, total_minor, occurred_at, created_at
        ) VALUES (?, ?, ?, 'cash', 99999999999, ?, ?);`,
        [
          `70000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          storeId,
          `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          timestamp,
          timestamp,
        ],
      );
    }

    await expect(
      sales.getDailySummary(storeId, '2026-11-16T00:00:00.000Z', '2026-11-17T00:00:00.000Z'),
    ).rejects.toThrow(/supported monetary limit/);
  });

  it('parameterizes customer text and preserves pending product command order/dependency', async () => {
    const product = await products.create(storeId, draft());
    await inventory.stockIn({ storeId, productId: product.id, quantity: 2, note: null });
    const customerName = "Ada'); DROP TABLE local_sales;--";
    const result = await sales.create({
      ...input('50000000-0000-4000-8000-000000000015', [
        { productId: product.id, quantity: 1, expectedUnitPriceMinor: product.priceMinor },
      ]),
      customerName,
      paymentMethod: 'transfer',
    });
    if (result.status !== 'success') throw new Error('Expected the sale to commit.');

    expect(result.sale.customerName).toBe(customerName);
    const commands = await database.getAllAsync<{
      type: string;
      local_sequence: number;
      depends_on_command_id: string | null;
      command_id: string;
    }>(
      `SELECT type, local_sequence, depends_on_command_id, command_id FROM outbox_commands ORDER BY local_sequence;`,
      [],
    );
    expect(commands.at(-1)).toMatchObject({
      type: 'sale.create',
      depends_on_command_id: commands.find(({ type }) => type === 'product.create')?.command_id,
    });
    expect(commands.at(-1)?.local_sequence).toBeGreaterThan(commands[0].local_sequence);
    expect(await count('local_sales')).toBe(1);
  });

  async function count(
    table: 'local_sales' | 'local_sale_items' | 'local_stock_movements' | 'outbox_commands',
    filter = '1 = 1',
  ) {
    const result = await database.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE ${filter};`,
      [],
    );
    return result?.count ?? 0;
  }

  function input(checkoutRequestId: string, lines: CheckoutInput['lines']): CheckoutInput {
    return { storeId, checkoutRequestId, lines, paymentMethod: 'cash' };
  }

  function nextId() {
    id += 1;
    return `60000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  }
});
