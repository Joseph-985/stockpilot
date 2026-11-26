import { randomUUID } from 'expo-crypto';

import type {
  DailySalesSummary,
  SaleRepository,
  SaleListOptions,
} from '@/features/sales/domain/SaleRepository';
import {
  calculateCheckoutLineTotals,
  coalesceCheckoutLines,
} from '@/features/sales/domain/checkoutCalculations';
import type {
  CheckoutInput,
  CheckoutLine,
  CheckoutResult,
  PaymentMethod,
  Sale,
  SaleItemSnapshot,
} from '@/features/sales/domain/sale';
import { CheckoutInputSchema } from '@/features/sales/domain/validation';
import type { ProductId, StoreId } from '@/features/products/domain/product';
import { calculateEstimatedQuantity } from '@/shared/domain/quantity';
import { addMinorUnitAmounts } from '@/shared/domain/money';
import { withDatabaseOperation } from '@/shared/infrastructure/db/DatabaseOperationQueue';
import type { SQLiteConnection } from '@/shared/infrastructure/db/SQLiteConnection';

const DECREMENT_BALANCE_SQL = `
  INSERT INTO local_stock_balances (store_id, product_id, base_quantity, pending_delta, updated_at)
  VALUES (?, ?, 0, ?, ?)
  ON CONFLICT (store_id, product_id) DO UPDATE SET
    pending_delta = local_stock_balances.pending_delta + excluded.pending_delta,
    updated_at = excluded.updated_at
  WHERE local_stock_balances.base_quantity + local_stock_balances.pending_delta + excluded.pending_delta
    BETWEEN 0 AND 9007199254740991;
`;

type ProductRow = {
  id: string;
  store_id: string;
  name: string;
  sku: string;
  price_minor: number;
  deleted_at: string | null;
  base_quantity: number;
  pending_delta: number;
};
type SaleRow = {
  id: string;
  store_id: string;
  checkout_request_id: string;
  customer_name: string | null;
  payment_method: PaymentMethod;
  currency: 'NGN';
  total_minor: number;
  status: Sale['status'];
  occurred_at: string;
  created_at: string;
};
type SaleItemRow = {
  store_id: string;
  sale_id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
};
type ForeignKeyRow = { foreign_keys: number };

export type SQLiteSaleRepositoryOptions = {
  createId?: () => string;
  now?: () => string;
};

