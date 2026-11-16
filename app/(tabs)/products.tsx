import { Platform } from 'react-native';

import { ProductsScreen } from '@/features/products/presentation/ProductsScreen';
import { FeaturePlaceholder } from '@/shared/ui/FeaturePlaceholder';

export default function ProductsRoute() {
  if (Platform.OS === 'web') {
    return (
      <FeaturePlaceholder
        description="The local SQLite product catalog is available in the Android and iOS apps."
        title="Products"
      />
    );
  }
  return <ProductsScreen />;
}
