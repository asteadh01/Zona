import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { NotificationResponses } from '@/features/notifications/notification-responses';
import { configureNotifications, refreshPushToken } from '@/services/notifications';
import { useAuthStore } from '@/store/auth-store';

void SplashScreen.preventAutoHideAsync();
void configureNotifications().catch(() => undefined); // only the buttons on a notification are lost, and it retries next launch

export default function RootLayout() {
  const token = useAuthStore((state) => state.token);
  const ready = useAuthStore((state) => state.ready);

  useEffect(() => {
    void useAuthStore.getState().load();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (token) void refreshPushToken().catch(() => undefined);
  }, [token]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!token}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="garmin-shapes" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!token}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
      {token && Platform.OS !== 'web' ? <NotificationResponses onOpen={(href) => router.navigate(href)} /> : null}
    </>
  );
}
