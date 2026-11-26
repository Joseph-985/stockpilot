import type { ProductId, StoreId } from '@/features/products/domain/product';

import type {
  InventoryMutationResult,
  StockAdjustmentInput,
  StockBalance,
  StockInInput,
  StockMovement,
} from './inventory';

export interface InventoryRepository {
  listBalances(storeId: StoreId): Promise<StockBalance[]>;
  getBalance(storeId: StoreId, productId: ProductId): Promise<StockBalance>;
  listMovements(storeId: StoreId, productId: ProductId): Promise<StockMovement[]>;
  stockIn(input: StockInInput): Promise<InventoryMutationResult>;
  adjustStock(input: StockAdjustmentInput): Promise<InventoryMutationResult>;
}
