import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// The session token lives in the iPhone's Keychain. The browser build, used only to preview screens during
// development, has no Keychain, so it falls back to localStorage.
const KEY = 'zona.session';
const onWeb = Platform.OS === 'web';

export async function loadToken(): Promise<string | null> {
  return onWeb ? localStorage.getItem(KEY) : SecureStore.getItemAsync(KEY);
}

export async function saveToken(token: string): Promise<void> {
  if (onWeb) localStorage.setItem(KEY, token);
  else await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  if (onWeb) localStorage.removeItem(KEY);
  else await SecureStore.deleteItemAsync(KEY);
}
