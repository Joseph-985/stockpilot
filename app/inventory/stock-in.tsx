import { useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';

import { StockMutationScreen } from '@/features/inventory/presentation/StockMutationScreen';
import { FeaturePlaceholder } from '@/shared/ui/FeaturePlaceholder';

export default function StockInRoute() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  if (Platform.OS === 'web')
    return <FeaturePlaceholder title="Stock in" description="Available on Android and iOS." />;
  return <StockMutationScreen mode="stock_in" productId={productId} />;
}
