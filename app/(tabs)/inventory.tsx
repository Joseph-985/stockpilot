import { Platform } from 'react-native';

import { InventoryScreen } from '@/features/inventory/presentation/InventoryScreen';
import { FeaturePlaceholder } from '@/shared/ui/FeaturePlaceholder';

export default function InventoryRoute() {
  if (Platform.OS === 'web') {
    return (
      <FeaturePlaceholder
        description="Local inventory is available in the Android and iOS apps."
        title="Inventory"
      />
    );
  }
  return <InventoryScreen />;
}
