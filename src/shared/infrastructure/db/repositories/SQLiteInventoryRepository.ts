import { randomUUID } from 'expo-crypto';

import type { InventoryRepository } from '@/features/inventory/domain/InventoryRepository';
import type {
  InventoryMutationResult,
  StockAdjustmentInput,
  StockBalance,
  StockInInput,
  StockMovement,
} from '@/features/inventory/domain/inventory';
import {
  StockAdjustmentInputSchema,
  StockInInputSchema,
} from '@/features/inventory/domain/validation';
import type { ProductId, StoreId } from '@/features/products/domain/product';
import { calculateEstimatedQuantity } from '@/shared/domain/quantity';
import { withDatabaseOperation } from '@/shared/infrastructure/db/DatabaseOperationQueue';
import type { SQLiteConnection } from '@/shared/infrastructure/db/SQLiteConnection';

const BALANCE_SQL = `
  INSERT INTO local_stock_balances (store_id, product_id, base_quantity, pending_delta, updated_at)
  VALUES (?, ?, 0, ?, ?)
  ON CONFLICT (store_id, product_id) DO UPDATE SET
    pending_delta = local_stock_balances.pending_delta + excluded.pending_delta,
    updated_at = excluded.updated_at
  WHERE local_stock_balances.base_quantity + local_stock_balances.pending_delta + excluded.pending_delta
    BETWEEN 0 AND 9007199254740991;
`;

type ProductRow = { id: string };
type BalanceRow = {
  store_id: string;
  product_id: string;
  base_quantity: number;
  pending_delta: number;
  server_version: number;
  updated_at: string | null;
  has_pending_changes: number;
};
type MovementRow = {
  id: string;
  store_id: string;
  product_id: string;
  delta_quantity: number;
  kind: StockMovement['kind'];
  reason: string | null;
  sale_id: string | null;
  source_command_id: string;
  sync_status: StockMovement['syncStatus'];
  occurred_at: string;
};
type DependencyRow = { command_id: string };

export type SQLiteInventoryRepositoryOptions = {
  createId?: () => string;
  now?: () => string;
};

