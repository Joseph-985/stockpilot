import { Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

type TextFieldProps = TextInputProps & {
  label: string;
  errorMessage?: string;
};

export function TextField({
  label,
  errorMessage,
  accessibilityLabel,
  ...inputProps
}: TextFieldProps) {
  const invalid = Boolean(errorMessage);

  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-ink">{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={inputProps.accessibilityHint ?? errorMessage}
        accessibilityState={{ disabled: inputProps.editable === false }}
        className={`min-h-12 rounded-xl border bg-surface px-3 text-base text-ink ${invalid ? 'border-danger' : 'border-border'}`}
        placeholderTextColor="#667085"
      />
      {errorMessage ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}
