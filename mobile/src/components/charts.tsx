import { Fragment, type ReactNode, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { type Theme, useTheme } from '@/constants/theme';
import { hhmm, nf, ticksFor } from '@/utils/format';

const W = 300;
const f = (n: number): number => Number(n.toFixed(1));

function topRound(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.min(radius, w / 2, h);
  return `M${f(x)},${f(y + h)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h)}Z`;
}

function rightRound(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.min(radius, h / 2, w);
  return `M${f(x)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h - r)}Q${f(x + w)},${f(y + h)} ${f(x + w - r)},${f(y + h)}H${f(x)}Z`;
}

type FrameProps = { height: number; aria: string; children: (tap: (tip: string) => () => void, theme: Theme) => ReactNode };

/** The drawing plus a line under it: tapping any mark shows its exact value there. */
function Frame({ height, aria, children }: FrameProps) {
  const theme = useTheme();
  const [tip, setTip] = useState<string | null>(null);
  const tap = (text: string) => () => setTip(text);
  return (
    <View accessibilityRole="image" accessibilityLabel={aria}>
      <Svg width="100%" style={{ aspectRatio: W / height }} viewBox={`0 0 ${W} ${height}`}>
        {children(tap, theme)}
      </Svg>
      {tip ? <Text style={[styles.tip, { color: theme.ink2, backgroundColor: theme.surface2 }]} accessibilityLiveRegion="polite">{tip}</Text> : null}
    </View>
  );
}

export type Bar = { label?: string; highlight?: boolean; segs: number[]; colors?: string[]; tip: string };
type BarsProps = { bars: Bar[]; colors?: string[]; height?: number; minMax?: number; fmt?: (v: number) => string; left?: number; aria: string };

export function Bars({ bars, colors = [], height = 140, minMax = 0, fmt, left = 32, aria }: BarsProps) {
  const pr = 4, pt = 8, pb = 18;
  const iw = W - left - pr, ih = height - pt - pb;
  const totals = bars.map((b) => b.segs.reduce((a, v) => a + (v || 0), 0));
  const ticks = ticksFor(Math.max(minMax, ...totals), 3);
  const top = ticks[ticks.length - 1];
  const Y = (v: number) => pt + ih - (v / top) * ih;
  const bw = iw / bars.length, gap = Math.max(2, Math.min(8, bw * 0.3)), inner = bw - gap;
  return (
    <Frame height={height} aria={aria}>
      {(tap, t) => (
        <>
          {ticks.map((v, i) => (
            <Axis key={v} y={Y(v)} x1={left} x2={W - pr} solid={i === 0} label={fmt ? fmt(v) : nf(v)} t={t} />
          ))}
          {bars.map((bar, i) => {
            const x = left + i * bw + gap / 2;
            const lastSeg = bar.segs.reduce((last, v, j) => (v > 0 ? j : last), -1);
            let acc = 0;
            return (
              <Fragment key={i}>
                {bar.segs.map((v, j) => {
                  if (!(v > 0)) return null;
                  const yTop = Y(acc + v), h = Y(acc) - yTop - (acc > 0 ? 2 : 0);
                  acc += v;
                  if (h < 0.6) return null;
                  const fill = (bar.colors ?? colors)[j];
                  return j === lastSeg
                    ? <Path key={j} d={topRound(x, yTop, inner, h, 4)} fill={fill} />
                    : <Rect key={j} x={f(x)} y={f(yTop)} width={f(inner)} height={f(h)} fill={fill} />;
                })}
                {bar.label ? (
                  <SvgText x={f(i === 0 ? x : x + inner / 2)} y={height - 5} fontSize={8.5} fontWeight={bar.highlight ? '700' : '500'}
                    fill={bar.highlight ? t.ink : t.muted} textAnchor={i === 0 ? 'start' : 'middle'}>{bar.label}</SvgText>
                ) : null}
                <Rect x={f(left + i * bw)} y={pt} width={f(bw)} height={ih} fill="transparent" onPress={tap(bar.tip)} />
              </Fragment>
            );
          })}
        </>
      )}
    </Frame>
  );
}

export type HRow = { label: string; value: number; color: string; valueLabel: string; tip: string };
export function HBars({ rows, max, left = 84, aria }: { rows: HRow[]; max: number; left?: number; aria: string }) {
  const rh = 20, g = 6, pr = 52;
  const iw = W - left - pr;
  const height = rows.length * (rh + g) - g;
  return (
    <Frame height={height} aria={aria}>
      {(tap, t) => rows.map((r, i) => {
        const y = i * (rh + g);
        const w = r.value > 0 ? Math.max(2, (r.value / Math.max(max, 1)) * iw) : 0;
        return (
          <Fragment key={r.label}>
            <SvgText x={0} y={y + 13.5} fontSize={9.5} fill={t.ink2}>{r.label}</SvgText>
            {w ? <Path d={rightRound(left, y + 3, w, rh - 6, 4)} fill={r.color} /> : null}
            <SvgText x={f(left + w + 6)} y={y + 13.5} fontSize={9.5} fontWeight="700" fill={t.ink}>{r.valueLabel}</SvgText>
            <Rect x={0} y={y} width={W} height={rh + g} fill="transparent" onPress={tap(r.tip)} />
          </Fragment>
        );
      })}
    </Frame>
  );
}

type HeatProps = { rows: string[]; firstHour: number; values: number[][]; aria: string };
export function Heat({ rows, firstHour, values, aria }: HeatProps) {
  const pl = 28, pb = 14, ch = 16;
  const cols = values[0]?.length ?? 18;
  const cw = (W - pl) / cols;
  const height = rows.length * ch + pb;
  const max = Math.max(1, ...values.flat());
  return (
    <Frame height={height} aria={aria}>
      {(tap, t) => {
        const ramp = [t.surface2, t.q1, t.q2, t.q3, t.q4, t.q5];
        return (
          <>
            {rows.map((label, r) => (
              <Fragment key={label}>
                <SvgText x={0} y={f(r * ch + ch / 2 + 3)} fontSize={8.5} fill={t.ink2}>{label}</SvgText>
                {values[r].map((v, c) => {
                  const bin = v ? Math.min(5, Math.ceil((v / max) * 5)) : 0;
                  return (
                    <Rect key={c} x={f(pl + c * cw)} y={f(r * ch)} width={f(cw - 2)} height={ch - 2} rx={2} fill={ramp[bin]}
                      onPress={tap(`${label} ${hhmm(c + firstHour)}: ${v} session${v === 1 ? '' : 's'}`)} />
                  );
                })}
              </Fragment>
            ))}
            {Array.from({ length: cols }, (_, c) => c + firstHour).filter((h) => h % 3 === 0).map((h) => (
              <SvgText key={h} x={f(pl + (h - firstHour) * cw + (cw - 2) / 2)} y={height - 3} fontSize={8.5} fill={t.muted} textAnchor="middle">
                {String(h).padStart(2, '0')}
              </SvgText>
            ))}
          </>
        );
      }}
    </Frame>
  );
}

type Series = { points: [number, number][]; color: string; dashed?: boolean; endDot?: boolean; endLabel?: string };
type LinesProps = {
  x0: number; x1: number; y0: number; y1: number; yTicks: number[]; yFmt?: (v: number) => string; height?: number;
  xLabels?: { at: number; label: string }[]; band?: [number, number]; now?: number | null; series: Series[];
  hits?: { from: number; to: number; tip: string }[]; aria: string;
};

export function Lines({ x0, x1, y0, y1, yTicks, yFmt, height = 120, xLabels = [], band, now, series, hits = [], aria }: LinesProps) {
  const pl = 32, pr = 12, pt = 8, pb = 18;
  const iw = W - pl - pr, ih = height - pt - pb;
  const X = (v: number) => pl + ((v - x0) / (x1 - x0 || 1)) * iw;
  const Y = (v: number) => pt + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  return (
    <Frame height={height} aria={aria}>
      {(tap, t) => (
        <>
          {band ? <Rect x={pl} y={f(Y(band[1]))} width={iw} height={f(Y(band[0]) - Y(band[1]))} fill={t.band} /> : null}
          {yTicks.map((v, i) => <Axis key={v} y={Y(v)} x1={pl} x2={W - pr} solid={i === 0} label={yFmt ? yFmt(v) : String(v)} t={t} />)}
          {xLabels.map((l, i) => (
            <SvgText key={l.label + i} x={f(X(l.at))} y={height - 5} fontSize={8.5} fill={t.muted}
              textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}>{l.label}</SvgText>
          ))}
          {now != null ? (
            <>
              <Line x1={f(X(now))} x2={f(X(now))} y1={pt} y2={pt + ih} stroke={t.muted} strokeWidth={1} strokeDasharray="2 2" />
              <SvgText x={f(X(now) + 3)} y={pt + 7} fontSize={8.5} fill={t.muted}>now</SvgText>
            </>
          ) : null}
          {series.filter((s) => s.points.length).map((s, i) => {
            const end = s.points[s.points.length - 1];
            return (
              <Fragment key={i}>
                <Path d={s.points.map((p, j) => `${j ? 'L' : 'M'}${f(X(p[0]))},${f(Y(p[1]))}`).join('')} fill="none" stroke={s.color} strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 3' : undefined} />
                {s.endDot ? <Circle cx={f(X(end[0]))} cy={f(Y(end[1]))} r={4} fill={s.color} stroke={t.surface} strokeWidth={2} /> : null}
                {s.endLabel ? <SvgText x={f(X(end[0]) - 6)} y={f(Y(end[1]) - 7)} fontSize={9} fontWeight="700" fill={t.ink} textAnchor="end">{s.endLabel}</SvgText> : null}
              </Fragment>
            );
          })}
          {hits.map((h, i) => <Rect key={i} x={f(X(h.from))} y={pt} width={f(Math.max(1, X(h.to) - X(h.from)))} height={ih} fill="transparent" onPress={tap(h.tip)} />)}
        </>
      )}
    </Frame>
  );
}

