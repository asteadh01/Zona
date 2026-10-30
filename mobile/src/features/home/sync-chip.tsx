import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { api } from '@/services/api';
import type { SyncStatus } from '@/types/api';

function syncLabel(sync: SyncStatus, nowIso: string): { text: string; good: boolean } {
  if (sync.status === 'key') return { text: 'Garmin key refused', good: false };
  if (sync.status === 'error') return { text: 'Sync failed', good: false };
  if (!sync.last) return { text: 'Not synced yet', good: false };
  const minutes = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(sync.last).getTime()) / 60000));
  return { text: minutes < 1 ? 'Synced just now' : minutes < 90 ? `Synced ${minutes} min ago` : `Synced ${Math.round(minutes / 60)} h ago`, good: true };
}

/** The small button at the top right of Home. */
export function SyncButton({ onSynced }: { onSynced: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const press = async () => {
    setBusy(true);
    try {
      await api.sync();
      setFailed(false);
    } catch {
      setFailed(true); // the status line only knows what the server last managed, and this never reached it
    }
    setBusy(false);
    onSynced();
  };
  const label = busy ? 'Syncing…' : failed ? 'Try again' : 'Sync now';
  return (
    <Pressable style={({ pressed }) => [styles.button, { backgroundColor: theme.surface2 }, (pressed || busy) && styles.dim]}
      onPress={() => void press()} disabled={busy} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }}>
      <Ionicons name="refresh" size={13} color={theme.ink} />
      <Text style={[styles.buttonText, { color: theme.ink }]}>{label}</Text>
    </Pressable>
  );
}

type ChipProps = { sync: SyncStatus; now: string; onSynced: () => void };

/** The button, with how fresh the data is underneath. */
export function SyncChip({ sync, now, onSynced }: ChipProps) {
  const theme = useTheme();
  const { text, good } = syncLabel(sync, now);
  return (
    <View style={styles.chip}>
      <SyncButton onSynced={onSynced} />
      <View style={styles.status}>
        <View style={[styles.dot, { backgroundColor: good ? theme.good : theme.critical }]} />
        <Text style={[styles.text, { color: theme.ink2 }]}>{text}</Text>
      </View>
    </View>
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
  chip: { alignItems: 'flex-end', gap: 5, paddingBottom: 4 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 11, borderRadius: 16 },
  buttonText: { fontSize: 12.5, fontWeight: '600' },
  dim: { opacity: 0.6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  text: { fontSize: 11.5 },
});
