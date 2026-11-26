import type { ProductId, ProductSyncStatus, StoreId } from '@/features/products/domain/product';

export type StockMovementKind = 'stock_in' | 'adjustment' | 'sale';

/** baseQuantity is a local zero baseline in M2; estimatedAvailable is provisional, never confirmed. */
export type StockBalance = {
  storeId: StoreId;
  productId: ProductId;
  baseQuantity: number;
  pendingDelta: number;
  estimatedAvailable: number;
  hasPendingChanges: boolean;
  serverVersion: number;
  updatedAt: string;
};

export type StockMovement = {
  id: string;
  storeId: StoreId;
  productId: ProductId;
  deltaQuantity: number;
  kind: StockMovementKind;
  reason: string | null;
  saleId: string | null;
  sourceCommandId: string;
  syncStatus: ProductSyncStatus;
  occurredAt: string;
};

export type StockInInput = {
  storeId: StoreId;
  productId: ProductId;
  quantity: number;
  note: string | null;
};

export type StockAdjustmentInput = {
  storeId: StoreId;
  productId: ProductId;
  deltaQuantity: number;
  reason: string;
};

export type InventoryMutationResult =
  | { status: 'success'; movement: StockMovement; balance: StockBalance }
  | { status: 'product_unavailable' }
  | { status: 'insufficient_stock'; estimatedAvailable: number }
  | { status: 'validation_error'; message: string }
  | { status: 'persistence_failure'; message: string };
