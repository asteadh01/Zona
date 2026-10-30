import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Header, LoadState, Screen, Seg } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { InsightsView } from '@/features/home/insights';
import { MonthCalendar } from '@/features/home/month';
import { SyncBanner, SyncChip } from '@/features/home/sync-chip';
import { CallStrip, TodayView } from '@/features/home/today';
import { useLoad } from '@/hooks/use-load';
import { api } from '@/services/api';
import { fmtDay, monthName, shiftMonth } from '@/utils/format';

type View_ = 'today' | 'month' | 'insights';
const OPTIONS = [{ value: 'today', label: 'Today' }, { value: 'month', label: 'Month' }, { value: 'insights', label: 'Insights' }] as const;

export default function HomeScreen() {
  const [view, setView] = useState<View_>('today');
  const home = useLoad(api.home);
  if (!home.data) {
    return <Screen><LoadState error={home.error} onRetry={() => void home.reload()} /></Screen>;
  }
  const { data } = home;
  const switcher = <Seg label="Home view" options={OPTIONS} value={view} onChange={setView} />;
  const chip = <SyncChip sync={data.sync} now={data.now} onSynced={() => void home.reload()} />;

  if (view === 'month') return <MonthTab today={data.date} switcher={switcher} call={<CallStrip call={data.call} />} sync={<SyncBanner sync={data.sync} />} />;
  if (view === 'insights') return <InsightsTab chip={chip} switcher={switcher} sync={<SyncBanner sync={data.sync} />} />;
  return (
    <Screen refreshing={home.refreshing} onRefresh={() => void home.refresh()}>
      <Header title="Today" small={fmtDay(data.date)} right={chip} />
      {switcher}
      <SyncBanner sync={data.sync} />
      <TodayView home={data} onChanged={() => void home.reload()} />
    </Screen>
  );
}

type Slots = { switcher: React.ReactNode; sync: React.ReactNode };

function MonthTab({ today, switcher, call, sync }: Slots & { today: string; call: React.ReactNode }) {
  const theme = useTheme();
  const [ym, setYm] = useState(today.slice(0, 7));
  const month = useLoad(() => api.month(ym), ym);
  const { month: name, year } = monthName(ym);
  const nav = (
    <View style={styles.nav}>
      {([[-1, '‹', 'Previous month'], [1, '›', 'Next month']] as const).map(([delta, glyph, label]) => (
        <Pressable key={delta} style={[styles.navBtn, { backgroundColor: theme.surface2 }]} onPress={() => setYm(shiftMonth(ym, delta))} accessibilityRole="button" accessibilityLabel={label}>
          <Text style={[styles.navText, { color: theme.ink }]}>{glyph}</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <Screen refreshing={month.refreshing} onRefresh={() => void month.refresh()}>
      <Header title={name} small={`${year} · training log`} right={nav} />
      {switcher}
      {sync}
      {call}
      {month.data && month.data.month === ym
        ? <MonthCalendar key={ym} month={month.data} />
        : <LoadState error={month.error} onRetry={() => void month.reload()} />}
    </Screen>
  );
}

function InsightsTab({ chip, switcher, sync }: Slots & { chip: React.ReactNode }) {
  const insights = useLoad(api.insights);
  return (
    <Screen refreshing={insights.refreshing} onRefresh={() => void insights.refresh()}>
      <Header title="Insights" small="From your last 12 weeks" right={chip} />
      {switcher}
      {sync}
      {insights.data ? <InsightsView insights={insights.data} /> : <LoadState error={insights.error} onRetry={() => void insights.reload()} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  navBtn: { width: 44, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 19 },
});
