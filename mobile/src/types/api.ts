// What the Zona server returns (zona/service.py, zona/insights.py, zona/main.py).

export type SyncStatus = { status: 'ok' | 'error' | 'key' | 'never'; last: string | null; error: string | null };

export type Call = { level: number; tone: 'good' | 'warn' | 'serious' | 'bad'; label: string; text: string; sub: string; why: string[]; bb: number };

export type Activity = {
  id: string; start: string; date: string; start_h: number; sport: string; name: string; minutes: number; kcal: number;
  km: number | null; avg_hr: number | null; zones: number[]; synced_at: string | null; water_ml?: number; synced_h?: number | null;
};

export type PlannedSession = { start_h: number; minutes: number; sport: string; name: string };
export type MaybeSession = { minutes: number; sport: string; name: string };

export type Day = {
  date: string; total_kcal: number | null; active_kcal: number | null; resting_kcal: number | null; steps: number | null;
  intensity_min: number | null; sleep_score: number | null; sleep_min: number | null; hrv: number | null; hrv_week: number | null;
  hrv_low: number | null; hrv_high: number | null; bb_wake: number | null; bb_now: number | null;
};

export type Nudge = {
  kind: string; key: string; created: string; status: 'sent' | 'skipped' | 'held' | 'merged'; reason: string | null;
  payload: { names?: string[]; minutes?: number; ml?: number; title?: string; body?: string; goal?: number };
};

export type WaterSession = { name: string; start_h: number; minutes: number; ml: number; done: boolean; synced_h: number | null };

export type Water = {
  base: number; goal: number; intake: number; sessions: WaterSession[]; goal_steps: [number, number][];
  logs: { id: number; h: number; ml: number; source: string }[]; latest_nudge: Nudge | null;
};

export type Settings = {
  base: number; per_hour: number; count_planned: boolean; nudge: boolean; poll: number; call_rule: 'full' | 'bb';
  remind_every: number; pause_in_workouts: boolean; active_from: number; active_to: number; call_push: boolean;
};

export type Home = {
  now: string; date: string; now_h: number; sync: SyncStatus; call: Call | null; next: PlannedSession | null; day: Day | null;
  intensity_week: number; sessions: { today: Activity[]; yesterday: Activity[]; later: PlannedSession[]; maybe: MaybeSession[] };
  week: { date: string; active_kcal: number | null; future: boolean }[]; water: Water; settings: Settings;
};

export type MonthActivity = { name: string; sport: string; start_h: number; minutes: number; km: number | null; kcal: number };
export type MonthDay = {
  date: string; in_month: boolean; future: boolean; synced: boolean; minutes: number; acts: MonthActivity[];
  total_kcal: number | null; steps: number | null; sleep_score: number | null;
};
export type Month = { month: string; today: string; weeks: { start: string; minutes: number; days: MonthDay[] }[] };

export type Trends = {
  weeks: { start: string; minutes: Record<string, number> }[]; heat: number[][]; first_hour: number; zones: number[];
  kcal: { date: string; resting: number | null; active: number | null }[];
  sleep: { date: string; score: number; minutes: number | null }[];
};

export type Insights =
  | { enough: false }
  | {
      enough: true;
      start_hours: { hours: number[]; first_hour: number; peak_hour: number; share: number; sessions: number };
      weekly_kcal: { weeks: { start: string; kcal: number }[]; avg_before: number; pct: number };
      late_sleep: { late_avg: number | null; other_avg: number | null; late_nights: number; other_nights: number };
      hrv: { points: { date: string; ms: number }[]; low: number; high: number; week: number; status: string } | null;
    };

export type PlanItem = { id: number; weekday: number; start_h: number | null; minutes: number; sport: string; name: string };
export type Me = { ok: boolean; fake: boolean; devices: number };
