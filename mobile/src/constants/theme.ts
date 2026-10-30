import { useColorScheme } from 'react-native';

// The sketch's palette: one blue accent, sport colours 1 to 4, single-hue ramps for magnitude, and status colours
// that always come with an icon and a label. Each mode is tuned for its own surface.
const light = {
  bg: '#eceff3', surface: '#fcfcfb', surface2: '#e8ecf0',
  ink: '#0f1a2a', ink2: '#4b5563', muted: '#7b828c', line: '#dbe0e6', grid: '#e3e6ea', axis: '#c3c7cd',
  accent: '#2a78d6', accentInk: '#ffffff', accentWash: 'rgba(42,120,214,0.11)', accentText: '#1c5cab', band: 'rgba(42,120,214,0.10)',
  run: '#2a78d6', bike: '#eb6834', strength: '#1baf7a', swim: '#eda100', other: '#898781',
  q1: '#cde2fb', q2: '#9ec5f4', q3: '#6da7ec', q4: '#3987e5', q5: '#256abf', onQ: '#ffffff', qMute: '#b7d3f6',
  z1: '#86b6ef', z2: '#5598e7', z3: '#2a78d6', z4: '#1c5cab', z5: '#104281',
  calRest: '#b7d3f6', calAct: '#2a78d6',
  good: '#0ca30c', warning: '#fab219', critical: '#d03b3b', serious: '#ec835a',
  goodInk: '#006300', goodWash: 'rgba(12,163,12,0.11)', warnInk: '#855600', warnWash: 'rgba(250,178,25,0.20)',
  badInk: '#a82222', badWash: 'rgba(208,59,59,0.11)', seriousInk: '#9a3f17', seriousWash: 'rgba(236,131,90,0.18)',
};

const dark: typeof light = {
  bg: '#0f1114', surface: '#1a1b1d', surface2: '#26292d',
  ink: '#eef0f2', ink2: '#b9bec6', muted: '#8a9099', line: '#2e3238', grid: '#2a2d31', axis: '#3d4148',
  accent: '#3987e5', accentInk: '#ffffff', accentWash: 'rgba(57,135,229,0.18)', accentText: '#86b6ef', band: 'rgba(57,135,229,0.16)',
  run: '#3987e5', bike: '#d95926', strength: '#199e70', swim: '#c98500', other: '#898781',
  q1: '#143c70', q2: '#1c5cab', q3: '#3987e5', q4: '#6da7ec', q5: '#9ec5f4', onQ: '#0c0f13', qMute: '#2a4a72',
  z1: '#1c5cab', z2: '#2a78d6', z3: '#3987e5', z4: '#6da7ec', z5: '#9ec5f4',
  calRest: '#24456e', calAct: '#3987e5',
  good: '#0ca30c', warning: '#fab219', critical: '#d03b3b', serious: '#ec835a',
  goodInk: '#2fc02f', goodWash: 'rgba(12,163,12,0.20)', warnInk: '#fab219', warnWash: 'rgba(250,178,25,0.16)',
  badInk: '#f07a7a', badWash: 'rgba(208,59,59,0.20)', seriousInk: '#f09a76', seriousWash: 'rgba(236,131,90,0.20)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const SPORT_ORDER = ['run', 'bike', 'strength', 'swim', 'other'] as const;
export type Sport = (typeof SPORT_ORDER)[number];
export const SPORT_LABEL: Record<Sport, string> = { run: 'Run', bike: 'Ride', strength: 'Strength', swim: 'Swim', other: 'Other' };
export const sportColor = (theme: Theme, sport: string): string => theme[(sport in SPORT_LABEL ? sport : 'other') as Sport];

export const ZONE_NAMES = ['Warm-up', 'Easy', 'Aerobic', 'Threshold', 'Maximum'];
export const zoneColors = (theme: Theme): string[] => [theme.z1, theme.z2, theme.z3, theme.z4, theme.z5];
