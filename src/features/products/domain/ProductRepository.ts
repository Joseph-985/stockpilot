import type {
  Product,
  ProductDraft,
  ProductId,
  ProductListOptions,
  StoreId,
  ValidProductDraft,
} from './product';

export interface ProductRepository {
  create(storeId: StoreId, draft: ValidProductDraft): Promise<Product>;
  update(storeId: StoreId, productId: ProductId, draft: ValidProductDraft): Promise<Product>;
  archive(storeId: StoreId, productId: ProductId): Promise<Product>;
  getById(
    storeId: StoreId,
    productId: ProductId,
    options?: Pick<ProductListOptions, 'includeArchived'>,
  ): Promise<Product | null>;
  list(storeId: StoreId, options?: ProductListOptions): Promise<Product[]>;
}

export type ProductDraftInput = ProductDraft;

export class ProductRepositoryError extends Error {
  constructor(
    readonly code: 'duplicate_sku' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'ProductRepositoryError';
  }
}
