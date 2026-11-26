import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import type { Product } from '../domain/product';
import { formatMinorCurrency } from '@/shared/domain/money';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';

type ProductsListProps = {
  products: Product[];
  query: string;
  loading: boolean;
  error: string | null;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
};

export function ProductsList({
  products,
  query,
  loading,
  error,
  onQueryChange,
  onRetry,
  onAdd,
  onEdit,
  onArchive,
}: ProductsListProps) {
  return (
    <FlatList
      className="flex-1"
      contentContainerStyle={{ flexGrow: 1, gap: 12, paddingBottom: 24 }}
      data={loading || error ? [] : products}
      keyboardShouldPersistTaps="handled"
      keyExtractor={(product) => product.id}
      ListHeaderComponent={
        <View className="gap-4 pb-2">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-sm font-medium text-brand-700">StockPilot</Text>
              <Text className="text-2xl font-bold text-ink">Products</Text>
            </View>
            <Button label="Add product" onPress={onAdd} />
          </View>
          <View className="gap-1.5">
            <Text className="text-sm font-medium text-ink">Search products</Text>
            <TextInput
              accessibilityLabel="Search products by name or SKU"
              className="min-h-12 rounded-xl border border-border bg-surface px-3 text-base text-ink"
              onChangeText={onQueryChange}
              placeholder="Name or SKU"
              placeholderTextColor="#667085"
              returnKeyType="search"
              value={query}
            />
          </View>
        </View>
      }
      ListEmptyComponent={
        error ? (
          <ErrorState message={error} onRetry={onRetry} title="Products could not be loaded" />
        ) : loading ? (
          <LoadingIndicator label="Loading products" />
        ) : products.length === 0 ? (
          <EmptyState
            description={
              query.trim()
                ? 'Try another product name or SKU.'
                : 'Add your first product to keep your catalog available offline.'
            }
            title={query.trim() ? 'No matching products' : 'No products yet'}
          />
        ) : null
      }
      renderItem={({ item }) => (
        <View className="gap-3 rounded-2xl border border-border bg-surface p-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="text-base font-semibold text-ink">{item.name}</Text>
              <Text className="text-sm text-muted">SKU: {item.sku}</Text>
              {item.category ? <Text className="text-sm text-muted">{item.category}</Text> : null}
            </View>
            {item.syncStatus === 'pending' ? (
              <View
                accessible
                accessibilityLabel="Pending sync"
                className="rounded-full bg-warningSurface px-3 py-1"
              >
                <Text className="text-xs font-semibold text-warning">Pending sync</Text>
              </View>
            ) : null}
          </View>
          <Text className="text-lg font-bold text-ink">{formatMinorCurrency(item.priceMinor)}</Text>
          <View className="flex-row gap-2">
            <Pressable
              accessibilityLabel={`Edit ${item.name}`}
              accessibilityRole="button"
              className="min-h-12 flex-1 items-center justify-center rounded-xl border border-border px-3"
              onPress={() => onEdit(item)}
            >
              <Text className="font-semibold text-ink">Edit</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Archive ${item.name}`}
              accessibilityRole="button"
              className="min-h-12 flex-1 items-center justify-center rounded-xl border border-danger px-3"
              onPress={() => onArchive(item)}
            >
              <Text className="font-semibold text-danger">Archive</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}
