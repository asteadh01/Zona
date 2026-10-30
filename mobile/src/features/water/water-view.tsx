import { StyleSheet, Text, View } from 'react-native';

import { Lines } from '@/components/charts';
import { Btn, BtnRow, Card, Lead, Meter, Note, Seg, SetRow, Stepper, ToggleRow, useStyles } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { NudgeCard } from '@/features/water/nudge-card';
import { api } from '@/services/api';
import type { Nudge, Settings, Water } from '@/types/api';
import { hhmm, litres, nf, ticksFor } from '@/utils/format';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Props = {
  water: Water;
  settings: Settings;
  nowH: number;
  nudge: Nudge | null; // opened from a notification, otherwise the latest one
  fake: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
};

export function WaterView({ water, settings, nowH, nudge, fake, onChanged, onError }: Props) {
  const s = useStyles();
  const theme = useTheme();
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save that.");
    }
  };
  const save = (patch: Partial<Settings>) => void act(() => api.saveSettings(patch));
  const left = Math.max(0, water.goal - water.intake);
  const logsAscending = [...water.logs].sort((a, b) => a.h - b.h);
  const logsNewest = [...water.logs].reverse();

  return (
    <>
      <NudgeCard nudge={nudge} logs={water.logs} onLogged={onChanged} />
      <Card title="Today" sub={left ? `${litres(left)} to go` : 'goal reached'}>
        <View style={local.big}>
          <Text style={[local.bigNumber, { color: theme.ink }]}>{(water.intake / 1000).toFixed(2)}</Text>
          <Text style={[local.bigUnit, { color: theme.ink2 }]}>{`of ${litres(water.goal)}`}</Text>
        </View>
        <Meter value={water.intake / water.goal} />
        <BtnRow>
          <Btn label="+250 ml" kind="ghost" onPress={() => void act(() => api.logWater(250))} />
          <Btn label="+500 ml" kind="ghost" onPress={() => void act(() => api.logWater(500))} />
        </BtnRow>
        {logsNewest.map((log) => (
          <View key={log.id} style={local.line}>
            <Text style={[local.lineText, { color: theme.ink2 }]}>{`${hhmm(log.h)} · ${nf(log.ml)} ml${log.source === 'nudge' ? ' · from a nudge' : ''}`}</Text>
            <Btn label="Remove" kind="quiet" onPress={() => void act(() => api.deleteWater(log.id))} />
          </View>
        ))}
      </Card>

      <Card title="Daily goal" sub="your rule">
        <Stepper label="Base per day" display={litres(settings.base)} onLess={() => save({ base: clamp(settings.base - 250, 1500, 5000) })} onMore={() => save({ base: clamp(settings.base + 250, 1500, 5000) })} />
        <Stepper label="Per hour of sport" display={`${settings.per_hour} ml`} onLess={() => save({ per_hour: clamp(settings.per_hour - 50, 0, 1000) })} onMore={() => save({ per_hour: clamp(settings.per_hour + 50, 0, 1000) })} />
        <ToggleRow label="Count planned sessions early" value={settings.count_planned} onChange={(count_planned) => save({ count_planned })} />
        {water.sessions.map((session) => (
          <View key={session.name + session.start_h} style={local.line}>
            <Text style={[local.lineText, { color: theme.ink2 }]}>{`${session.name} · ${hhmm(session.start_h)}`}</Text>
            <Text style={[local.lineText, { color: theme.ink2 }]}>{`+${nf(session.ml)} ml · ${session.done ? `synced ${hhmm(session.synced_h ?? 0)}` : 'planned'}`}</Text>
          </View>
        ))}
        {water.sessions.length === 0 ? <Note>No sport synced yet today, so the goal is your base.</Note> : null}
        <Text style={[local.formula, { color: theme.ink2, backgroundColor: theme.bg }]}>
          {`${litres(settings.base)}${water.sessions.map((x) => ` + ${nf(x.ml)} ml`).join('')} = `}
          <Text style={{ color: theme.ink, fontWeight: '700' }}>{litres(water.goal)}</Text>
        </Text>
        <Note>{settings.count_planned
          ? 'Planned sessions count from the morning, and each one switches to its real length once it syncs.'
          : 'Starts at your base. Each session adds its hours × your amount per hour, rounded to 50 ml, once it syncs from Garmin.'}</Note>
      </Card>

      <Card title="After a workout" sub={settings.nudge ? 'nudge on' : 'nudge off'}>
        <ToggleRow label="Nudge me to drink" value={settings.nudge} onChange={(nudgeOn) => save({ nudge: nudgeOn })} />
        <Lead>Check Garmin</Lead>
        <Seg label="How often Zona checks Garmin" value={settings.poll} onChange={(poll) => save({ poll })}
          options={[{ value: 5, label: 'After plans · 5 min' }, { value: 15, label: 'All day · 15 min' }]} />
        <SetRow label="Skip sessions under">20 min</SetRow>
        <Note>{`Garmin doesn't tell Zona when a workout arrives, so the server checks. ${settings.poll === 5 ? 'Every 5 minutes for 3 hours after a planned session starts, every 30 minutes otherwise.' : 'Every 15 minutes, all day.'}`}</Note>
        {fake ? <Btn label="Sample data: finish a 47-min run now" kind="quiet" onPress={() => void act(() => api.finishFakeWorkout())} /> : null}
      </Card>

      <IntakeCard water={water} logs={logsAscending} nowH={nowH} />

      <Card title="Reminders" sub={settings.remind_every ? `every ${settings.remind_every} min` : 'off'}>
        <Seg label="How often to remind you" value={settings.remind_every} onChange={(remind_every) => save({ remind_every })}
          options={[{ value: 0, label: 'Off' }, { value: 45, label: '45 min' }, { value: 60, label: '1 h' }, { value: 90, label: '1.5 h' }]} />
        <SetRow label="Active hours">{`${String(settings.active_from).padStart(2, '0')}:00 – ${String(settings.active_to).padStart(2, '0')}:00`}</SetRow>
        <ToggleRow label="Pause during planned sessions" value={settings.pause_in_workouts} onChange={(pause_in_workouts) => save({ pause_in_workouts })} />
        <ToggleRow label="Morning call notification" value={settings.call_push} onChange={(call_push) => save({ call_push })} />
        <Text style={s.note}>Reminders stop once you reach the goal. Your watch shows them from the iPhone, where you can read and dismiss them.</Text>
      </Card>
    </>
  );
}

