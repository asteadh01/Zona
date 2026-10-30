import { Bars, HBars, Lines, type Bar } from '@/components/charts';
import { Card, Lead, Note } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import type { Insights } from '@/types/api';
import { fmtDay, hhmm, nf, shortDate, ticksFor } from '@/utils/format';

export function InsightsView({ insights }: { insights: Insights }) {
  const theme = useTheme();
  if (!insights.enough) {
    return (
      <Card title="Insights need a couple of weeks of data">
        <Note>Once Zona has ten sessions it looks for patterns: when you train, how calories trend, how late sessions affect your sleep, and where your HRV sits.</Note>
      </Card>
    );
  }
  const { start_hours: sh, weekly_kcal: wk, late_sleep: ls, hrv } = insights;
  const peak = sh.peak_hour - sh.first_hour;
  const hourBars: Bar[] = sh.hours.map((v, i) => {
    const hour = i + sh.first_hour;
    return {
      label: hour % 3 === 0 ? String(hour).padStart(2, '0') : '',
      segs: [v],
      colors: [i === peak ? theme.accent : theme.qMute],
      tip: `${hhmm(hour)} to ${hhmm(hour + 1)}: ${v} session${v === 1 ? '' : 's'}`,
    };
  });
  const weeks = wk.weeks;
  const last = weeks[weeks.length - 1];
  const kcalTicks = ticksFor(Math.max(...weeks.map((w) => w.kcal), 1) * 1.08, 3);
  const lateDiff = ls.late_avg != null && ls.other_avg != null ? ls.other_avg - ls.late_avg : null;
  return (
    <>
      <Card title={`Most sessions start around ${hhmm(sh.peak_hour)}`}>
        <Lead>{`${sh.share}% of your ${sh.sessions} sessions started between ${hhmm(sh.peak_hour)} and ${hhmm(sh.peak_hour + 1)}.`}</Lead>
        <Bars bars={hourBars} height={100} left={22} aria="Sessions by start hour" />
      </Card>
      <Card title={`Active calories ${wk.pct >= 0 ? 'up' : 'down'} ${Math.abs(wk.pct)}%`} sub="weekly">
        <Lead>{`Week of ${shortDate(last.start)}: ${nf(last.kcal)} kcal, against a ${nf(wk.avg_before)} average over the four weeks before.`}</Lead>
        <Lines x0={0} x1={weeks.length - 1} y0={0} y1={kcalTicks[kcalTicks.length - 1]} yTicks={kcalTicks} yFmt={(v) => (v ? `${v / 1000}k` : '0')} height={104}
          xLabels={[{ at: 0, label: shortDate(weeks[0].start) }, { at: weeks.length - 1, label: shortDate(last.start) }]}
          series={[{ points: weeks.map((w, i) => [i, w.kcal]), color: theme.accent, endDot: true }]}
          hits={weeks.map((w, i) => ({ from: Math.max(0, i - 0.5), to: Math.min(weeks.length - 1, i + 0.5), tip: `Week of ${shortDate(w.start)}: ${nf(w.kcal)} active kcal` }))}
          aria="Weekly active calories" />
      </Card>
      {lateDiff != null ? (
        <Card title={lateDiff > 1 ? `Late sessions cost you ${lateDiff} sleep points` : "Late sessions don't hurt your sleep"}>
          <Lead>Nights after a session that started at 19:00 or later, against all other nights.</Lead>
          <HBars max={100} aria="Sleep score after late sessions" rows={[
            { label: 'After 19:00', value: ls.late_avg ?? 0, color: theme.accent, valueLabel: String(ls.late_avg), tip: `${ls.late_nights} nights after a late session: average ${ls.late_avg}` },
            { label: 'Other nights', value: ls.other_avg ?? 0, color: theme.qMute, valueLabel: String(ls.other_avg), tip: `${ls.other_nights} other nights: average ${ls.other_avg}` },
          ]} />
        </Card>
      ) : null}
      {hrv && hrv.points.length > 1 ? <HrvCard hrv={hrv} /> : null}
    </>
  );
}

type Hrv = NonNullable<Extract<Insights, { enough: true }>['hrv']>;
function HrvCard({ hrv }: { hrv: Hrv }) {
  const theme = useTheme();
  const values = hrv.points.map((p) => p.ms);
  const y0 = Math.floor(Math.min(...values, hrv.low) / 10) * 10;
  const y1 = Math.ceil(Math.max(...values, hrv.high) / 10) * 10;
  const yTicks: number[] = [];
  for (let v = y0; v <= y1; v += 10) yTicks.push(v);
  const n = hrv.points.length - 1;
  return (
    <Card title={`HRV is ${hrv.status}`} sub="overnight, ms">
      <Lead>{`7-day average ${Math.round(hrv.week)} ms. The band is your usual range.`}</Lead>
      <Lines x0={0} x1={n} y0={y0} y1={y1} yTicks={yTicks} height={108} band={[hrv.low, hrv.high]}
        xLabels={[{ at: 0, label: shortDate(hrv.points[0].date) }, { at: n, label: shortDate(hrv.points[n].date) }]}
        series={[{ points: hrv.points.map((p, i) => [i, p.ms]), color: theme.accent, endDot: true }]}
        hits={hrv.points.map((p, i) => ({ from: Math.max(0, i - 0.5), to: Math.min(n, i + 0.5), tip: `${fmtDay(p.date)}: ${Math.round(p.ms)} ms` }))}
        aria="Overnight HRV, last 28 days" />
    </Card>
  );
}
