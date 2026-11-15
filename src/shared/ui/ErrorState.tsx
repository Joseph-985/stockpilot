import { Text, View } from 'react-native';

import { Button } from './Button';

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <View accessibilityRole="alert" className="gap-3 rounded-2xl bg-dangerSurface p-5">
      <Text className="text-base font-semibold text-danger">{title}</Text>
      <Text className="text-sm text-ink">{message}</Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}
