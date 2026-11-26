import { useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';

import { ProductMovementHistoryScreen } from '@/features/inventory/presentation/ProductMovementHistoryScreen';
import { FeaturePlaceholder } from '@/shared/ui/FeaturePlaceholder';

export default function ProductInventoryRoute() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  if (Platform.OS === 'web')
    return (
      <FeaturePlaceholder title="Movement history" description="Available on Android and iOS." />
    );
  return <ProductMovementHistoryScreen productId={productId} />;
}
