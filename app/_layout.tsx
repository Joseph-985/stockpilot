import '../global.css';

import { useEffect, useMemo, useState } from 'react';
import { Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { ProductServicesProvider } from '@/features/products/presentation/ProductServicesContext';
import type { ProductServices } from '@/features/products/presentation/ProductServicesContext';
import { InventoryServicesProvider } from '@/features/inventory/presentation/InventoryServicesContext';
import { SalesServicesProvider } from '@/features/sales/presentation/SalesServicesContext';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';
import { getLocalDemoStoreIdentity } from '@/shared/infrastructure/db/localStoreIdentity';
import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';
import { SQLiteProductRepository } from '@/shared/infrastructure/db/repositories/SQLiteProductRepository';
import { SQLiteInventoryRepository } from '@/shared/infrastructure/db/repositories/SQLiteInventoryRepository';
import { SQLiteSaleRepository } from '@/shared/infrastructure/db/repositories/SQLiteSaleRepository';

function AppRoutes() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="products/new" />
        <Stack.Screen name="products/[id]/edit" />
        <Stack.Screen name="inventory/stock-in" />
        <Stack.Screen name="inventory/adjust" />
        <Stack.Screen name="inventory/[productId]" />
        <Stack.Screen name="sale/new" />
        <Stack.Screen name="sale/[id]" />
      </Stack>
    </>
  );
}

function DatabaseApp() {
  const database = useSQLiteContext();
  const repository = useMemo(() => new SQLiteProductRepository(database), [database]);
  const inventoryRepository = useMemo(() => new SQLiteInventoryRepository(database), [database]);
  const saleRepository = useMemo(() => new SQLiteSaleRepository(database), [database]);
  const [services, setServices] = useState<ProductServices | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let isActive = true;
    void getLocalDemoStoreIdentity(database).then(
      (identity) => {
        if (isActive) setServices({ repository, storeId: identity.storeId });
      },
      () => {
        if (isActive) setLoadError(true);
      },
    );
    return () => {
      isActive = false;
    };
  }, [database, inventoryRepository, repository, retryKey]);

  if (!services) {
    return (
      <Screen>
        {loadError ? (
          <ErrorState
            message="The local demo-store identity could not be loaded."
            onRetry={() => {
              setLoadError(false);
              setRetryKey((value) => value + 1);
            }}
            title="Local database unavailable"
          />
        ) : (
          <LoadingIndicator label="Opening local database" />
        )}
      </Screen>
    );
  }

  return (
    <ProductServicesProvider services={services}>
      <InventoryServicesProvider
        services={{ repository: inventoryRepository, storeId: services.storeId }}
      >
        <SalesServicesProvider services={{ repository: saleRepository, storeId: services.storeId }}>
          <AppRoutes />
        </SalesServicesProvider>
      </InventoryServicesProvider>
    </ProductServicesProvider>
  );
}

export default function RootLayout() {
  if (Platform.OS === 'web') return <AppRoutes />;

  return (
    <SQLiteProvider databaseName="stockpilot.db" onInit={initializeDatabase}>
      <DatabaseApp />
    </SQLiteProvider>
  );
}
