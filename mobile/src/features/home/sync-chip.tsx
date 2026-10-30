import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { api } from '@/services/api';
import type { SyncStatus } from '@/types/api';

function syncLabel(sync: SyncStatus, nowIso: string): { text: string; good: boolean } {
  if (sync.status === 'key') return { text: 'Garmin key refused', good: false };
  if (sync.status === 'error') return { text: 'Sync failed · retry', good: false };
  if (!sync.last) return { text: 'Not synced yet', good: false };
  const minutes = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(sync.last).getTime()) / 60000));
  return { text: minutes < 1 ? 'Synced just now' : minutes < 90 ? `Synced ${minutes} min ago` : `Synced ${Math.round(minutes / 60)} h ago`, good: true };
}

type ChipProps = { sync: SyncStatus; now: string; onSynced: () => void };

/** The freshness dot; tapping it syncs now. */
export function SyncChip({ sync, now, onSynced }: ChipProps) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const { text, good } = syncLabel(sync, now);
  const press = async () => {
    setBusy(true);
    await api.sync().catch(() => undefined);
    setBusy(false);
    onSynced();
  };
  return (
    <Pressable style={styles.chip} onPress={() => void press()} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${text}. Sync now`}>
      <View style={[styles.dot, { backgroundColor: good ? theme.good : theme.critical }]} />
      <Text style={[styles.text, { color: theme.ink2 }]}>{busy ? 'Syncing…' : text}</Text>
    </Pressable>
  );
}

export function SyncBanner({ sync }: { sync: SyncStatus }) {
  if (sync.status === 'key') {
    return <Banner title="Zona can't reach Garmin">Garmin refused your Personal API key, so nothing new is syncing. Create a new key in Garmin Connect › Settings › Personal API Key and update Zona's server.</Banner>;
  }
  if (sync.status === 'error') {
    return <Banner title="Last sync didn't finish">{`${sync.error ?? 'Garmin did not answer'}. Zona tries again on its own.`}</Banner>;
  }
  return null;
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6, minHeight: 28 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12 },
});