function IntakeCard({ water, logs, nowH }: { water: Water; logs: Water['logs']; nowH: number }) {
  const theme = useTheme();
  const points: [number, number][] = [[7, 0]];
  let total = 0;
  logs.forEach((log) => {
    points.push([log.h, total]);
    total += log.ml;
    points.push([log.h, total]);
  });
  points.push([Math.max(7, nowH), total]);
  const goalAt = (h: number) => water.goal_steps.reduce((goal, [at, value]) => (at <= h ? value : goal), water.goal_steps[0][1]);
  const drunkBy = (h: number) => logs.filter((log) => log.h <= h).reduce((a, log) => a + log.ml, 0);
  const yTicks = ticksFor(Math.max(water.goal, total) * 1.04, 3);
  const hits = Array.from({ length: 15 }, (_, i) => i + 7).map((h) => ({
    from: h, to: h + 1,
    tip: h + 1 > nowH + 1 ? `${hhmm(h)}: still ahead` : `${hhmm(h + 1)}: ${litres(drunkBy(h + 1))} drunk, goal ${litres(goalAt(h + 1))}`,
  }));
  return (
    <Card title="Intake through the day">
      <Lines x0={7} x1={22} y0={0} y1={yTicks[yTicks.length - 1]} yTicks={yTicks} yFmt={(v) => `${v / 1000} L`} height={124} now={nowH >= 7 && nowH <= 22 ? nowH : null}
        xLabels={[{ at: 7, label: '07' }, { at: 12, label: '12' }, { at: 17, label: '17' }, { at: 22, label: '22' }]}
        series={[{ points: water.goal_steps, color: theme.ink2, dashed: true }, { points, color: theme.accent, endDot: true }]} hits={hits}
        aria="Water intake against a goal that rises as workouts sync" />
      <Note>Solid line: you. Dashed line: your goal, which steps up as workouts sync.</Note>
    </Card>
  );
}

const local = StyleSheet.create({
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bigNumber: { fontSize: 38, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  bigUnit: { fontSize: 14, fontWeight: '500' },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  lineText: { flexShrink: 1, fontSize: 13 },
  formula: { fontSize: 12.5, padding: 9, borderRadius: 9, overflow: 'hidden', fontVariant: ['tabular-nums'] },
});
