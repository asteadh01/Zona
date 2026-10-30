import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BatteryGauge, Bars, type Bar } from '@/components/charts';
import { Card, Lead, Meter, Note, Pill, SportChip, useStyles } from '@/components/ui';
import { type Theme, ZONE_NAMES, useTheme, zoneColors } from '@/constants/theme';
import { NudgeCard } from '@/features/water/nudge-card';
import type { Activity, Call, Day, Home, MaybeSession, PlannedSession } from '@/types/api';
import { DOW, dur, fmtDay, fromKey, hhmm, litres, nf, pace } from '@/utils/format';

export function CallCard({ call, next, maybe }: { call: Call | null; next: PlannedSession | null; maybe?: MaybeSession }) {
  const s = useStyles();
  const local = useLocal();
  if (!call) {
    return (
      <Card title="Today's call" sub="waiting for last night">
        <Note>Zona makes the call once this morning's Body Battery syncs from Garmin.</Note>
      </Card>
    );
  }
  const ahead = next ? `${next.name} at ${hhmm(next.start_h)}` : maybe ? `maybe ${maybe.name}` : 'nothing else planned';
  return (
    <Card title="Today's call" sub={ahead}>
      <Pill tone={call.tone} label={call.label} />
      <Text style={local.callText}>{call.text}</Text>
      <Lead>{call.sub}</Lead>
      <BatteryGauge value={call.bb} />
      <View style={s.flex}>
        {call.why.map((reason) => <Text key={reason} style={local.why}>{`•  ${reason}`}</Text>)}
      </View>
    </Card>
  );
}

export function CallStrip({ call }: { call: Call | null }) {
  const local = useLocal();
  if (!call) return null;
  return (
    <Card>
      <View style={local.strip}>
        <Pill tone={call.tone} label={call.label} />
        <Text style={local.stripText}>{call.text}</Text>
      </View>
    </Card>
  );
}

type TileProps = { label: string; value: string; note: string; meter?: number; split?: number };
function Tile({ label, value, note, meter, split }: TileProps) {
  const local = useLocal();
  const theme = useTheme();
  return (
    <View style={local.tile} accessible accessibilityLabel={`${label}: ${value}, ${note}`}>
      <Text style={local.tileLabel}>{label}</Text>
      <Text style={local.tileValue}>{value}</Text>
      <Text style={local.tileNote}>{note}</Text>
      {split != null ? (
        <View style={local.split}>
          <View style={{ width: `${split * 100}%`, backgroundColor: theme.calAct, borderRadius: 2 }} />
          <View style={{ flex: 1, backgroundColor: theme.calRest, borderRadius: 2 }} />
        </View>
      ) : <Meter value={meter ?? 0} />}
    </View>
  );
}

function Tiles({ day, home }: { day: Day | null; home: Home }) {
  const local = useLocal();
  const { water } = home;
  const total = day?.total_kcal ?? null;
  const active = day?.active_kcal ?? null;
  return (
    <View style={local.tiles}>
      <Tile label="Calories" value={total != null ? nf(total) : '—'} note={active != null ? `${nf(active)} active so far` : 'no data'}
        split={total && active != null ? active / total : undefined} />
      <Tile label="Steps" value={day?.steps != null ? nf(day.steps) : '—'} note="of 10,000" meter={(day?.steps ?? 0) / 10000} />
      <Tile label="Intensity min" value={nf(home.intensity_week)} note="of 150 this week" meter={home.intensity_week / 150} />
      <Tile label="Body Battery" value={day?.bb_now != null ? String(day.bb_now) : '—'} note={day?.bb_wake != null ? `woke up at ${day.bb_wake}` : 'no data'} meter={(day?.bb_now ?? 0) / 100} />
      <Tile label="Sleep score" value={day?.sleep_score != null ? String(day.sleep_score) : '—'} note={day?.sleep_min != null ? `${dur(day.sleep_min)} asleep` : 'no data'} meter={(day?.sleep_score ?? 0) / 100} />
      <Tile label="Water" value={(water.intake / 1000).toFixed(2)} note={`of ${litres(water.goal)} goal`} meter={water.intake / water.goal} />
    </View>
  );
}

