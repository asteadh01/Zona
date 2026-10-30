import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Note, SportChip, useStyles } from '@/components/ui';
import { type Theme, sportColor, useTheme } from '@/constants/theme';
import { distance } from '@/features/home/today';
import type { Month, MonthDay } from '@/types/api';
import { WEEK_ROWS, dur, fmtDay, fromKey, hhmm, nf } from '@/utils/format';

function DayCard({ day, isToday }: { day: MonthDay; isToday: boolean }) {
  const s = useStyles();
  const theme = useTheme();
  const count = day.acts.length;
  const totals = [
    day.total_kcal != null ? `${nf(day.total_kcal)} kcal total` : null,
    day.steps != null ? `${nf(day.steps)} steps` : null,
    day.sleep_score != null ? `Sleep ${day.sleep_score}` : null,
  ].filter(Boolean);
  return (
    <Card title={fmtDay(day.date)} sub={count ? `${count} session${count > 1 ? 's' : ''}` : undefined}>
      {day.future ? <Note>Nothing logged yet.</Note> : null}
      {!day.future && !day.synced && !count ? <Note>No data for this day.</Note> : null}
      {!day.future && day.synced && !count ? <Note>{isToday ? 'Nothing logged yet today.' : 'Rest day.'}</Note> : null}
      {day.acts.map((a) => (
        <View key={a.name + a.start_h} style={rowStyle.row}>
          <SportChip sport={a.sport} />
          <View style={s.flex}>
            <Text style={[rowStyle.title, { color: theme.ink }]}>{a.name}</Text>
            <Text style={[rowStyle.sub, { color: theme.muted }]}>{`${hhmm(a.start_h)} · ${dur(a.minutes)}${distance(a)}`}</Text>
          </View>
          <Text style={[rowStyle.end, { color: theme.ink2 }]}>{`${nf(a.kcal)} kcal`}</Text>
        </View>
      ))}
      {totals.length ? <Note>{totals.join('  ·  ')}</Note> : null}
    </Card>
  );
}

export function MonthCalendar({ month }: { month: Month }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string>(month.today);
  const local = localFor(theme);
  const ramp = [theme.surface2, theme.q1, theme.q2, theme.q3, theme.q4, theme.q5];
  const allDays = month.weeks.flatMap((w) => w.days);
  const picked = allDays.find((d) => d.date === selected) ?? allDays.find((d) => d.in_month);
  return (
    <>
      <Card>
        <View style={local.week}>
          {WEEK_ROWS.map((r) => <Text key={r} style={local.head}>{r[0]}</Text>)}
          <Text style={local.total}>Wk</Text>
        </View>
        {month.weeks.map((w) => (
          <View key={w.start} style={local.week}>
            {w.days.map((d) => {
              const bin = !d.minutes ? 0 : d.minutes < 30 ? 1 : d.minutes < 60 ? 2 : d.minutes < 90 ? 3 : d.minutes < 120 ? 4 : 5;
              const isToday = d.date === month.today;
              const isSelected = d.date === picked?.date;
              const label = `${fmtDay(d.date)}: ${d.future ? 'still ahead' : d.acts.length ? `${d.acts.map((a) => a.name).join(', ')}, ${dur(d.minutes)}` : isToday ? 'nothing logged yet' : d.synced ? 'rest' : 'not synced'}`;
              return (
                <Pressable key={d.date} onPress={() => setSelected(d.date)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: isSelected }}
                  style={[local.day, { backgroundColor: d.future ? 'transparent' : ramp[bin] }, d.future && local.dayFuture, !d.in_month && local.dayOut, isSelected && local.daySelected]}>
                  <Text style={[local.dayText, bin >= 4 && !d.future && local.dayTextOnDark, isToday && local.dayToday, d.future && local.dayTextFuture]}>{fromKey(d.date).getDate()}</Text>
                  <View style={local.dots}>
                    {d.acts.slice(0, 3).map((a, i) => <View key={i} style={[local.dot, { backgroundColor: sportColor(theme, a.sport) }]} />)}
                  </View>
                </Pressable>
              );
            })}
            <Text style={local.total} accessibilityLabel={`Week of ${fmtDay(w.start)}: ${dur(w.minutes)}`}>{w.minutes ? `${(w.minutes / 60).toFixed(1)}h` : '–'}</Text>
          </View>
        ))}
        <View style={local.ramp}>
          <Text style={local.rampText}>Less</Text>
          {ramp.slice(1).map((color) => <Fragment key={color}><View style={[local.rampCell, { backgroundColor: color }]} /></Fragment>)}
          <Text style={local.rampText}>2h+ a day</Text>
        </View>
      </Card>
      {picked ? <DayCard day={picked} isToday={picked.date === month.today} /> : null}
    </>
  );
}

const rowStyle = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 6 },
  title: { fontSize: 14.5, fontWeight: '600' },
  sub: { fontSize: 12 },
  end: { fontSize: 13, fontWeight: '600' },
});

const cache = new WeakMap<Theme, ReturnType<typeof makeLocal>>();
function localFor(t: Theme) {
  let local = cache.get(t);
  if (!local) {
    local = makeLocal(t);
    cache.set(t, local);
  }
  return local;
}

function makeLocal(t: Theme) {
  return StyleSheet.create({
    week: { flexDirection: 'row', gap: 4, alignItems: 'center' },
    head: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: t.muted },
    total: { width: 34, textAlign: 'center', fontSize: 11, fontWeight: '700', color: t.ink2, fontVariant: ['tabular-nums'] },
    day: { flex: 1, aspectRatio: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center', gap: 2 },
    dayFuture: { borderWidth: StyleSheet.hairlineWidth, borderColor: t.line },
    dayOut: { opacity: 0.35 },
    daySelected: { borderWidth: 2, borderColor: t.ink },
    dayText: { fontSize: 13, fontWeight: '600', color: t.ink },
    dayTextOnDark: { color: t.onQ },
    dayTextFuture: { color: t.muted },
    dayToday: { textDecorationLine: 'underline' },
    dots: { flexDirection: 'row', gap: 2, height: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    ramp: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    rampCell: { width: 16, height: 9, borderRadius: 2 },
    rampText: { fontSize: 11, color: t.muted },
  });
}
