import type { PropsWithChildren } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView className="flex-1 bg-canvas px-5 pt-4" edges={['top', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}