function activityStats(a: Activity): [string, string][] {
  const hr = a.avg_hr != null ? String(a.avg_hr) : '—';
  if (a.sport === 'run' && a.km) return [[a.km.toFixed(1), 'km'], [dur(a.minutes), 'time'], [pace(a.minutes, a.km), '/km'], [hr, 'avg bpm']];
  if (a.sport === 'bike' && a.km) return [[a.km.toFixed(1), 'km'], [dur(a.minutes), 'time'], [((a.km / a.minutes) * 60).toFixed(1), 'km/h'], [hr, 'avg bpm']];
  if (a.sport === 'swim' && a.km) return [[nf(a.km * 1000), 'm'], [dur(a.minutes), 'time'], [pace(a.minutes / 10, a.km), '/100 m'], [hr, 'avg bpm']];
  return [[dur(a.minutes), 'time'], [nf(a.kcal), 'kcal'], [hr, 'avg bpm'], [String(Math.round(a.zones[3] + a.zones[4])), 'hard min']];
}

export const distance = (a: { sport: string; km: number | null }): string =>
  a.km ? ` · ${a.sport === 'swim' ? `${nf(a.km * 1000)} m` : `${a.km.toFixed(1)} km`}` : '';

function ZoneBar({ zones }: { zones: number[] }) {
  const local = useLocal();
  const theme = useTheme();
  const colors = zoneColors(theme);
  const total = zones.reduce((a, z) => a + z, 0);
  if (total < 1) return null;
  const label = zones.map((z, i) => `Z${i + 1} ${ZONE_NAMES[i]} ${dur(z)}`).join(', ');
  return (
    <View accessible accessibilityLabel={`Time in heart-rate zones: ${label}`}>
      <View style={local.zones}>
        {zones.map((z, i) => (z > 0.5 ? <View key={i} style={{ flex: z, backgroundColor: colors[i], borderRadius: 2 }} /> : null))}
      </View>
      <View style={local.zoneLabels}>
        <Text style={local.tinyMuted}>Z1</Text>
        <Text style={local.tinyMuted}>time in heart-rate zones</Text>
        <Text style={local.tinyMuted}>Z5</Text>
      </View>
    </View>
  );
}

