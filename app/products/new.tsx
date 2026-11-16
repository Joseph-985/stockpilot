import { Platform } from 'react-native';

import { NewProductScreen } from '@/features/products/presentation/NewProductScreen';
import { FeaturePlaceholder } from '@/shared/ui/FeaturePlaceholder';

export default function NewProductRoute() {
  if (Platform.OS === 'web') {
    return (
      <FeaturePlaceholder
        description="The local SQLite product catalog is available in the Android and iOS apps."
        title="Add product"
      />
    );
  }
  return <NewProductScreen />;
}
