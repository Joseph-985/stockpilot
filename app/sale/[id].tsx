import { useLocalSearchParams } from 'expo-router';

import { SaleDetailScreen } from '@/features/sales/presentation/SaleDetailScreen';

export default function SaleDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SaleDetailScreen saleId={id} />;
}
