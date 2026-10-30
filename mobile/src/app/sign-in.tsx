import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { LogoMark } from '@/components/logo';
import { Btn } from '@/components/ui';
import { useTheme, zoneColors } from '@/constants/theme';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth-store';

const LOGO_SIZE = 128;
const LOGO_SIZE_TYPING = 72; // leaves room for the form above the keyboard on small iPhones

export default function SignInScreen() {
  const theme = useTheme();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
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
      <Pressable style={styles.content} onPress={Keyboard.dismiss} accessible={false}>
        <LogoMark size={typing ? LOGO_SIZE_TYPING : LOGO_SIZE} ramp={zoneColors(theme)} ink={theme.ink} />
        <Text style={[styles.title, { color: theme.ink }]} accessibilityRole="header">Zona</Text>
        {typing ? null : <Text style={[styles.lead, { color: theme.ink2 }]}>Your training, sleep and water, from Garmin.</Text>}
        <View style={styles.form}>
          <TextInput style={[styles.input, { borderColor: typing ? theme.accent : theme.line, backgroundColor: theme.surface, color: theme.ink }]} value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" placeholder="Password" placeholderTextColor={theme.muted}
            accessibilityLabel="Password" onSubmitEditing={() => void submit()} returnKeyType="go" onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />
          <Btn label={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !password} onPress={() => void submit()} />
          {error ? <Text style={[styles.error, { color: theme.badInk }]} accessibilityRole="alert">{error}</Text> : null}
        </View>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 12 },
  title: { fontSize: 44, fontWeight: '800', letterSpacing: -0.8 },
  lead: { fontSize: 14.5, lineHeight: 20, textAlign: 'center' },
  form: { alignSelf: 'stretch', gap: 12 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 16 },
  error: { fontSize: 13.5, textAlign: 'center' },
});
