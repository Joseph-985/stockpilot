import '../global.css';

import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';

import { initializeDatabase } from '@/shared/infrastructure/db/initializeDatabase';

export default function RootLayout() {
  const navigator = (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );

  if (Platform.OS === 'web') return navigator;

  return (
    <SQLiteProvider databaseName="stockpilot.db" onInit={initializeDatabase}>
      {navigator}
    </SQLiteProvider>
  );
}
