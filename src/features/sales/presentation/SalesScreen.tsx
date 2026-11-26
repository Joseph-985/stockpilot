import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import type { Sale } from '@/features/sales/domain/sale';
import { useSalesServices } from './SalesServicesContext';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';
import { formatMinorCurrency } from '@/shared/domain/money';

export function SalesScreen() {
  const { repository, storeId } = useSalesServices();
  const router = useRouter();
  const [sales, setSales] = useState<Sale[]>([]);
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
      void repository
        .list(storeId, { limit: 100 })
        .then((rows) => {
          if (active && refresh === latestRefresh.current) setSales(rows);
        })
        .catch(() => {
          if (active && refresh === latestRefresh.current) setError(true);
        })
        .finally(() => {
          if (active && refresh === latestRefresh.current) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [refresh, repository, storeId]),
  );

  return (
    <Screen>
      <FlatList
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, gap: 12, paddingBottom: 24 }}
        data={loading || error ? [] : sales}
        keyExtractor={(sale) => sale.id}
        ListHeaderComponent={
          <View className="gap-3 pb-2">
            <View className="gap-1">
              <Text className="text-sm font-medium text-brand-700">StockPilot</Text>
              <Text className="text-2xl font-bold text-ink">Sales</Text>
              <Text className="text-sm text-muted">
                Local records are provisional until they sync. Pending data is stored only on this
                device.
              </Text>
            </View>
            <Button label="Create sale" onPress={() => router.push({ pathname: '/sale/new' })} />
          </View>
        }
        ListEmptyComponent={
          error ? (
            <ErrorState
              message="Saved sales could not be loaded from this device."
              onRetry={() => setRefresh((value) => value + 1)}
              title="Sales unavailable"
            />
          ) : loading ? (
            <LoadingIndicator label="Loading sales" />
          ) : (
            <EmptyState
              description="Completed local sales will appear here, including while offline."
              title="No sales yet"
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sale ${formatMinorCurrency(item.totalMinor)}, pending sync`}
            className="gap-2 rounded-2xl border border-border bg-surface p-4"
            onPress={() => router.push({ pathname: '/sale/[id]', params: { id: item.id } })}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold text-ink">
                  {new Date(item.occurredAt).toLocaleString()}
                </Text>
                <Text className="text-sm text-muted">
                  {item.items.length} {item.items.length === 1 ? 'item' : 'items'}
                  {item.customerName ? ` · ${item.customerName}` : ''}
                </Text>
              </View>
              <Text className="text-base font-bold text-ink">
                {formatMinorCurrency(item.totalMinor)}
              </Text>
            </View>
            <Text className="self-start rounded-full bg-warningSurface px-3 py-1 text-xs font-semibold text-warning">
              Pending sync · provisional
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
