import { createContext, useContext, type PropsWithChildren } from 'react';

import type { SaleRepository } from '@/features/sales/domain/SaleRepository';
import type { StoreId } from '@/features/products/domain/product';

export type SalesServices = { repository: SaleRepository; storeId: StoreId };

const SalesServicesContext = createContext<SalesServices | null>(null);

export function SalesServicesProvider({
  children,
  services,
}: PropsWithChildren<{ services: SalesServices }>) {
  return <SalesServicesContext.Provider value={services}>{children}</SalesServicesContext.Provider>;
}

export function useSalesServices(): SalesServices {
  const services = useContext(SalesServicesContext);
  if (!services) throw new Error('Sales services are unavailable outside the local database app.');
  return services;
}
