import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProductDraftSchema } from '@/features/products/domain/validation';
import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { ensureLocalDemoStoreIdentity } from '@/shared/infrastructure/db/localStoreIdentity';
import { SQLiteInventoryRepository } from '@/shared/infrastructure/db/repositories/SQLiteInventoryRepository';
import { SQLiteProductRepository } from '@/shared/infrastructure/db/repositories/SQLiteProductRepository';
import { SQLiteSaleRepository } from '@/shared/infrastructure/db/repositories/SQLiteSaleRepository';
import { SQLiteTestDatabase } from '@/test/helpers/SQLiteTestDatabase';

jest.mock('expo-crypto', () => ({ randomUUID: () => '20000000-0000-4000-8000-000000000001' }));

const storeId = '20000000-0000-4000-8000-000000000001';
const timestamp = '2026-11-16T10:00:00.000Z';

function draft() {
  return ProductDraftSchema.parse({
    sku: 'TEE-001',
    name: 'Basic Cotton Top',
    description: null,
    category: 'Clothing',
    price: '3500.00',
    cost: null,
    lowStockThreshold: 3,
  });
}

describe('file-backed SQLite M2 persistence', () => {
  it('reopens a committed sale, snapshots, movement, estimate, and ordered outbox', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'stockpilot-m2-persistence-'));
    const path = join(directory, 'stockpilot.db');
    let database = new SQLiteTestDatabase(path);

    try {
      await initializeDatabase(database);
      await ensureLocalDemoStoreIdentity(
        database,
        () => storeId,
        () => timestamp,
      );
      const products = new SQLiteProductRepository(database, {
        createId: () => '30000000-0000-4000-8000-000000000001',
        now: () => timestamp,
      });
      const inventory = new SQLiteInventoryRepository(database, {
        createId: sequentialId('40000000-0000-4000-8000-'),
        now: () => timestamp,
      });
      const sales = new SQLiteSaleRepository(database, {
        createId: sequentialId('50000000-0000-4000-8000-'),
        now: () => timestamp,
      });
      const product = await products.create(storeId, draft());
      await inventory.stockIn({
        storeId,
        productId: product.id,
        quantity: 5,
        note: 'Opening stock',
      });
      const result = await sales.create({
        storeId,
        checkoutRequestId: '60000000-0000-4000-8000-000000000001',
        lines: [{ productId: product.id, quantity: 2, expectedUnitPriceMinor: product.priceMinor }],
        paymentMethod: 'cash',
      });
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Expected the sale to commit.');
      const saleId = result.sale.id;
      const movementCommandIdsBefore = await database.getAllAsync<{ command_id: string }>(
        `SELECT command_id FROM outbox_commands ORDER BY local_sequence;`,
        [],
      );
      database.close();

      database = new SQLiteTestDatabase(path);
      await initializeDatabase(database);
      const reopenedInventory = new SQLiteInventoryRepository(database);
      const reopenedSales = new SQLiteSaleRepository(database);

      expect(await reopenedInventory.getBalance(storeId, product.id)).toMatchObject({
        estimatedAvailable: 3,
        pendingDelta: 3,
        hasPendingChanges: true,
      });
      expect(await reopenedInventory.listMovements(storeId, product.id)).toMatchObject([
        { kind: 'sale', deltaQuantity: -2, saleId, syncStatus: 'pending' },
        { kind: 'stock_in', deltaQuantity: 5, syncStatus: 'pending' },
      ]);
      expect(await reopenedSales.getById(storeId, saleId)).toMatchObject({
        totalMinor: 700000,
        status: 'pending',
        items: [
          {
            productNameSnapshot: 'Basic Cotton Top',
            skuSnapshot: 'TEE-001',
            quantity: 2,
            unitPriceMinor: 350000,
            lineTotalMinor: 700000,
          },
        ],
      });
      const commandsAfter = await database.getAllAsync<{
        command_id: string;
        type: string;
        local_sequence: number;
        depends_on_command_id: string | null;
      }>(
        `SELECT command_id, type, local_sequence, depends_on_command_id
         FROM outbox_commands ORDER BY local_sequence;`,
        [],
      );
      expect(commandsAfter.map(({ command_id }) => command_id)).toEqual(
        movementCommandIdsBefore.map(({ command_id }) => command_id),
      );
      expect(commandsAfter.map(({ type }) => type)).toEqual([
        'product.create',
        'inventory.stock_in',
        'sale.create',
      ]);
      expect(commandsAfter[2].local_sequence).toBeGreaterThan(commandsAfter[0].local_sequence);
      expect(commandsAfter[2].depends_on_command_id).toBe(commandsAfter[0].command_id);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function sequentialId(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}${String(++value).padStart(12, '0')}`;
}
