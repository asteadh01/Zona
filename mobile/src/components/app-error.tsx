import type { ErrorBoundaryProps } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Btn, Lead } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { installLatestUpdate } from '@/services/app-updates';

/**
 * What shows when a screen fails to draw, instead of the app closing. Looking for an update is the way out of a bad
 * over-the-air update, so this mustn't depend on the API or on any screen working.
 */
export function AppError({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const update = async () => {
    setMessage('Checking…');
    try {
      setMessage(await installLatestUpdate());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't check for an update.");
    }
  };
  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.ink }]} accessibilityRole="header">Something went wrong</Text>
        <Lead>Zona couldn't draw this screen. Your data is safe on the server.</Lead>
        <Btn label="Try again" onPress={() => void retry()} />
        <Btn label="Check for an app update" kind="ghost" onPress={() => void update()} />
        {message ? <Lead>{message}</Lead> : null}
        <Text selectable style={[styles.detail, { color: theme.muted }]}>{error.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  content: { gap: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  detail: { fontSize: 12 },
});