function Sessions({ home }: { home: Home }) {
  const local = useLocal();
  const { today, yesterday, later, maybe } = home.sessions;
  const newest = today[0] ?? yesterday[0];
  const [picked, setPicked] = useState<string | null | undefined>(undefined); // undefined: the newest stays open
  const open = picked === undefined ? newest?.id : picked;
  const row = (a: Activity) => {
    const isOpen = a.id === open;
    return (
      <View key={a.id}>
        <Pressable style={local.row} onPress={() => setPicked(isOpen ? null : a.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}>
          <SportChip sport={a.sport} />
          <View style={local.rowMiddle}>
            <Text style={local.rowTitle}>{a.name}</Text>
            <Text style={local.rowSub}>{`${hhmm(a.start_h)} · ${dur(a.minutes)}${distance(a)}`}</Text>
          </View>
          <Text style={local.rowEnd}>{`${nf(a.kcal)} kcal`}</Text>
        </Pressable>
        {isOpen ? (
          <View style={local.details}>
            <View style={local.stats}>
              {activityStats(a).map(([value, unit]) => (
                <View key={unit} style={local.stat}>
                  <Text style={local.statValue}>{value}</Text>
                  <Text style={local.tinyMuted}>{unit}</Text>
                </View>
              ))}
            </View>
            <ZoneBar zones={a.zones} />
            {a.water_ml != null ? (
              <Text style={local.waterTag}>{`+${nf(a.water_ml)} ml water${a.synced_h != null ? ` · synced ${hhmm(a.synced_h)}` : ''}`}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };
  const yesterdayDate = fromKey(home.date);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const count = today.length + yesterday.length;
  return (
    <Card title="Yesterday and today" sub={`${count} session${count === 1 ? '' : 's'}`}>
      <Text style={local.dayHead}>TODAY</Text>
      {later.map((p) => (
        <View key={p.name + p.start_h} style={local.row}>
          <SportChip sport={p.sport} />
          <View style={local.rowMiddle}>
            <Text style={local.rowPlanned}>{p.name}</Text>
            <Text style={local.rowSub}>{`planned · ${dur(p.minutes)}`}</Text>
          </View>
          <Text style={local.rowEnd}>{hhmm(p.start_h)}</Text>
        </View>
      ))}
      {maybe.map((p) => (
        <View key={p.name + p.sport} style={local.row}>
          <SportChip sport={p.sport} />
          <View style={local.rowMiddle}>
            <Text style={local.rowPlanned}>{p.name}</Text>
            <Text style={local.rowSub}>{`maybe · ${dur(p.minutes)}`}</Text>
          </View>
          <Text style={local.rowEnd}>no set time</Text>
        </View>
      ))}
      {today.map(row)}
      {today.length + later.length + maybe.length === 0 ? <Note>Nothing yet today.</Note> : null}
      <Text style={local.dayHead}>{`YESTERDAY · ${DOW[yesterdayDate.getDay()].toUpperCase()} ${yesterdayDate.getDate()}`}</Text>
      {yesterday.map(row)}
      {yesterday.length === 0 ? <Note>Rest day.</Note> : null}
    </Card>
  );
}

function WeekCard({ home }: { home: Home }) {
  const theme = useTheme();
  const bars: Bar[] = home.week.map((d) => {
    const today = d.date === home.date;
    return {
      label: DOW[fromKey(d.date).getDay()][0],
      highlight: today,
      segs: [d.active_kcal ?? 0],
      tip: d.future ? `${fmtDay(d.date)}: still ahead`
        : d.active_kcal != null ? `${fmtDay(d.date)}: ${nf(d.active_kcal)} active kcal${today ? ' so far' : ''}` : `${fmtDay(d.date)}: not synced`,
    };
  });
  return (
    <Card title="Active calories this week" sub="Mon to Sun">
      <Bars bars={bars} colors={[theme.calAct]} height={124} minMax={1500} aria="Active calories per day this week" />
    </Card>
  );
}

export function TodayView({ home, onChanged }: { home: Home; onChanged: () => void }) {
  return (
    <>
      <NudgeCard nudge={home.water.latest_nudge} logs={home.water.logs} onLogged={onChanged} />
      <CallCard call={home.call} next={home.next} maybe={home.sessions.maybe[0]} />
      <Tiles day={home.day} home={home} />
      <Sessions home={home} />
      <WeekCard home={home} />
    </>
  );
}

const cache = new WeakMap<Theme, ReturnType<typeof makeLocal>>();
function useLocal() {
  const theme = useTheme();
  let local = cache.get(theme);
  if (!local) {
    local = makeLocal(theme);
    cache.set(theme, local);
  }
  return local;
}

function makeLocal(t: Theme) {
  return StyleSheet.create({
    callText: { fontSize: 24, fontWeight: '800', lineHeight: 28, letterSpacing: -0.2, color: t.ink },
    why: { fontSize: 12.5, lineHeight: 18, color: t.ink2 },
    strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    stripText: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: t.ink },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: t.surface, borderRadius: 15, padding: 12, gap: 2 },
    tileLabel: { fontSize: 12, fontWeight: '500', color: t.ink2 },
    tileValue: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, color: t.ink, fontVariant: ['tabular-nums'] },
    tileNote: { fontSize: 11.5, color: t.muted },
    split: { flexDirection: 'row', gap: 2, height: 4, marginTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, minHeight: 44 },
    rowMiddle: { flex: 1 },
    rowTitle: { fontSize: 14.5, fontWeight: '600', color: t.ink },
    rowPlanned: { fontSize: 14.5, fontWeight: '500', color: t.ink2 },
    rowSub: { fontSize: 12, color: t.muted },
    rowEnd: { fontSize: 13, fontWeight: '600', color: t.ink2, fontVariant: ['tabular-nums'] },
    details: { gap: 8, paddingBottom: 8 },
    stats: { flexDirection: 'row', gap: 4 },
    stat: { flex: 1 },
    statValue: { fontSize: 18, fontWeight: '700', color: t.ink, fontVariant: ['tabular-nums'] },
    tinyMuted: { fontSize: 11, color: t.muted },
    zones: { flexDirection: 'row', gap: 2, height: 10 },
    zoneLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
    waterTag: { alignSelf: 'flex-start', overflow: 'hidden', fontSize: 12, fontWeight: '600', color: t.accentText, backgroundColor: t.accentWash, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    dayHead: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: t.muted, marginTop: 2 },
  });
}
