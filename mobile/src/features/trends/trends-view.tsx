import { StyleSheet, Text, View } from 'react-native';

import { Bars, HBars, Heat, Lines, type Bar } from '@/components/charts';
import { Card, Lead, Note } from '@/components/ui';
import { SPORT_LABEL, SPORT_ORDER, ZONE_NAMES, sportColor, useTheme, zoneColors } from '@/constants/theme';
import type { Trends } from '@/types/api';
import { WEEK_ROWS, dur, fmtDay, hhmm, nf, shortDate } from '@/utils/format';

function Legend({ items }: { items: { color: string; label: string }[] }) {
  const theme = useTheme();
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: item.color }]} />
          <Text style={[styles.legendText, { color: theme.ink2 }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function TrendsView({ trends }: { trends: Trends }) {
  const theme = useTheme();
  const n = trends.weeks.length;
  const used = SPORT_ORDER.filter((s) => trends.weeks.some((w) => w.minutes[s]));
  if (!used.length) {
    return (
      <Card title="Charts fill in after the first sync">
        <Note>Zona backfills 180 days of activities and 12 weeks of daily data the first time it reaches Garmin.</Note>
      </Card>
    );
  }
  const weekBars: Bar[] = trends.weeks.map((w, i) => ({
    label: n === 4 || i % 3 === 0 ? shortDate(w.start) : '',
    highlight: i === n - 1,
    segs: used.map((s) => w.minutes[s] / 60),
    tip: `Week of ${shortDate(w.start)}${i === n - 1 ? ' (so far)' : ''}: ${used.filter((s) => w.minutes[s]).map((s) => `${SPORT_LABEL[s]} ${dur(w.minutes[s])}`).join(', ') || 'nothing logged'}`,
  }));
  const totalHours = (s: (typeof used)[number]) => trends.weeks.reduce((a, w) => a + w.minutes[s], 0) / 60;

  let best: [number, number] = [0, 0];
  trends.heat.forEach((row, r) => row.forEach((v, c) => {
    if (v > trends.heat[best[0]][best[1]]) best = [r, c];
  }));

  const calorieBars: Bar[] = trends.kcal.map((d, i) => ({
    label: i % 7 === 0 ? shortDate(d.date) : '',
    segs: [d.resting ?? 0, d.active ?? 0],
    tip: d.active != null ? `${fmtDay(d.date)}${i === trends.kcal.length - 1 ? ' so far' : ''}: ${nf((d.resting ?? 0) + d.active)} kcal (${nf(d.active)} active)` : `${fmtDay(d.date)}: not synced`,
  }));
  const complete = trends.kcal.slice(0, -1).filter((d) => d.active != null);
  const averageActive = complete.reduce((a, d) => a + (d.active ?? 0), 0) / Math.max(1, complete.length);

  const zoneTotal = Math.max(1, trends.zones.reduce((a, z) => a + z, 0));
  const zones = zoneColors(theme);
  const sleep = trends.sleep;
  return (
    <>
      <Card title="Training time per week" sub="hours">
        <Bars bars={weekBars} colors={used.map((s) => sportColor(theme, s))} fmt={(v) => `${v}h`} height={150} aria="Training hours per week by sport" />
        <Legend items={used.map((s) => ({ color: sportColor(theme, s), label: `${SPORT_LABEL[s]} ${totalHours(s).toFixed(1)}h` }))} />
      </Card>
      <Card title="When you train" sub="session starts">
        <Lead>{`Busiest slot: ${WEEK_ROWS[best[0]]} around ${hhmm(best[1] + trends.first_hour)}.`}</Lead>
        <Heat rows={WEEK_ROWS} firstHour={trends.first_hour} values={trends.heat} aria="Session starts by weekday and hour" />
      </Card>
      <Card title="Calories per day" sub="last 4 weeks">
        <Bars bars={calorieBars} colors={[theme.calRest, theme.calAct]} height={136} aria="Calories per day, resting and active" />
        <Legend items={[{ color: theme.calRest, label: 'Resting' }, { color: theme.calAct, label: `Active, ${nf(averageActive)} a day on average` }]} />
      </Card>
      {zoneTotal > 1 ? (
        <Card title="Time in heart-rate zones" sub={`last ${n} weeks`}>
          <HBars max={Math.max(...trends.zones)} aria="Time in heart-rate zones" rows={trends.zones.map((z, i) => ({
            label: `Z${i + 1} ${ZONE_NAMES[i]}`, value: z, color: zones[i], valueLabel: dur(z), tip: `Z${i + 1} ${ZONE_NAMES[i]}: ${dur(z)} (${Math.round((z / zoneTotal) * 100)}%)`,
          }))} />
        </Card>
      ) : null}
      {sleep.length > 1 ? (
        <Card title="Sleep score" sub="last 4 weeks">
          <Lines x0={0} x1={sleep.length - 1} y0={40} y1={100} yTicks={[40, 70, 100]} height={100}
            xLabels={[{ at: 0, label: shortDate(sleep[0].date) }, { at: sleep.length - 1, label: shortDate(sleep[sleep.length - 1].date) }]}
            series={[{ points: sleep.map((d, i) => [i, d.score]), color: theme.accent, endDot: true, endLabel: String(sleep[sleep.length - 1].score) }]}
            hits={sleep.map((d, i) => ({ from: Math.max(0, i - 0.5), to: Math.min(sleep.length - 1, i + 0.5), tip: `${fmtDay(d.date)}: score ${d.score}${d.minutes ? `, ${dur(d.minutes)}` : ''}` }))}
            aria="Sleep score, last 28 days" />
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 12 },
});
