import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import type { StockBalance, StockMovement } from '@/features/inventory/domain/inventory';
import type { Product } from '@/features/products/domain/product';
import { useProductServices } from '@/features/products/presentation/ProductServicesContext';
import { useInventoryServices } from './InventoryServicesContext';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';

export function ProductMovementHistoryScreen({ productId }: { productId?: string }) {
  const router = useRouter();
  const { repository } = useProductServices();
  const { repository: inventoryRepository, storeId } = useInventoryServices();
  const [product, setProduct] = useState<Product | null>(null);
  const [balance, setBalance] = useState<StockBalance | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
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
      if (!productId) {
        setError(true);
        setLoading(false);
        return;
      }
      void Promise.all([
        repository.getById(storeId, productId, { includeArchived: true }),
        inventoryRepository.getBalance(storeId, productId),
        inventoryRepository.listMovements(storeId, productId),
      ])
        .then(([foundProduct, currentBalance, history]) => {
          if (!active || refresh !== latestRefresh.current) return;
          setProduct(foundProduct);
          setBalance(currentBalance);
          setMovements(history);
          if (!foundProduct) setError(true);
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
    }, [inventoryRepository, productId, refresh, repository, storeId]),
  );

  return (
    <Screen>
      {loading ? (
        <LoadingIndicator label="Loading movement history" />
      ) : error || !product ? (
        <ErrorState
          message="Movement history could not be loaded for this product."
          onRetry={() => setRefresh((value) => value + 1)}
          title="History unavailable"
        />
      ) : (
        <FlatList
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, gap: 12, paddingBottom: 24 }}
          data={movements}
          keyExtractor={(movement) => movement.id}
          ListHeaderComponent={
            <View className="gap-3 pb-2">
              <View className="gap-1">
                <Text className="text-sm font-medium text-brand-700">{product.sku}</Text>
                <Text className="text-2xl font-bold text-ink">{product.name}</Text>
                <Text className="text-lg font-semibold text-ink">
                  {balance?.estimatedAvailable ?? 0} estimated available
                </Text>
                <Text className="text-sm text-muted">
                  Local estimate only. Not server-confirmed.
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Button
                  disabled={Boolean(product.deletedAt)}
                  label="Stock in"
                  onPress={() => router.push(`/inventory/stock-in?productId=${product.id}`)}
                />
                <Button
                  disabled={Boolean(product.deletedAt)}
                  label="Adjust"
                  onPress={() => router.push(`/inventory/adjust?productId=${product.id}`)}
                  variant="secondary"
                />
              </View>
              <Text className="pt-2 text-lg font-bold text-ink">Movement history</Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              description="Stock changes recorded for this product will appear here."
              title="No movements yet"
            />
          }
          renderItem={({ item }) => (
            <View className="gap-1 rounded-2xl border border-border bg-surface p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="font-semibold text-ink">
                  {item.kind === 'stock_in'
                    ? 'Stock in'
                    : item.kind === 'adjustment'
                      ? 'Adjustment'
                      : 'Sale'}
                </Text>
                <Text className="text-base font-bold text-ink">
                  {item.deltaQuantity > 0 ? '+' : ''}
                  {item.deltaQuantity}
                </Text>
              </View>
              {item.reason ? <Text className="text-sm text-muted">{item.reason}</Text> : null}
              <Text className="text-xs text-muted">
                {new Date(item.occurredAt).toLocaleString()}
              </Text>
              <Text
                accessibilityLabel="Pending sync"
                className="self-start rounded-full bg-warningSurface px-3 py-1 text-xs font-semibold text-warning"
              >
                Pending sync
              </Text>
              {item.saleId ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel="View linked sale"
                  className="min-h-12 justify-center self-start"
                  onPress={() =>
                    router.push({ pathname: '/sale/[id]', params: { id: item.saleId! } })
                  }
                >
                  <Text className="font-semibold text-brand-700">View sale details</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      )}
    </Screen>
  );
}