/** The morning Body Battery on the four-step call scale. */
export function BatteryGauge({ value }: { value: number }) {
  const bb = Math.max(0, Math.min(100, Math.round(value)));
  const X = (v: number) => (v / 100) * W;
  return (
    <Frame height={40} aria={`Body Battery ${bb} on the daily call scale`}>
      {(tap, t) => {
        const segments: [number, number, string, string][] = [[0, 30, t.critical, 'Rest'], [30, 50, t.serious, 'Go light'], [50, 70, t.warning, 'Go easy'], [70, 100, t.good, 'Go']];
        return (
          <>
            {segments.map(([a, b, color, label], i) => (
              <Rect key={label} x={f(X(a) + (i ? 1 : 0))} y={13} width={f(X(b) - X(a) - (i ? 1 : 0) - (i < 3 ? 1 : 0))} height={8} rx={2} fill={color} fillOpacity={0.45}
                onPress={tap(`Body Battery ${a} to ${b === 100 ? 100 : b - 1}: ${label}`)} />
            ))}
            <Line x1={f(X(bb))} x2={f(X(bb))} y1={10} y2={24} stroke={t.ink} strokeWidth={2} strokeLinecap="round" />
            <SvgText x={f(Math.min(W - 8, Math.max(8, X(bb))))} y={7} fontSize={9} fontWeight="700" fill={t.ink} textAnchor="middle">{bb}</SvgText>
            {[0, 30, 50, 70, 100].map((v, i) => (
              <SvgText key={v} x={f(X(v))} y={36} fontSize={8.5} fill={t.muted} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{v}</SvgText>
            ))}
          </>
        );
      }}
    </Frame>
  );
}

type AxisProps = { y: number; x1: number; x2: number; solid: boolean; label: string; t: Theme };
function Axis({ y, x1, x2, solid, label, t }: AxisProps) {
  return (
    <>
      <Line x1={x1} x2={x2} y1={f(y)} y2={f(y)} stroke={solid ? t.axis : t.grid} strokeWidth={1} />
      <SvgText x={x1 - 6} y={f(y + 3)} fontSize={8.5} fill={t.muted} textAnchor="end">{label}</SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  tip: { marginTop: 6, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8, fontSize: 12.5, overflow: 'hidden' },
});
