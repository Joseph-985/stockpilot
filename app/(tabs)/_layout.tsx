import { Tabs } from 'expo-router';

const routes = [
  { name: 'index', label: 'Dashboard' },
  { name: 'products', label: 'Products' },
  { name: 'sales', label: 'Sales' },
  { name: 'settings', label: 'Settings' },
] as const;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1d4ed8',
        tabBarInactiveTintColor: '#667085',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { minHeight: 64, paddingTop: 8, paddingBottom: 8 },
      }}
    >
      {routes.map(({ name, label }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ title: label, tabBarLabel: label, tabBarAccessibilityLabel: `${label} tab` }}
        />
      ))}
    </Tabs>
  );
}
