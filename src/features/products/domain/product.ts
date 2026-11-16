import type { z } from 'zod';

import { ProductDraftSchema } from './validation';

export type ProductId = string;
export type StoreId = string;
export type ProductSyncStatus = 'pending' | 'synced' | 'conflict';
export type ProductDraft = z.input<typeof ProductDraftSchema>;
export type ValidProductDraft = z.output<typeof ProductDraftSchema>;

export type Product = {
  id: ProductId;
  storeId: StoreId;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  priceMinor: number;
  costMinor: number | null;
  lowStockThreshold: number;
  serverVersion: number;
  localRevision: number;
  syncStatus: ProductSyncStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ProductListOptions = {
  query?: string;
  includeArchived?: boolean;
};
