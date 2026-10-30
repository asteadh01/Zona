import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SPORT_LABEL, type Sport, type Theme, sportColor, useTheme } from '@/constants/theme';
import type { Call } from '@/types/api';

const cache = new WeakMap<Theme, ReturnType<typeof makeStyles>>();
export function useStyles() {
  const theme = useTheme();
  let styles = cache.get(theme);
  if (!styles) {
    styles = makeStyles(theme);
    cache.set(theme, styles);
  }
  return styles;
}

type IconName = ComponentProps<typeof Ionicons>['name'];

type ScreenProps = { children: ReactNode; refreshing?: boolean; onRefresh?: () => void };
export function Screen({ children, refreshing = false, onRefresh }: ScreenProps) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={[s.screenContent, { paddingTop: insets.top + 10 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
      {children}
    </ScrollView>
  );
}

type HeaderProps = { title: string; small: string; right?: ReactNode };
export function Header({ title, small, right }: HeaderProps) {
  const s = useStyles();
  return (
    <View style={s.header}>
      <View style={s.flex}>
        <Text style={s.headerSmall}>{small}</Text>
        <Text style={s.headerTitle} accessibilityRole="header">{title}</Text>
      </View>
      {right}
    </View>
  );
}

type CardProps = { title?: string; sub?: string; children: ReactNode; wash?: boolean };
export function Card({ title, sub, children, wash = false }: CardProps) {
  const s = useStyles();
  return (
    <View style={[s.card, wash && s.cardWash]}>
      {title ? (
        <View style={s.cardHeader}>
          <Text style={s.cardTitle} accessibilityRole="header">{title}</Text>
          {sub ? <Text style={s.cardSub}>{sub}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <Text style={useStyles().note}>{children}</Text>;
export const Lead = ({ children }: { children: ReactNode }) => <Text style={useStyles().lead}>{children}</Text>;

const TONE_ICON: Record<Call['tone'], IconName> = { good: 'checkmark', warn: 'pulse', serious: 'arrow-down', bad: 'pause' };
export function Pill({ tone, label }: { tone: Call['tone']; label: string }) {
  const s = useStyles();
  const theme = useTheme();
  const look = {
    good: [theme.goodWash, theme.goodInk],
    warn: [theme.warnWash, theme.warnInk],
    serious: [theme.seriousWash, theme.seriousInk],
    bad: [theme.badWash, theme.badInk],
  }[tone];
  return (
    <View style={[s.pill, { backgroundColor: look[0] }]}>
      <Ionicons name={TONE_ICON[tone]} size={14} color={look[1]} />
      <Text style={[s.pillText, { color: look[1] }]}>{label}</Text>
    </View>
  );
}

export function SportChip({ sport }: { sport: string }) {
  const s = useStyles();
  const theme = useTheme();
  return (
    <View style={s.chip}>
      <View style={[s.chipDot, { backgroundColor: sportColor(theme, sport) }]} />
      <Text style={s.chipText}>{SPORT_LABEL[sport as Sport] ?? SPORT_LABEL.other}</Text>
    </View>
  );
}

type SegProps<T extends string | number> = { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string };
export function Seg<T extends string | number>({ options, value, onChange, label }: SegProps<T>) {
  const s = useStyles();
  return (
    <View style={s.seg} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} style={[s.segItem, on && s.segItemOn]} onPress={() => onChange(o.value)}
            accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Text style={[s.segText, on && s.segTextOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type MultiSegProps<T extends string | number> = {
  options: readonly { value: T; label: string; fullName: string }[];
  values: readonly T[];
  onToggle: (value: T) => void;
  label: string;
};
/** Like Seg, for picking several. The strong fill says these are choices you can stack. */
export function MultiSeg<T extends string | number>({ options, values, onToggle, label }: MultiSegProps<T>) {
  const s = useStyles();
  const theme = useTheme();
  return (
    <View style={s.seg} accessibilityLabel={label}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <Pressable key={String(o.value)} style={[s.segItem, s.multiItem, on && { backgroundColor: theme.accent }]} onPress={() => onToggle(o.value)} hitSlop={4}
            accessibilityRole="checkbox" accessibilityLabel={o.fullName} accessibilityState={{ checked: on }}>
            <Text style={[s.segText, on && s.multiTextOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type BtnProps = { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'quiet'; disabled?: boolean };
export function Btn({ label, onPress, kind = 'primary', disabled = false }: BtnProps) {
  const s = useStyles();
  const box = { primary: s.btnPrimary, ghost: s.btnGhost, quiet: s.btnQuiet }[kind];
  const text = { primary: s.btnPrimaryText, ghost: s.btnGhostText, quiet: s.btnQuietText }[kind];
  return (
    <Pressable style={({ pressed }) => [s.btn, box, (pressed || disabled) && s.dim]} onPress={onPress} disabled={disabled}
      accessibilityRole="button" accessibilityState={{ disabled }}>
      <Text style={[s.btnText, text]}>{label}</Text>
    </Pressable>
  );
}

export const BtnRow = ({ children }: { children: ReactNode }) => <View style={useStyles().btnRow}>{children}</View>;

type SetRowProps = { label: string; children: ReactNode };
export function SetRow({ label, children }: SetRowProps) {
  const s = useStyles();
  return (
    <View style={s.setRow}>
      <Text style={s.setLabel}>{label}</Text>
      {typeof children === 'string' ? <Text style={s.setValue}>{children}</Text> : children}
    </View>
  );
}

type ToggleProps = { label: string; value: boolean; onChange: (value: boolean) => void };
export function ToggleRow({ label, value, onChange }: ToggleProps) {
  return (
    <SetRow label={label}>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </SetRow>
  );
}

type StepperProps = { label: string; display: string; onLess: () => void; onMore: () => void };
export function Stepper({ label, display, onLess, onMore }: StepperProps) {
  const s = useStyles();
  return (
    <SetRow label={label}>
      <View style={s.stepper}>
        <Pressable style={s.stepBtn} onPress={onLess} accessibilityRole="button" accessibilityLabel={`Less ${label}`}><Text style={s.stepText}>−</Text></Pressable>
        <Text style={s.stepValue} accessibilityLiveRegion="polite">{display}</Text>
        <Pressable style={s.stepBtn} onPress={onMore} accessibilityRole="button" accessibilityLabel={`More ${label}`}><Text style={s.stepText}>+</Text></Pressable>
      </View>
    </SetRow>
  );
}

export function Meter({ value }: { value: number }) {
  const s = useStyles();
  return <View style={s.meter}><View style={[s.meterFill, { width: `${Math.max(0, Math.min(100, value * 100))}%` }]} /></View>;
}

type BannerProps = { title: string; children: string };
export function Banner({ title, children }: BannerProps) {
  const s = useStyles();
  const theme = useTheme();
  return (
    <View style={s.banner} accessibilityRole="alert">
      <Ionicons name="warning-outline" size={18} color={theme.warnInk} />
      <View style={s.flex}>
        <Text style={s.bannerTitle}>{title}</Text>
        <Text style={s.bannerText}>{children}</Text>
      </View>
    </View>
  );
}

export function Done({ children }: { children: string }) {
  const s = useStyles();
  const theme = useTheme();
  return (
    <View style={s.done} accessibilityLiveRegion="polite">
      <Ionicons name="checkmark" size={16} color={theme.goodInk} />
      <Text style={s.doneText}>{children}</Text>
    </View>
  );
}

type LoadStateProps = { error: string | null; onRetry: () => void };
export function LoadState({ error, onRetry }: LoadStateProps) {
  const s = useStyles();
  if (!error) return <ActivityIndicator style={s.loading} accessibilityLabel="Loading" />;
  return (
    <Card title="Couldn't load this">
      <Note>{error}</Note>
      <Btn label="Try again" kind="quiet" onPress={onRetry} />
    </Card>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    dim: { opacity: 0.6 },
    screen: { flex: 1, backgroundColor: t.bg },
    screenContent: { paddingHorizontal: 16, paddingBottom: 28, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 2 },
    headerSmall: { fontSize: 13, fontWeight: '500', color: t.muted },
    headerTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.4, color: t.ink },
    card: { backgroundColor: t.surface, borderRadius: 18, padding: 14, gap: 10 },
    cardWash: { backgroundColor: t.accentWash },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
    cardTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: t.ink },
    cardSub: { fontSize: 12, color: t.muted },
    note: { fontSize: 12, lineHeight: 17, color: t.muted },
    lead: { fontSize: 13.5, lineHeight: 19, color: t.ink2 },
    pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingVertical: 5, paddingLeft: 8, paddingRight: 11, borderRadius: 999 },
    pillText: { fontSize: 13, fontWeight: '700' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingLeft: 7, paddingRight: 9, borderRadius: 999, backgroundColor: t.surface2 },
    chipDot: { width: 8, height: 8, borderRadius: 4 },
    chipText: { fontSize: 12, fontWeight: '600', color: t.ink2 },
    seg: { flexDirection: 'row', backgroundColor: t.surface2, borderRadius: 11, padding: 2, gap: 2 },
    segItem: { flexGrow: 1, flexBasis: 0, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, borderRadius: 9 },
    segItemOn: { backgroundColor: t.surface, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    segText: { fontSize: 13, fontWeight: '600', color: t.ink2 },
    segTextOn: { color: t.ink },
    multiItem: { paddingVertical: 10, paddingHorizontal: 0 },
    multiTextOn: { color: '#fff' },
    btn: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
    btnText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
    btnPrimary: { backgroundColor: t.accent },
    btnPrimaryText: { color: t.accentInk },
    btnGhost: { backgroundColor: t.accentWash, flexGrow: 1 },
    btnGhostText: { color: t.accentText },
    btnQuiet: { backgroundColor: t.surface2 },
    btnQuietText: { color: t.ink },
    btnRow: { flexDirection: 'row', gap: 8 },
    setRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
    setLabel: { flexShrink: 1, fontSize: 14.5, color: t.ink },
    setValue: { fontSize: 14.5, color: t.ink2 },
    stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface2, borderRadius: 11, padding: 2, gap: 2 },
    stepBtn: { width: 44, height: 36, borderRadius: 9, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
    stepText: { fontSize: 19, fontWeight: '600', color: t.ink },
    stepValue: { minWidth: 66, textAlign: 'center', fontSize: 14, fontWeight: '600', color: t.ink, fontVariant: ['tabular-nums'] },
    meter: { height: 4, borderRadius: 2, backgroundColor: t.surface2, overflow: 'hidden', marginTop: 4 },
    meterFill: { height: '100%', borderRadius: 2, backgroundColor: t.accent },
    banner: { flexDirection: 'row', gap: 9, padding: 12, borderRadius: 14, backgroundColor: t.warnWash },
    bannerTitle: { fontSize: 13.5, fontWeight: '700', color: t.ink },
    bannerText: { fontSize: 13, lineHeight: 18, color: t.ink },
    done: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 12, borderRadius: 12, backgroundColor: t.goodWash },
    doneText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: t.goodInk },
    loading: { paddingVertical: 48 },
  });
}
