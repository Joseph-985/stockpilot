import type { ProductRepository } from '../domain/ProductRepository';
import type { Product, ProductId, StoreId, ValidProductDraft } from '../domain/product';

export function listProducts(
  repository: ProductRepository,
  storeId: StoreId,
  query = '',
): Promise<Product[]> {
  return repository.list(storeId, { query });
}

export function getProduct(
  repository: ProductRepository,
  storeId: StoreId,
  productId: ProductId,
): Promise<Product | null> {
  return repository.getById(storeId, productId);
}

export function createProduct(
  repository: ProductRepository,
  storeId: StoreId,
  draft: ValidProductDraft,
): Promise<Product> {
  return repository.create(storeId, draft);
}

export function updateProduct(
  repository: ProductRepository,
  storeId: StoreId,
  productId: ProductId,
  draft: ValidProductDraft,
): Promise<Product> {
  return repository.update(storeId, productId, draft);
}

export function archiveProduct(
  repository: ProductRepository,
  storeId: StoreId,
  productId: ProductId,
): Promise<Product> {
  return repository.archive(storeId, productId);
}
