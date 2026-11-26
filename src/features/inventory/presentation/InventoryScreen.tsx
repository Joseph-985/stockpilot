import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import type { Product } from '@/features/products/domain/product';
import type { StockBalance } from '@/features/inventory/domain/inventory';
import { useProductServices } from '@/features/products/presentation/ProductServicesContext';
import { useInventoryServices } from './InventoryServicesContext';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';

type InventoryItem = { product: Product; balance: StockBalance };

export function InventoryScreen() {
  const { repository } = useProductServices();
  const { repository: inventoryRepository, storeId } = useInventoryServices();
  const router = useRouter();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(false);
      void Promise.all([repository.list(storeId), inventoryRepository.listBalances(storeId)])
        .then(([products, balances]) => {
          if (!active || refresh !== latestRefresh.current) return;
          const byProduct = new Map(balances.map((balance) => [balance.productId, balance]));
          setItems(
            products.map((product) => ({
              product,
              balance: byProduct.get(product.id) ?? {
                storeId,
                productId: product.id,
                baseQuantity: 0,
                pendingDelta: 0,
                estimatedAvailable: 0,
                hasPendingChanges: false,
                serverVersion: 0,
                updatedAt: product.createdAt,
              },
            })),
          );
        })
        .catch(() => {
          if (active && refresh === latestRefresh.current) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [inventoryRepository, refresh, repository, storeId]),
  );

  return (
    <Screen>
      <FlatList
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, gap: 12, paddingBottom: 24 }}
        data={loading || error ? [] : items}
        keyExtractor={({ product }) => product.id}
        ListHeaderComponent={
          <View className="gap-1 pb-2">
            <Text className="text-sm font-medium text-brand-700">StockPilot</Text>
            <Text className="text-2xl font-bold text-ink">Inventory</Text>
            <Text className="text-sm text-muted">
              Estimated local availability. Final stock is not confirmed until sync.
            </Text>
          </View>
        }
        ListEmptyComponent={
          error ? (
            <ErrorState
              message="Local inventory could not be loaded."
              onRetry={() => setRefresh((v) => v + 1)}
              title="Inventory unavailable"
            />
          ) : loading ? (
            <LoadingIndicator label="Loading inventory" />
          ) : items.length === 0 ? (
            <EmptyState
              description="Add a product first, then record its opening stock here."
              title="No products yet"
            />
          ) : null
        }
        renderItem={({ item }) => {
          const { product, balance } = item;
          const low = balance.estimatedAvailable <= product.lowStockThreshold;
          return (
            <View className="gap-3 rounded-2xl border border-border bg-surface p-4">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${product.name} movement history`}
                className="min-h-12 gap-1"
                onPress={() =>
                  router.push({
                    pathname: '/inventory/[productId]',
                    params: { productId: product.id },
                  })
                }
              >
                <Text className="text-base font-semibold text-ink">{product.name}</Text>
                <Text className="text-sm text-muted">SKU: {product.sku}</Text>
              </Pressable>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text
                  accessibilityLabel={`${balance.estimatedAvailable} units estimated available`}
                  className="text-lg font-bold text-ink"
                >
                  {balance.estimatedAvailable} estimated available
                </Text>
                {low ? (
                  <Text className="rounded-full bg-warningSurface px-3 py-1 text-xs font-semibold text-warning">
                    Low stock
                  </Text>
                ) : null}
                {balance.hasPendingChanges ? (
                  <Text
                    accessibilityLabel="Pending sync"
                    className="rounded-full bg-warningSurface px-3 py-1 text-xs font-semibold text-warning"
                  >
                    Pending sync
                  </Text>
                ) : null}
              </View>
              <Text className="text-xs text-muted">
                Low-stock threshold: {product.lowStockThreshold}. Availability is an estimate.
              </Text>
              <View className="flex-row gap-2">
                <Button
                  label={`Stock in ${product.name}`}
                  onPress={() => router.push(`/inventory/stock-in?productId=${product.id}`)}
                />
                <Button
                  label={`Adjust ${product.name}`}
                  onPress={() => router.push(`/inventory/adjust?productId=${product.id}`)}
                  variant="secondary"
                />
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}
