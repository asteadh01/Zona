import { useAuthStore } from '@/store/auth-store';
import type { Home, Insights, Me, Month, Nudge, PlanItem, Settings, SyncStatus, Trends, Water } from '@/types/api';
import { apiBase } from '@/utils/api-base';

const BASE = apiBase(process.env.EXPO_PUBLIC_ZONA_API, __DEV__);

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown };

async function request<T>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && token) {
    await useAuthStore.getState().signedOut(); // revoked or expired: back to the sign-in screen
    throw new Error('Please sign in again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (typeof data?.detail === 'string') throw new Error(data.detail);
    // Cloud Run answers these itself, with no detail, while an instance starts: right after a deploy, for example.
    throw new Error(response.status === 429 || response.status === 503 ? "Zona's server is starting up. Try again in a minute." : `Zona's server answered ${response.status}.`);
  }
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('json') ? response.json() : response.text()) as Promise<T>;
}

export const api = {
  login: (password: string) => request<{ token: string }>('/api/login', { method: 'POST', body: { password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  me: () => request<Me>('/api/me'),
  home: () => request<Home>('/api/home'),
  month: (ym: string) => request<Month>(`/api/month?m=${ym}`),
  insights: () => request<Insights>('/api/insights'),
  trends: (weeks: 4 | 12) => request<Trends>(`/api/trends?weeks=${weeks}`),
  logWater: (ml: number, source: 'app' | 'nudge' = 'app') => request<Water>('/api/water', { method: 'POST', body: { ml, source } }),
  deleteWater: (id: number) => request<Water>(`/api/water/${id}`, { method: 'DELETE' }),
  nudge: (key: string) => request<Nudge>(`/api/nudge?key=${encodeURIComponent(key)}`),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('/api/settings', { method: 'PUT', body: patch }),
  plan: () => request<PlanItem[]>('/api/plan'),
  addPlan: (item: { weekdays: number[]; start: string | null; minutes: number; sport: string; name: string }) =>
    request<PlanItem[]>('/api/plan', { method: 'POST', body: item }),
  deletePlan: (id: number) => request('/api/plan/' + id, { method: 'DELETE' }),
  registerPush: (token: string) => request<{ devices: number }>('/api/push/register', { method: 'POST', body: { token } }),
  testPush: (delay = 0) => request<{ sent: number }>(`/api/push/test?delay=${delay}`, { method: 'POST' }),
  sync: () => request<SyncStatus>('/api/sync', { method: 'POST' }),
  garminShapes: () => request<string>('/api/garmin-shapes'),
  finishFakeWorkout: () => request('/api/dev/finish-workout', { method: 'POST', body: { sport: 'running', minutes: 47, name: 'Easy run' } }),
};
