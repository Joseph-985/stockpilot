import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { archiveProduct, listProducts } from '../application/productUseCases';
import type { Product } from '../domain/product';
import { useProductServices } from './ProductServicesContext';
import { Screen } from '@/shared/ui/Screen';
import { ProductsList } from './ProductsList';

export function ProductsScreen() {
  const { repository, storeId } = useProductServices();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshKeyRef = useRef(0);
  const requestRefresh = useCallback(() => {
    refreshKeyRef.current += 1;
    setRefreshKey(refreshKeyRef.current);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      setError(null);

      void (async () => {
        try {
          const requestedRefresh = refreshKey;
          const nextProducts = await listProducts(repository, storeId, query);
          if (isActive && requestedRefresh === refreshKeyRef.current) setProducts(nextProducts);
        } catch {
          if (isActive && refreshKey === refreshKeyRef.current) {
            setError('Your local product catalog could not be read. Please try again.');
          }
        } finally {
          if (isActive) setLoading(false);
        }
      })();

      return () => {
        isActive = false;
      };
    }, [query, refreshKey, repository, storeId]),
  );

  const confirmArchive = useCallback(
    (product: Product) => {
      Alert.alert(
        'Archive product?',
        `${product.name} will be hidden from the active catalog. Its local record will be kept.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Archive',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await archiveProduct(repository, storeId, product.id);
                  requestRefresh();
                } catch {
                  setError(
                    'This product could not be archived. Your product data was not removed.',
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [repository, requestRefresh, storeId],
  );

  return (
    <Screen>
      <ProductsList
        error={error}
        loading={loading}
        onAdd={() => router.push('../products/new')}
        onArchive={confirmArchive}
        onEdit={(product) => router.push(`../products/${product.id}/edit`)}
        onQueryChange={setQuery}
        onRetry={requestRefresh}
        products={products}
        query={query}
      />
    </Screen>
  );
}
