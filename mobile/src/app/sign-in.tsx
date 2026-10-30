import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Btn } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth-store';

export default function SignInScreen() {
  const theme = useTheme();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const { token } = await api.login(password);
      setPassword('');
      await useAuthStore.getState().signedIn(token); // the root layout's guard moves on to the tabs
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Zona's server.");
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: theme.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <Text style={[styles.title, { color: theme.ink }]} accessibilityRole="header">Zona</Text>
        <Text style={[styles.lead, { color: theme.ink2 }]}>Your training, sleep and water, from Garmin.</Text>
        <TextInput style={[styles.input, { borderColor: theme.line, backgroundColor: theme.bg, color: theme.ink }]} value={password} onChangeText={setPassword}
          secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" placeholder="Password" placeholderTextColor={theme.muted}
          accessibilityLabel="Password" onSubmitEditing={() => void submit()} returnKeyType="go" />
        <Btn label={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !password} onPress={() => void submit()} />
        {error ? <Text style={[styles.error, { color: theme.badInk }]} accessibilityRole="alert">{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 16 },
  card: { borderRadius: 20, padding: 20, gap: 12 },
  title: { fontSize: 44, fontWeight: '800', letterSpacing: -0.8 },
  lead: { fontSize: 14.5, lineHeight: 20 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 16 },
  error: { fontSize: 13.5 },
});
