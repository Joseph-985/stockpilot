import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import type { Sale } from '@/features/sales/domain/sale';
import { useSalesServices } from './SalesServicesContext';
import { formatMinorCurrency } from '@/shared/domain/money';
import { Button } from '@/shared/ui/Button';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';

export function SaleDetailScreen({ saleId }: { saleId?: string }) {
  const { repository, storeId } = useSalesServices();
  const router = useRouter();
  const [sale, setSale] = useState<Sale | null>(null);
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
      if (!saleId) {
        setError(true);
        setLoading(false);
        return;
      }
      void repository
        .getById(storeId, saleId)
        .then((result) => {
          if (!active || refresh !== latestRefresh.current) return;
          setSale(result);
          if (!result) setError(true);
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
    }, [refresh, repository, saleId, storeId]),
  );

  if (loading)
    return (
      <Screen>
        <LoadingIndicator label="Loading sale details" />
      </Screen>
    );
  if (error || !sale) {
    return (
      <Screen>
        <ErrorState
          message="The saved sale could not be loaded from this device."
          onRetry={() => setRefresh((value) => value + 1)}
          title="Sale unavailable"
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        className="flex-1"
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        data={sale.items}
        keyExtractor={(item) => item.productId}
        ListHeaderComponent={
          <View className="gap-4 pb-2">
            <Button label="Back to sales" onPress={() => router.back()} variant="secondary" />
            <View className="gap-1">
              <Text className="text-2xl font-bold text-ink">Sale details</Text>
              <Text className="text-sm text-muted">
                {new Date(sale.occurredAt).toLocaleString()}
              </Text>
              {sale.customerName ? (
                <Text className="text-sm text-muted">Customer: {sale.customerName}</Text>
              ) : null}
              <Text className="text-sm text-muted">Payment label: {sale.paymentMethod}</Text>
            </View>
            <Text
              accessibilityLabel="Pending sync, provisional sale"
              className="self-start rounded-full bg-warningSurface px-3 py-1 text-xs font-semibold text-warning"
            >
              Pending sync · provisional
            </Text>
            <Text className="text-sm text-muted">
              This amount is stored locally and is not a payment confirmation.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View className="mt-2 gap-1 rounded-2xl bg-brand-50 p-4">
            <Text className="text-sm font-medium text-muted">Provisional local total</Text>
            <Text className="text-xl font-bold text-ink">
              {formatMinorCurrency(sale.totalMinor)}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="gap-2 rounded-2xl border border-border bg-surface p-4">
            <Text className="text-base font-semibold text-ink">{item.productNameSnapshot}</Text>
            <Text className="text-sm text-muted">SKU: {item.skuSnapshot}</Text>
            <Text className="text-sm text-muted">
              {item.quantity} × {formatMinorCurrency(item.unitPriceMinor)}
            </Text>
            <Text className="font-semibold text-ink">
              {formatMinorCurrency(item.lineTotalMinor)}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}
