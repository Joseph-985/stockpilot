import { Text, View } from 'react-native';

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <View accessibilityRole="summary" className="items-center gap-2 rounded-2xl bg-surface p-6">
      <Text className="text-lg font-semibold text-ink">{title}</Text>
      <Text className="text-center text-sm text-muted">{description}</Text>
    </View>
  );
}
