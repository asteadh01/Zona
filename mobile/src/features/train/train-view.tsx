import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Btn, BtnRow, Card, Done, Lead, MultiSeg, Note, Seg, SetRow, SportChip } from '@/components/ui';
import { SPORT_LABEL, SPORT_ORDER, type Sport, type Theme, useTheme } from '@/constants/theme';
import { api } from '@/services/api';
import { appVersionLabel, installLatestUpdate } from '@/services/app-updates';
import { enablePush } from '@/services/notifications';
import { useAuthStore } from '@/store/auth-store';
import type { Me, PlanItem, SyncStatus } from '@/types/api';
import { WEEK_ROWS, dur, hhmm, parseTime } from '@/utils/format';

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SYNC_LABEL: Record<SyncStatus['status'], string> = { ok: 'working', key: 'key refused', error: 'last try failed', never: 'not yet' };

type PlanProps = { plan: PlanItem[]; onChanged: () => void };

function WeekPlan({ plan, onChanged }: PlanProps) {
  const theme = useTheme();
  return (
    <Card title="Every week" sub={`${plan.length} session${plan.length === 1 ? '' : 's'}`}>
      {plan.length === 0 ? <Lead>Add the sessions you usually do. Zona uses them for the daily call, for checking Garmin more often right after a session, and for sending one nudge after back-to-back sessions.</Lead> : null}
      {WEEK_ROWS.map((day, i) => {
        const items = plan.filter((p) => p.weekday === i);
        if (!items.length) return null;
        return (
          <View key={day} style={styles.day}>
            <Text style={[styles.dayHead, { color: theme.muted }]} accessibilityRole="header">{day.toUpperCase()}</Text>
            {items.map((p) => (
              <View key={p.id} style={styles.item}>
                <SportChip sport={p.sport} />
                <View style={styles.flex}>
                  <Text style={[styles.itemName, { color: theme.ink }]}>{p.name}</Text>
                  <Text style={[styles.itemSub, { color: theme.muted }]}>{`${p.start_h === null ? 'Maybe, no set time' : hhmm(p.start_h)} · ${dur(p.minutes)}`}</Text>
                </View>
                <Btn label="Remove" kind="quiet" onPress={() => void api.deletePlan(p.id).then(onChanged)} />
              </View>
            ))}
          </View>
        );
      })}
    </Card>
  );
}

const DAY_OPTIONS = WEEK_ROWS.map((label, value) => ({ value, label, fullName: FULL_DAYS[value] }));
const TIMING = [{ value: 'set', label: 'At a set time' }, { value: 'open', label: 'No set time' }] as const;

