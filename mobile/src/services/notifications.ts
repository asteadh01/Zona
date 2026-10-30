import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/services/api';

// Web previews have no push; every entry point here is a no-op there.
const supported = Platform.OS !== 'web';

/** Show nudges even with the app open, and register the buttons the server's categoryId asks for. */
export async function configureNotifications(): Promise<void> {
  if (!supported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  const open = { opensAppToForeground: true };
  await Notifications.setNotificationCategoryAsync('nudge', [
    { identifier: 'log', buttonTitle: 'Log it', options: open },
    { identifier: 'add250', buttonTitle: '+250 ml', options: open },
  ]);
  await Notifications.setNotificationCategoryAsync('reminder', [
    { identifier: 'add250', buttonTitle: '+250 ml', options: open },
    { identifier: 'add500', buttonTitle: '+500 ml', options: open },
  ]);
}

export type PushResult = { ok: true; devices: number } | { ok: false; message: string };

/** Ask for permission if needed, then tell the server this phone's Expo push token. */
export async function enablePush(): Promise<PushResult> {
  if (!supported) return { ok: false, message: 'Notifications only work in the iPhone app.' };
  if (!Device.isDevice) return { ok: false, message: 'Notifications need a real iPhone, not a simulator.' };
  const current = await Notifications.getPermissionsAsync();
  const { granted } = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!granted) return { ok: false, message: 'Notifications are off for Zona. Turn them on in iPhone Settings › Notifications › Zona.' };
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return { ok: false, message: 'This build has no EAS project ID. Run `npx eas-cli init` in mobile/ and build again.' };
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { devices } = await api.registerPush(token);
  return { ok: true, devices };
}

/** Quietly refresh the token on launch once permission exists, because iOS can change it. */
export async function refreshPushToken(): Promise<void> {
  if (!supported || !Device.isDevice) return;
  const { granted } = await Notifications.getPermissionsAsync();
  if (granted) await enablePush();
}
