import { Text, View } from 'react-native';

import { EmptyState } from './EmptyState';
import { Screen } from './Screen';

type FeaturePlaceholderProps = {
  title: string;
  description: string;
};

export function FeaturePlaceholder({ title, description }: FeaturePlaceholderProps) {
  return (
    <Screen>
      <View className="gap-5">
        <View className="gap-1">
          <Text className="text-sm font-medium text-brand-700">StockPilot</Text>
          <Text className="text-2xl font-bold text-ink">{title}</Text>
        </View>
        <EmptyState title="Foundation is ready" description={description} />
      </View>
    </Screen>
  );
}
