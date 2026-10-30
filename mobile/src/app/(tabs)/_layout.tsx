import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/constants/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(outline: IconName, filled: IconName) {
  return function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
  };
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: theme.accent,
      tabBarInactiveTintColor: theme.muted,
      tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.line },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline', 'home') }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: icon('bar-chart-outline', 'bar-chart') }} />
      <Tabs.Screen name="train" options={{ title: 'Train', tabBarIcon: icon('stopwatch-outline', 'stopwatch') }} />
      <Tabs.Screen name="water" options={{ title: 'Water', tabBarIcon: icon('water-outline', 'water') }} />
    </Tabs>
  );
}
