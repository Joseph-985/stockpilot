import type { StoreId } from '@/features/products/domain/product';

import type { CheckoutInput, CheckoutResult, Sale } from './sale';

export type SaleListOptions = { limit?: number; beforeOccurredAt?: string };
export type DailySalesSummary = { count: number; totalMinor: number; pendingCount: number };

export interface SaleRepository {
  create(input: CheckoutInput): Promise<CheckoutResult>;
  getById(storeId: StoreId, saleId: string): Promise<Sale | null>;
  list(storeId: StoreId, options?: SaleListOptions): Promise<Sale[]>;
  getDailySummary(
    storeId: StoreId,
    fromInclusive: string,
    toExclusive: string,
  ): Promise<DailySalesSummary>;
}
