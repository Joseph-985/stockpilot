import type { PropsWithChildren } from 'react';
import { Pressable, Text } from 'react-native';

type ButtonProps = PropsWithChildren<{
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}>;

const variants = {
  primary: 'bg-brand-600 active:bg-brand-700',
  secondary: 'border border-border bg-surface active:bg-canvas',
} as const;

const labelVariants = {
  primary: 'text-white',
  secondary: 'text-ink',
} as const;

export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`min-h-12 items-center justify-center rounded-xl px-4 py-3 ${variants[variant]} ${disabled ? 'opacity-50' : ''}`}
      disabled={disabled}
      onPress={onPress}
    >
      <Text className={`text-sm font-semibold ${labelVariants[variant]}`}>{label}</Text>
    </Pressable>
  );
}