export class SQLiteSaleRepository implements SaleRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: SQLiteConnection,
    options: SQLiteSaleRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async create(input: CheckoutInput): Promise<CheckoutResult> {
    const parsed = CheckoutInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: 'validation_error',
        message: parsed.error.issues[0]?.message ?? 'Review the sale details and try again.',
      };
    }

    let lines: CheckoutLine[];
    try {
      lines = coalesceCheckoutLines(parsed.data.lines);
    } catch (error) {
      return {
        status: 'validation_error',
        message: error instanceof Error ? error.message : 'Review duplicate product lines.',
      };
    }

    // These IDs are persisted together. If the caller retries after an ambiguous result,
    // checkout_request_id finds and returns the committed IDs instead of creating another.
    const saleId = this.createId();
    const commandId = this.createId();
    const movementIds = lines.map(() => this.createId());
    const createdAt = this.now();

    return withDatabaseOperation(this.database, async () => {
      let result: CheckoutResult | null = null;
      try {
        await this.database.withTransactionAsync(async () => {
          const foreignKeys = await this.database.getFirstAsync<ForeignKeyRow>(
            'PRAGMA foreign_keys;',
            [],
          );
          if (foreignKeys?.foreign_keys !== 1) {
            throw new Error('SQLite foreign-key enforcement is disabled for the sale transaction.');
          }

          const existing = await this.database.getFirstAsync<SaleRow>(
            `SELECT id, store_id, checkout_request_id, customer_name, payment_method, currency,
                    total_minor, status, occurred_at, created_at
             FROM local_sales WHERE store_id = ? AND checkout_request_id = ? LIMIT 1;`,
            [parsed.data.storeId, parsed.data.checkoutRequestId],
          );
          if (existing) {
            result = {
              status: 'duplicate_attempt',
              sale: await this.getSaleInTransaction(existing),
            };
            return;
          }

          const products = new Map<string, ProductRow>();
          for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
            const product = await this.database.getFirstAsync<ProductRow>(
              `SELECT p.id, p.store_id, p.name, p.sku, p.price_minor, p.deleted_at,
                      COALESCE(b.base_quantity, 0) AS base_quantity,
                      COALESCE(b.pending_delta, 0) AS pending_delta
               FROM local_products p LEFT JOIN local_stock_balances b
                 ON b.store_id = p.store_id AND b.product_id = p.id
               WHERE p.store_id = ? AND p.id = ? AND p.deleted_at IS NULL LIMIT 1;`,
              [parsed.data.storeId, line.productId],
            );
            if (!product) {
              result = { status: 'product_unavailable', productId: line.productId };
              return;
            }
            products.set(product.id, product);
          }

          for (const line of lines) {
            const product = products.get(line.productId);
            if (!product) {
              result = { status: 'product_unavailable', productId: line.productId };
              return;
            }
            if (product.price_minor !== line.expectedUnitPriceMinor) {
              result = {
                status: 'price_changed',
                productId: line.productId,
                expectedUnitPriceMinor: line.expectedUnitPriceMinor,
                currentUnitPriceMinor: product.price_minor,
              };
              return;
            }
            let estimatedAvailable: number;
            try {
              estimatedAvailable = calculateEstimatedQuantity(
                product.base_quantity,
                product.pending_delta,
              );
            } catch {
              throw new Error('The stored stock projection is outside its valid range.');
            }
            if (estimatedAvailable < line.quantity) {
              result = {
                status: 'insufficient_stock',
                productId: line.productId,
                requestedQuantity: line.quantity,
                estimatedAvailable,
              };
              return;
            }
          }

          const snapshotItems = lines.map((line) => {
            const product = products.get(line.productId);
            if (!product) throw new Error('A sale product disappeared during validation.');
            return {
              product_id: product.id,
              product_name_snapshot: product.name,
              sku_snapshot: product.sku,
              quantity: line.quantity,
              unit_price_minor: product.price_minor,
            };
          });
          const totals = calculateCheckoutLineTotals(
            snapshotItems.map((item) => ({
              productId: item.product_id,
              quantity: item.quantity,
              expectedUnitPriceMinor: item.unit_price_minor,
            })),
          );
          const persistedItems = snapshotItems.map((item, index) => ({
            ...item,
            line_total_minor: totals.items[index].lineTotalMinor,
          }));

          await this.database.runAsync(
            `INSERT INTO local_sales (
              id, store_id, checkout_request_id, customer_name, payment_method, currency,
              total_minor, status, occurred_at, created_at
            ) VALUES (?, ?, ?, ?, ?, 'NGN', ?, 'pending', ?, ?);`,
            [
              saleId,
              parsed.data.storeId,
              parsed.data.checkoutRequestId,
              parsed.data.customerName,
              parsed.data.paymentMethod,
              totals.totalMinor,
              createdAt,
              createdAt,
            ],
          );

          for (const item of persistedItems) {
            await this.database.runAsync(
              `INSERT INTO local_sale_items (
                store_id, sale_id, product_id, product_name_snapshot, sku_snapshot,
                quantity, unit_price_minor, line_total_minor
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
              [
                parsed.data.storeId,
                saleId,
                item.product_id,
                item.product_name_snapshot,
                item.sku_snapshot,
                item.quantity,
                item.unit_price_minor,
                item.line_total_minor,
              ],
            );
          }

          const pendingProductCommand = await this.getLatestPendingProductCommand(
            parsed.data.storeId,
            lines.map(({ productId }) => productId),
          );
          const commandPayload = {
            protocol_version: 1,
            command_id: commandId,
            store_id: parsed.data.storeId,
            type: 'sale.create',
            entity_id: saleId,
            payload: {
              sale_id: saleId,
              checkout_request_id: parsed.data.checkoutRequestId,
              currency: 'NGN',
              occurred_at: createdAt,
              customer_name: parsed.data.customerName,
              payment_method: parsed.data.paymentMethod,
              total_minor: totals.totalMinor,
              items: persistedItems,
            },
          };
          await this.database.runAsync(
            `INSERT INTO outbox_commands (
              command_id, store_id, type, entity_id, product_id, payload_json,
              expected_server_version, depends_on_command_id, status, attempts, created_at
            ) VALUES (?, ?, 'sale.create', ?, NULL, ?, NULL, ?, 'pending', 0, ?);`,
            [
              commandId,
              parsed.data.storeId,
              saleId,
              JSON.stringify(commandPayload),
              pendingProductCommand,
              createdAt,
            ],
          );

          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const product = products.get(line.productId);
            if (!product) throw new Error('A sale product disappeared during persistence.');
            const balanceWrite = await this.database.runAsync(DECREMENT_BALANCE_SQL, [
              parsed.data.storeId,
              line.productId,
              -line.quantity,
              createdAt,
            ]);
            if (balanceWrite.changes !== 1) {
              throw new Error('The estimated stock changed while the sale was being committed.');
            }
            await this.database.runAsync(
              `INSERT INTO local_stock_movements (
                id, store_id, product_id, delta_quantity, kind, reason, sale_id,
                source_command_id, sync_status, occurred_at
              ) VALUES (?, ?, ?, ?, 'sale', NULL, ?, ?, 'pending', ?);`,
              [
                movementIds[index],
                parsed.data.storeId,
                line.productId,
                -line.quantity,
                saleId,
                commandId,
                createdAt,
              ],
            );
          }

          const saleItems: SaleItemSnapshot[] = persistedItems.map((item) => ({
            storeId: parsed.data.storeId,
            saleId,
            productId: item.product_id,
            productNameSnapshot: item.product_name_snapshot,
            skuSnapshot: item.sku_snapshot,
            quantity: item.quantity,
            unitPriceMinor: item.unit_price_minor,
            lineTotalMinor: item.line_total_minor,
          }));
          result = {
            status: 'success',
            sale: {
              id: saleId,
              storeId: parsed.data.storeId,
              checkoutRequestId: parsed.data.checkoutRequestId,
              customerName: parsed.data.customerName,
              paymentMethod: parsed.data.paymentMethod,
              currency: 'NGN',
              totalMinor: totals.totalMinor,
              status: 'pending',
              occurredAt: createdAt,
              createdAt,
              items: saleItems,
            },
          };
        });
      } catch {
        return {
          status: 'persistence_failure',
          message: 'Sale could not be saved locally. No partial sale was kept.',
        };
      }
      return (
        result ?? {
          status: 'persistence_failure',
          message: 'Sale transaction did not complete.',
        }
      );
    });
  }

  getById(storeId: StoreId, saleId: string): Promise<Sale | null> {
    return withDatabaseOperation(this.database, async () => {
      const row = await this.database.getFirstAsync<SaleRow>(
        `SELECT id, store_id, checkout_request_id, customer_name, payment_method, currency,
                total_minor, status, occurred_at, created_at
         FROM local_sales WHERE store_id = ? AND id = ? LIMIT 1;`,
        [storeId, saleId],
      );
      return row ? this.getSaleInTransaction(row) : null;
    });
  }

  list(storeId: StoreId, options: SaleListOptions = {}): Promise<Sale[]> {
    return withDatabaseOperation(this.database, async () => {
      const limit = Number.isSafeInteger(options.limit)
        ? Math.max(1, Math.min(options.limit ?? 50, 100))
        : 50;
      const rows = await this.database.getAllAsync<SaleRow>(
        `SELECT id, store_id, checkout_request_id, customer_name, payment_method, currency,
                total_minor, status, occurred_at, created_at
         FROM local_sales
         WHERE store_id = ? AND (? IS NULL OR occurred_at < ?)
         ORDER BY occurred_at DESC, id DESC LIMIT ?;`,
        [storeId, options.beforeOccurredAt ?? null, options.beforeOccurredAt ?? null, limit],
      );
      const sales: Sale[] = [];
      for (const row of rows) sales.push(await this.getSaleInTransaction(row));
      return sales;
    });
  }

  getDailySummary(
    storeId: StoreId,
    fromInclusive: string,
    toExclusive: string,
  ): Promise<DailySalesSummary> {
    return withDatabaseOperation(this.database, async () => {
      const rows = await this.database.getAllAsync<{ total_minor: number; status: Sale['status'] }>(
        `SELECT total_minor, status FROM local_sales
         WHERE store_id = ? AND occurred_at >= ? AND occurred_at < ?;`,
        [storeId, fromInclusive, toExclusive],
      );
      let totalMinor = 0;
      let pendingCount = 0;
      for (const row of rows) {
        totalMinor = addMinorUnitAmounts(totalMinor, row.total_minor);
        if (row.status === 'pending') pendingCount += 1;
      }
      return {
        count: rows.length,
        totalMinor,
        pendingCount,
      };
    });
  }

  private async getSaleInTransaction(row: SaleRow): Promise<Sale> {
    const itemRows = await this.database.getAllAsync<SaleItemRow>(
      `SELECT store_id, sale_id, product_id, product_name_snapshot, sku_snapshot,
              quantity, unit_price_minor, line_total_minor
       FROM local_sale_items WHERE store_id = ? AND sale_id = ? ORDER BY product_id ASC;`,
      [row.store_id, row.id],
    );
    return {
      id: row.id,
      storeId: row.store_id,
      checkoutRequestId: row.checkout_request_id,
      customerName: row.customer_name,
      paymentMethod: row.payment_method,
      currency: row.currency,
      totalMinor: row.total_minor,
      status: row.status,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
      items: itemRows.map((item) => ({
        storeId: item.store_id,
        saleId: item.sale_id,
        productId: item.product_id,
        productNameSnapshot: item.product_name_snapshot,
        skuSnapshot: item.sku_snapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unit_price_minor,
        lineTotalMinor: item.line_total_minor,
      })),
    };
  }

  private async getLatestPendingProductCommand(
    storeId: StoreId,
    productIds: ProductId[],
  ): Promise<string | null> {
    if (productIds.length === 0) return null;
    const placeholders = productIds.map(() => '?').join(', ');
    const row = await this.database.getFirstAsync<{ command_id: string }>(
      `SELECT command_id FROM outbox_commands
       WHERE store_id = ? AND product_id IN (${placeholders}) AND status = 'pending'
         AND type IN ('product.create', 'product.update', 'product.delete')
       ORDER BY local_sequence DESC LIMIT 1;`,
      [storeId, ...productIds],
    );
    return row?.command_id ?? null;
  }
}
