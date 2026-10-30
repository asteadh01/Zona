import { create } from 'zustand';

import { clearToken, loadToken, saveToken } from '@/services/token-storage';

type AuthState = {
  token: string | null;
  ready: boolean; // false until the Keychain has been read, so the app doesn't flash the sign-in screen
  load: () => Promise<void>;
  signedIn: (token: string) => Promise<void>;
  signedOut: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  ready: false,
  load: async () => {
    const token = await loadToken().catch(() => null);
    set({ token, ready: true });
  },
  signedIn: async (token) => {
    await saveToken(token);
    set({ token });
  },
  signedOut: async () => {
    await clearToken().catch(() => undefined);
    set({ token: null });
  },
}));
