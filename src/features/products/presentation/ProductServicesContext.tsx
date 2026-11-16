import { createContext, useContext, type PropsWithChildren } from 'react';

import type { ProductRepository } from '../domain/ProductRepository';
import type { StoreId } from '../domain/product';

export type ProductServices = {
  repository: ProductRepository;
  storeId: StoreId;
};

const ProductServicesContext = createContext<ProductServices | null>(null);

export function ProductServicesProvider({
  children,
  services,
}: PropsWithChildren<{ services: ProductServices }>) {
  return (
    <ProductServicesContext.Provider value={services}>{children}</ProductServicesContext.Provider>
  );
}

export function useProductServices(): ProductServices {
  const services = useContext(ProductServicesContext);
  if (!services) {
    throw new Error('Product services are unavailable outside the local database app.');
  }
  return services;
}
