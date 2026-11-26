import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useProductServices } from '@/features/products/presentation/ProductServicesContext';
import { useInventoryServices } from '@/features/inventory/presentation/InventoryServicesContext';
import { useSalesServices } from '@/features/sales/presentation/SalesServicesContext';
import type { DailySalesSummary } from '@/features/sales/domain/SaleRepository';
import { formatMinorCurrency } from '@/shared/domain/money';
import { Button } from '@/shared/ui/Button';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';

type Summary = DailySalesSummary & { lowStockCount: number };

function localDayBounds(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  // The demo store is in Nigeria (UTC+01:00); use its day boundary even if
  // the device has a different timezone configured.
  const start = new Date(Date.UTC(year, month - 1, day, -1));
  const end = new Date(Date.UTC(year, month - 1, day + 1, -1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function DashboardScreen() {
  const { repository: products, storeId } = useProductServices();
  const { repository: inventory } = useInventoryServices();
  const { repository: sales } = useSalesServices();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
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
      const bounds = localDayBounds(new Date());
      void Promise.all([
        sales.getDailySummary(storeId, bounds.start, bounds.end),
        products.list(storeId),
        inventory.listBalances(storeId),
      ])
        .then(([daily, productRows, balances]) => {
          if (!active || refresh !== latestRefresh.current) return;
          const balanceById = new Map(balances.map((balance) => [balance.productId, balance]));
          const lowStockCount = productRows.filter((product) => {
            const available = balanceById.get(product.id)?.estimatedAvailable ?? 0;
            return available <= product.lowStockThreshold;
          }).length;
          setSummary({ ...daily, lowStockCount });
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
    }, [inventory, products, refresh, sales, storeId]),
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
        <View className="gap-1">
          <Text className="text-sm font-medium text-brand-700">StockPilot</Text>
          <Text className="text-2xl font-bold text-ink">Dashboard</Text>
          <Text className="text-sm text-muted">
            Local business snapshot · provisional until sync.
          </Text>
        </View>
        {loading ? <LoadingIndicator label="Loading dashboard" /> : null}
        {error ? (
          <ErrorState
            message="Sales and inventory summaries could not be loaded from this device."
            onRetry={() => setRefresh((value) => value + 1)}
            title="Dashboard unavailable"
          />
        ) : null}
        {!loading && !error && summary ? (
          <>
            <View className="gap-2 rounded-2xl border border-border bg-surface p-5">
              <Text className="text-sm font-medium text-muted">Today’s local sales total</Text>
              <Text className="text-2xl font-bold text-ink">
                {formatMinorCurrency(summary.totalMinor)}
              </Text>
              <Text className="text-sm text-muted">
                {summary.count} saved · {summary.pendingCount} pending sync
              </Text>
              <Text className="text-xs text-muted">
                Includes provisional sales recorded on this device; not server-confirmed.
              </Text>
            </View>
            <View className="gap-2 rounded-2xl border border-border bg-surface p-5">
              <Text className="text-sm font-medium text-muted">Low-stock products</Text>
              <Text className="text-2xl font-bold text-ink">{summary.lowStockCount}</Text>
              <Text className="text-xs text-muted">Based on local estimated availability.</Text>
            </View>
            <Button label="View sales" onPress={() => router.push('/sales')} />
            <Button
              label="Create sale"
              onPress={() => router.push({ pathname: '/sale/new' })}
              variant="secondary"
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
