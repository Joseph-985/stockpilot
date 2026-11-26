import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { Screen } from '@/shared/ui/Screen';
import { createProduct } from '../application/productUseCases';
import { ProductForm } from './ProductForm';
import { useProductServices } from './ProductServicesContext';

export function NewProductScreen() {
  const { repository, storeId } = useProductServices();

  return (
    <Screen>
      <View className="flex-1 gap-4">
        <View className="gap-1">
          <Text className="text-sm font-medium text-brand-700">Products</Text>
          <Text className="text-2xl font-bold text-ink">Add product</Text>
        </View>
        <ProductForm
          onCancel={() => router.back()}
          onSubmit={async (draft) => {
            await createProduct(repository, storeId, draft);
            router.back();
          }}
          submitLabel="Save product"
        />
      </View>
    </Screen>
  );
}
