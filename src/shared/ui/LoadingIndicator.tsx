import { ActivityIndicator, Text, View } from 'react-native';

type LoadingIndicatorProps = {
  label?: string;
};

export function LoadingIndicator({ label = 'Loading' }: LoadingIndicatorProps) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      className="items-center gap-3 p-6"
    >
      <ActivityIndicator color="#2563eb" />
      <Text className="text-sm text-muted">{label}</Text>
    </View>
  );
}
