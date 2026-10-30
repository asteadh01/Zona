// Set here, not in eas.json: build profile settings don't reach `eas update`, and an update without an address would point the app at localhost.
export const LIVE_API = 'https://zona-jzdswiuy2a-uc.a.run.app';
const LOCAL_API = 'http://localhost:8000';

/** An EXPO_PUBLIC_ZONA_API in mobile/.env wins, for trying the app against another server. */
export function apiBase(override: string | undefined, isDev: boolean): string {
  return (override || (isDev ? LOCAL_API : LIVE_API)).replace(/\/$/, '');
}
