import { useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';

import { EditProductScreen } from '@/features/products/presentation/EditProductScreen';
import { FeaturePlaceholder } from '@/shared/ui/FeaturePlaceholder';

export default function EditProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (Platform.OS === 'web') {
    return (
      <FeaturePlaceholder
        description="The local SQLite product catalog is available in the Android and iOS apps."
        title="Edit product"
      />
    );
  }
  return <EditProductScreen productId={id} />;
}