export class SQLiteInventoryRepository implements InventoryRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: SQLiteConnection,
    options: SQLiteInventoryRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  listBalances(storeId: StoreId): Promise<StockBalance[]> {
    return withDatabaseOperation(this.database, async () => {
      const rows = await this.database.getAllAsync<BalanceRow>(
        `SELECT p.store_id, p.id AS product_id, COALESCE(b.base_quantity, 0) AS base_quantity,
                COALESCE(b.pending_delta, 0) AS pending_delta, COALESCE(b.server_version, 0) AS server_version,
                COALESCE(b.updated_at, p.created_at) AS updated_at
                , CASE WHEN EXISTS (
                  SELECT 1 FROM local_stock_movements m
                  WHERE m.store_id = p.store_id AND m.product_id = p.id AND m.sync_status = 'pending'
                ) THEN 1 ELSE 0 END AS has_pending_changes
         FROM local_products p LEFT JOIN local_stock_balances b
           ON b.store_id = p.store_id AND b.product_id = p.id
         WHERE p.store_id = ? AND p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE, p.id;`,
        [storeId],
      );
      return rows.map(toBalance);
    });
  }

  getBalance(storeId: StoreId, productId: ProductId): Promise<StockBalance> {
    return withDatabaseOperation(this.database, async () => {
      const row = await this.database.getFirstAsync<BalanceRow>(
        `SELECT p.store_id, p.id AS product_id, COALESCE(b.base_quantity, 0) AS base_quantity,
                COALESCE(b.pending_delta, 0) AS pending_delta, COALESCE(b.server_version, 0) AS server_version,
                COALESCE(b.updated_at, p.created_at) AS updated_at
                , CASE WHEN EXISTS (
                  SELECT 1 FROM local_stock_movements m
                  WHERE m.store_id = p.store_id AND m.product_id = p.id AND m.sync_status = 'pending'
                ) THEN 1 ELSE 0 END AS has_pending_changes
         FROM local_products p LEFT JOIN local_stock_balances b
           ON b.store_id = p.store_id AND b.product_id = p.id
         WHERE p.store_id = ? AND p.id = ? LIMIT 1;`,
        [storeId, productId],
      );
      if (!row) throw new Error('Product was not found in this store.');
      return toBalance(row);
    });
  }

  listMovements(storeId: StoreId, productId: ProductId): Promise<StockMovement[]> {
    return withDatabaseOperation(this.database, async () => {
      const rows = await this.database.getAllAsync<MovementRow>(
        `SELECT m.id, m.store_id, m.product_id, m.delta_quantity, m.kind, m.reason, m.sale_id,
                m.source_command_id, m.sync_status, m.occurred_at
         FROM local_stock_movements m
         JOIN outbox_commands c ON c.command_id = m.source_command_id AND c.store_id = m.store_id
         WHERE m.store_id = ? AND m.product_id = ?
         ORDER BY c.local_sequence DESC, m.id DESC;`,
        [storeId, productId],
      );
      return rows.map(toMovement);
    });
  }

  stockIn(input: StockInInput): Promise<InventoryMutationResult> {
    const parsed = StockInInputSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationFailure(parsed.error.issues[0]?.message));
    return this.mutate(parsed.data, 'stock_in', parsed.data.quantity, parsed.data.note);
  }

  adjustStock(input: StockAdjustmentInput): Promise<InventoryMutationResult> {
    const parsed = StockAdjustmentInputSchema.safeParse(input);
    if (!parsed.success) return Promise.resolve(validationFailure(parsed.error.issues[0]?.message));
    return this.mutate(parsed.data, 'adjustment', parsed.data.deltaQuantity, parsed.data.reason);
  }

  private mutate(
    input: StockInInput | StockAdjustmentInput,
    kind: 'stock_in' | 'adjustment',
    delta: number,
    reason: string | null,
  ): Promise<InventoryMutationResult> {
    const commandId = this.createId();
    const movementId = this.createId();
    const occurredAt = this.now();

    return withDatabaseOperation(this.database, async () => {
      let result: InventoryMutationResult | null = null;
      try {
        await this.database.withTransactionAsync(async () => {
          const product = await this.database.getFirstAsync<ProductRow>(
            `SELECT id FROM local_products WHERE store_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1;`,
            [input.storeId, input.productId],
          );
          if (!product) {
            result = { status: 'product_unavailable' };
            return;
          }

          const previous = await this.readBalance(input.storeId, input.productId);
          const nextPending = previous.pendingDelta + delta;
          if (!Number.isSafeInteger(nextPending)) {
            result = validationFailure('The resulting quantity exceeds the supported safe range.');
            return;
          }
          let estimatedAvailable: number;
          try {
            estimatedAvailable = calculateEstimatedQuantity(previous.baseQuantity, nextPending);
          } catch {
            result = {
              status: 'insufficient_stock',
              estimatedAvailable: previous.estimatedAvailable,
            };
            return;
          }

          const dependency = await this.database.getFirstAsync<DependencyRow>(
            `SELECT command_id FROM outbox_commands
             WHERE store_id = ? AND product_id = ? AND status = 'pending'
             ORDER BY local_sequence DESC LIMIT 1;`,
            [input.storeId, input.productId],
          );
          const type = kind === 'stock_in' ? 'inventory.stock_in' : 'inventory.adjust';
          const payload = {
            protocol_version: 1,
            command_id: commandId,
            store_id: input.storeId,
            type,
            entity_id: movementId,
            payload: {
              movement_id: movementId,
              product_id: input.productId,
              delta_quantity: delta,
              ...(kind === 'stock_in' ? { note: reason } : { reason }),
            },
          };

          const balanceWrite = await this.database.runAsync(BALANCE_SQL, [
            input.storeId,
            input.productId,
            delta,
            occurredAt,
          ]);
          if (balanceWrite.changes !== 1) {
            throw new Error('The estimated inventory balance changed during the write.');
          }

          await this.database.runAsync(
            `INSERT INTO outbox_commands (
              command_id, store_id, type, entity_id, product_id, payload_json,
              expected_server_version, depends_on_command_id, status, attempts, created_at
            ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 'pending', 0, ?);`,
            [
              commandId,
              input.storeId,
              type,
              movementId,
              JSON.stringify(payload),
              dependency?.command_id ?? null,
              occurredAt,
            ],
          );

          await this.database.runAsync(
            `INSERT INTO local_stock_movements (
              id, store_id, product_id, delta_quantity, kind, reason, sale_id,
              source_command_id, sync_status, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'pending', ?);`,
            [
              movementId,
              input.storeId,
              input.productId,
              delta,
              kind,
              reason,
              commandId,
              occurredAt,
            ],
          );

          result = {
            status: 'success',
            movement: {
              id: movementId,
              storeId: input.storeId,
              productId: input.productId,
              deltaQuantity: delta,
              kind,
              reason,
              saleId: null,
              sourceCommandId: commandId,
              syncStatus: 'pending',
              occurredAt,
            },
            balance: {
              ...previous,
              pendingDelta: nextPending,
              estimatedAvailable,
              hasPendingChanges: true,
              updatedAt: occurredAt,
            },
          };
        });
      } catch {
        return {
          status: 'persistence_failure',
          message: 'Inventory could not be saved locally. Please try again.',
        };
      }
      return (
        result ?? {
          status: 'persistence_failure',
          message: 'Inventory transaction did not complete.',
        }
      );
    });
  }

  private async readBalance(storeId: StoreId, productId: ProductId): Promise<StockBalance> {
    const row = await this.database.getFirstAsync<BalanceRow>(
      `SELECT store_id, product_id, base_quantity, pending_delta, server_version, updated_at
       FROM local_stock_balances WHERE store_id = ? AND product_id = ? LIMIT 1;`,
      [storeId, productId],
    );
    if (!row) {
      return {
        storeId,
        productId,
        baseQuantity: 0,
        pendingDelta: 0,
        estimatedAvailable: 0,
        hasPendingChanges: false,
        serverVersion: 0,
        updatedAt: this.now(),
      };
    }
    return toBalance(row);
  }
}

function toBalance(row: BalanceRow): StockBalance {
  return {
    storeId: row.store_id,
    productId: row.product_id,
    baseQuantity: row.base_quantity,
    pendingDelta: row.pending_delta,
    estimatedAvailable: row.base_quantity + row.pending_delta,
    hasPendingChanges: row.has_pending_changes === 1,
    serverVersion: row.server_version,
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
  };
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    deltaQuantity: row.delta_quantity,
    kind: row.kind,
    reason: row.reason,
    saleId: row.sale_id,
    sourceCommandId: row.source_command_id,
    syncStatus: row.sync_status,
    occurredAt: row.occurred_at,
  };
}

function validationFailure(message?: string): InventoryMutationResult {
  return {
    status: 'validation_error',
    message: message ?? 'Invalid inventory quantity.',
  };
}
