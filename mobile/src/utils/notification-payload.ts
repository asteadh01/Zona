// What a notification may ask the app to do. Payloads are checked before use: only known screens, only sane amounts.

export type NotificationAction = { route: '/' | '/water' | '/trends' | '/train'; nudgeKey?: string; logMl?: number };

const NUDGE_KEY = /^workout:\d{1,20}$/;
const ACTION_ML = new Map([['add250', 250], ['add500', 500]]);
const MIN_ML = 50;
const MAX_ML = 2000;

function validMl(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_ML && value <= MAX_ML ? value : undefined;
}

/** Turn a tapped notification (or one of its buttons) into something the app can do, ignoring anything unexpected. */
export function readNotification(data: unknown, actionId: string): NotificationAction {
  const payload = (typeof data === 'object' && data !== null ? data : {}) as { url?: unknown; ml?: unknown };
  const url = typeof payload.url === 'string' ? payload.url : '/';
  const [path, query = ''] = url.split('?');
  const route = path === '/water' || path === '/trends' || path === '/train' ? path : '/';
  const nudge = new URLSearchParams(query).get('nudge');
  const logMl = actionId === 'log' ? validMl(payload.ml) : ACTION_ML.get(actionId);
  return { route, ...(nudge && NUDGE_KEY.test(nudge) ? { nudgeKey: nudge } : {}), ...(logMl ? { logMl } : {}) };
}
