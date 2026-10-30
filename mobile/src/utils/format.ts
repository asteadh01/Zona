// Display formatters, shared by every screen. All dates are the server's local YYYY-MM-DD keys.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEK_ROWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const nf = (n: number): string => Math.round(n).toLocaleString('en-US');
export const litres = (ml: number): string => `${(ml / 1000).toFixed(2)} L`;

export function hhmm(hours: number): string {
  const m = Math.round(hours * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dur(minutes: number): string {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDay(key: string): string {
  const d = fromKey(key);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

export function shortDate(key: string): string {
  const d = fromKey(key);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

export function monthName(ym: string): { month: string; year: string } {
  const [y, m] = ym.split('-').map(Number);
  return { month: MONTHS[m - 1], year: String(y) };
}

/** The YYYY-MM of a date key, moved by some months. */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function pace(minutes: number, km: number): string {
  const p = minutes / km;
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`;
}

/** "07:30" or "6:30pm" to hours, or null if it isn't a real time of day. */
export function parseTime(text: string): number | null {
  const clean = text.trim().toLowerCase();
  const twelve = /^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([ap])m$/.exec(clean);
  if (twelve) return (Number(twelve[1]) % 12) + (twelve[3] === 'p' ? 12 : 0) + Number(twelve[2] ?? 0) / 60;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(clean);
  return match ? Number(match[1]) + Number(match[2]) / 60 : null;
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const q = raw / p;
  return (q <= 1 ? 1 : q <= 2 ? 2 : q <= 2.5 ? 2.5 : q <= 5 ? 5 : 10) * p;
}

/** Round axis ticks from 0 up to a nice number at or above max. */
export function ticksFor(max: number, count = 3): number[] {
  const step = niceStep(Math.max(max, 1e-6) / count);
  const top = Math.ceil(max / step) * step || step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}
