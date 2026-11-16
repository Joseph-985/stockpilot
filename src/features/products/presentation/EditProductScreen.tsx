import { useCallback, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { archiveProduct, getProduct, updateProduct } from '../application/productUseCases';
import type { Product } from '../domain/product';
import { ProductForm, toProductFormValues } from './ProductForm';
import { useProductServices } from './ProductServicesContext';
import { formatMinorAsDecimal } from '@/shared/domain/money';
import { ErrorState } from '@/shared/ui/ErrorState';
import { LoadingIndicator } from '@/shared/ui/LoadingIndicator';
import { Screen } from '@/shared/ui/Screen';

type EditProductScreenProps = {
  productId: string;
};

export function EditProductScreen({ productId }: EditProductScreenProps) {
  const { repository, storeId } = useProductServices();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const retryKeyRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      setLoading(true);
      setError(null);
      void (async () => {
        try {
          const requestedRetry = retryKey;
          const result = await getProduct(repository, storeId, productId);
          if (isActive && requestedRetry === retryKeyRef.current) {
            setProduct(result);
            if (!result) setError('This product is no longer in the active catalog.');
          }
        } catch {
          if (isActive && retryKey === retryKeyRef.current) {
            setError('The product could not be loaded from local storage.');
          }
        } finally {
          if (isActive) setLoading(false);
        }
      })();
      return () => {
        isActive = false;
      };
    }, [productId, repository, retryKey, storeId]),
  );

  const confirmArchive = useCallback(() => {
    if (!product) return;
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
                router.back();
              } catch {
                setError('This product could not be archived. Its local record was kept.');
              }
            })();
          },
        },
      ],
    );
  }, [product, repository, router, storeId]);

  return (
    <Screen>
      <View className="flex-1 gap-4">
        <View className="gap-1">
          <Text className="text-sm font-medium text-brand-700">Products</Text>
          <Text className="text-2xl font-bold text-ink">Edit product</Text>
        </View>
        {loading ? (
          <LoadingIndicator label="Loading product" />
        ) : error || !product ? (
          <ErrorState
            message={error ?? 'This product could not be found.'}
            onRetry={() => {
              retryKeyRef.current += 1;
              setRetryKey(retryKeyRef.current);
            }}
            title="Product unavailable"
          />
        ) : (
          <ProductForm
            initialValues={toProductFormValues({
              sku: product.sku,
              name: product.name,
              price: formatMinorAsDecimal(product.priceMinor),
              cost: product.costMinor == null ? null : formatMinorAsDecimal(product.costMinor),
              category: product.category,
              description: product.description,
              lowStockThreshold: product.lowStockThreshold,
            })}
            onArchive={confirmArchive}
            onCancel={() => router.back()}
            onSubmit={async (draft) => {
              await updateProduct(repository, storeId, product.id, draft);
              router.back();
            }}
            submitLabel="Save changes"
          />
        )}
      </View>
    </Screen>
  );
}
