import { createContext, useContext, type PropsWithChildren } from 'react';

import type { InventoryRepository } from '../domain/InventoryRepository';
import type { StoreId } from '@/features/products/domain/product';

export type InventoryServices = {
  repository: InventoryRepository;
  storeId: StoreId;
};

const InventoryServicesContext = createContext<InventoryServices | null>(null);

export function InventoryServicesProvider({
  children,
  services,
}: PropsWithChildren<{ services: InventoryServices }>) {
  return (
    <InventoryServicesContext.Provider value={services}>
      {children}
    </InventoryServicesContext.Provider>
  );
}

export function useInventoryServices(): InventoryServices {
  const services = useContext(InventoryServicesContext);
  if (!services) {
    throw new Error('Inventory services are unavailable outside the local database app.');
  }
  return services;
}