function AddSession({ onChanged }: { onChanged: () => void }) {
  const theme = useTheme();
  const [days, setDays] = useState<number[]>([]);
  const [timing, setTiming] = useState<'set' | 'open'>('set');
  const [start, setStart] = useState('18:00');
  const [minutes, setMinutes] = useState('45');
  const [sport, setSport] = useState<Sport>('run');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const input = inputStyle(theme);
  const toggleDay = (day: number) => {
    setAdded(null);
    setDays((now) => (now.includes(day) ? now.filter((d) => d !== day) : [...now, day].sort((a, b) => a - b)));
  };
  const add = async () => {
    const hours = parseTime(start);
    const length = Number(minutes);
    setAdded(null);
    if (!days.length) return setError('Pick at least one day.');
    if (timing === 'set' && hours == null) return setError('Starts needs a time like 18:00 or 6pm.');
    if (!Number.isInteger(length) || length < 5 || length > 600) return setError('Minutes needs a number from 5 to 600.');
    try {
      await api.addPlan({ weekdays: days, start: timing === 'set' ? hhmm(hours as number) : null, minutes: length, sport, name: name.trim() || SPORT_LABEL[sport] });
      setError(null);
      setAdded(`Added to ${days.length} day${days.length === 1 ? '' : 's'}.`);
      setDays([]);
      setName('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that.");
    }
  };
  return (
    <Card title="Add a session" sub="pick as many days as you like">
      <MultiSeg label="Days" options={DAY_OPTIONS} values={days} onToggle={toggleDay} />
      <BtnRow>
        <Btn label="Mon to Fri" kind="quiet" onPress={() => setDays([0, 1, 2, 3, 4])} />
        <Btn label="Clear" kind="quiet" disabled={!days.length} onPress={() => setDays([])} />
      </BtnRow>
      <Seg label="Sport" value={sport} onChange={setSport} options={SPORT_ORDER.map((value) => ({ value, label: value === 'strength' ? 'Gym' : SPORT_LABEL[value] }))} />
      <Seg label="When" value={timing} onChange={setTiming} options={TIMING} />
      <View style={styles.fields}>
        {timing === 'set' ? (
          <View style={styles.flex}>
            <Text style={[styles.fieldLabel, { color: theme.muted }]}>Starts</Text>
            <TextInput style={input} value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" autoCapitalize="none" accessibilityLabel="Start time" placeholder="18:00 or 6pm" placeholderTextColor={theme.muted} />
          </View>
        ) : null}
        <View style={styles.flex}>
          <Text style={[styles.fieldLabel, { color: theme.muted }]}>Minutes</Text>
          <TextInput style={input} value={minutes} onChangeText={setMinutes} keyboardType="number-pad" accessibilityLabel="Minutes" />
        </View>
      </View>
      {timing === 'open' ? <Note>For a session that may not happen. It shows as a maybe that day and the daily call can name it, but it only raises your water goal if it syncs from Garmin.</Note> : null}
      <View>
        <Text style={[styles.fieldLabel, { color: theme.muted }]}>Name</Text>
        <TextInput style={input} value={name} onChangeText={setName} maxLength={60} accessibilityLabel="Session name" placeholder={SPORT_LABEL[sport]} placeholderTextColor={theme.muted} />
      </View>
      {error ? <Text style={{ color: theme.badInk, fontSize: 13 }} accessibilityRole="alert">{error}</Text> : null}
      {added ? <Done>{added}</Done> : null}
      <Btn label="Add to the week" onPress={() => void add()} />
      <Note>Building workouts and sending them to your watch comes in the next version.</Note>
    </Card>
  );
}

type AppProps = { me: Me; sync: SyncStatus; onChanged: () => void };

function AppCard({ me, sync, onChanged }: AppProps) {
  const [message, setMessage] = useState<string | null>(null);
  const run = async (work: () => Promise<string>) => {
    try {
      setMessage(await work());
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'That didn’t work.');
    }
  };
  const turnOn = () => run(async () => {
    const result = await enablePush();
    return result.ok ? 'This iPhone will get nudges and reminders.' : result.message;
  });
  const testNow = () => run(async () => ((await api.testPush()).sent ? 'Test sent.' : 'Nothing was sent. Turn notifications on first.'));
  const testWatch = () => {
    // Said first: the server holds this request for the 10 seconds, and you should be locking the phone.
    setMessage('Lock your phone now. The test arrives in 10 seconds, and your watch should buzz.');
    void api.testPush(10).catch(() => undefined);
  };
  const signOut = async () => {
    try {
      await api.logout();
      await useAuthStore.getState().signedOut();
    } catch {
      // Clearing only this phone would look like every device had been signed out, when none had.
      setMessage("Couldn't reach the server, so nothing was signed out. Try again when you're online.");
    }
  };
  const devices = `${me.devices} device${me.devices === 1 ? '' : 's'} registered.`;
  return (
    <Card title="Zona" sub={me.fake ? 'sample data' : 'your Garmin'}>
      <SetRow label="Garmin sync">{SYNC_LABEL[sync.status]}</SetRow>
      <BtnRow>
        <Btn label={me.devices ? 'Re-register' : 'Turn on notifications'} kind="ghost" onPress={() => void turnOn()} />
        <Btn label="Send a test" kind="ghost" disabled={!me.devices} onPress={() => void testNow()} />
      </BtnRow>
      <Btn label="Test the watch: send in 10 s, then lock" kind="ghost" disabled={!me.devices} onPress={testWatch} />
      <Note>{devices}</Note>
      {message ? <Lead>{message}</Lead> : null}
      <Btn label="Check for an app update" kind="quiet" onPress={() => void run(installLatestUpdate)} />
      <Note>{appVersionLabel()}</Note>
      <Btn label="Garmin data shapes (field names, no values)" kind="quiet" onPress={() => router.push('/garmin-shapes')} />
      <Btn label="Sign out on every device" kind="quiet" onPress={() => void signOut()} />
    </Card>
  );
}

type Props = { plan: PlanItem[]; me: Me; sync: SyncStatus; onChanged: () => void };
export function TrainView({ plan, me, sync, onChanged }: Props) {
  return (
    <>
      <WeekPlan plan={plan} onChanged={onChanged} />
      <AddSession onChanged={onChanged} />
      <AppCard me={me} sync={sync} onChanged={onChanged} />
    </>
  );
}

const inputStyle = (t: Theme) => [styles.input, { borderColor: t.line, backgroundColor: t.bg, color: t.ink }];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  day: { gap: 2 },
  dayHead: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4 },
  itemName: { fontSize: 14.5, fontWeight: '600' },
  itemSub: { fontSize: 12 },
  fields: { flexDirection: 'row', gap: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 16 },
});
