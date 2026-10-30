import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/** What's running: the installed build, or the over-the-air update on top of it. */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '?';
  if (!Updates.isEnabled || Updates.isEmbeddedLaunch || !Updates.createdAt) return `App ${version}, as installed.`;
  const when = Updates.createdAt.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `App ${version}, updated ${when}.`;
}

/** Fetch the newest update and restart into it, instead of waiting for the next launch. Returns what to tell the user. */
export async function installLatestUpdate(): Promise<string> {
  if (!Updates.isEnabled) return 'Updates only work in the installed app.';
  const { isAvailable } = await Updates.checkForUpdateAsync();
  if (!isAvailable) return 'Zona is up to date.';
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return 'Restarting into the update.';
}
