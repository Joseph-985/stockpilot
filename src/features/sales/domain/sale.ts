import type { ProductId, StoreId } from '@/features/products/domain/product';

export type PaymentMethod = 'cash' | 'transfer' | 'other';
export type SaleStatus = 'pending' | 'confirmed' | 'needs_attention';

export type CheckoutLine = {
  productId: ProductId;
  quantity: number;
  expectedUnitPriceMinor: number;
};

export type CheckoutInput = {
  storeId: StoreId;
  checkoutRequestId: string;
  lines: CheckoutLine[];
  customerName?: string | null;
  paymentMethod: PaymentMethod;
};

export type SaleItemSnapshot = {
  storeId: StoreId;
  saleId: string;
  productId: ProductId;
  productNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type Sale = {
  id: string;
  storeId: StoreId;
  checkoutRequestId: string;
  customerName: string | null;
  paymentMethod: PaymentMethod;
  currency: 'NGN';
  totalMinor: number;
  status: SaleStatus;
  occurredAt: string;
  createdAt: string;
  items: SaleItemSnapshot[];
};

export type CheckoutResult =
  | { status: 'success'; sale: Sale }
  | { status: 'duplicate_attempt'; sale: Sale }
  | {
      status: 'price_changed';
      productId: ProductId;
      expectedUnitPriceMinor: number;
      currentUnitPriceMinor: number;
    }
  | {
      status: 'insufficient_stock';
      productId: ProductId;
      requestedQuantity: number;
      estimatedAvailable: number;
    }
  | { status: 'product_unavailable'; productId: ProductId }
  | { status: 'validation_error'; message: string }
  | { status: 'persistence_failure'; message: string };
