// Zona PWA: routing, data loading and events. Views are pure functions in views.js.
import * as V from './views.js';

const $screen = document.getElementById('screen');
const $tabs = document.getElementById('tabs');
const TABS = ['home', 'trends', 'train', 'water'];
const ui = { tab: 'home', sub: 'today', month: null, sel: null, open: null, range: 12, me: null, nudge: null, nudgeLogged: false, msg: '', pushBlocked: '' };
let dismissed = new Set();
try { dismissed = new Set(JSON.parse(localStorage.getItem('zona.dismissed') || '[]')); } catch { /* private mode: nothing remembered */ }

class SignedOut extends Error {}

// signin: true for the login call itself, where a 401 means "wrong password", not "signed out"
async function api(path, { method = 'GET', body, signin = false } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !signin) throw new SignedOut();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`);
  return data;
}

// ---------- routing: #home, #home/month, #home/insights, #trends, #train, #water ----------
function readHash() {
  const [tab, sub] = location.hash.replace('#', '').split('/');
  ui.tab = TABS.includes(tab) ? tab : 'home';
  if (ui.tab === 'home') ui.sub = ['today', 'month', 'insights'].includes(sub) ? sub : 'today';
}
function go(tab, sub) {
  const hash = tab === 'home' && sub && sub !== 'today' ? `#home/${sub}` : `#${tab}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  const moved = tab !== ui.tab || (tab === 'home' && sub !== ui.sub);
  readHash();
  render().then(() => { if (moved) window.scrollTo(0, 0); });
}

function ym(dateKey, delta = 0) {
  const [y, m] = dateKey.split('-').map(Number), d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// a nudge from the notification URL, else the latest one from the last 3 hours that you haven't dismissed
function pickNudge(water) {
  if (ui.nudge && ui.nudge.fromUrl) return ui.nudge;
  const n = water.latest_nudge;
  return n && !dismissed.has(n.key) ? n : null;
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  $tabs.hidden = false;
  $tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  if (!$screen.firstElementChild) $screen.innerHTML = V.loading();
  try {
    if (!ui.me) ui.me = await api('/api/me');
    const ctx = { ...ui, fake: ui.me.fake };
    let html;
    if (ui.tab === 'home') {
      const home = await api('/api/home');
      ctx.nudge = pickNudge(home.water);
      if (ui.sub === 'today') html = V.homeToday(home, ctx);
      else if (ui.sub === 'month') { ui.month = ui.month || ym(home.date); html = V.homeMonth(await api(`/api/month?m=${ui.month}`), home, ctx); }
      else html = V.homeInsights(await api('/api/insights'), home, ctx);
    } else if (ui.tab === 'trends') {
      html = V.trends(await api(`/api/trends?weeks=${ui.range}`), ctx);
    } else if (ui.tab === 'train') {
      const [plan, home] = await Promise.all([api('/api/plan'), api('/api/home')]);
      html = V.train(plan, ui.me, home.sync, ctx);
    } else {
      const home = await api('/api/home');
      ctx.nudge = pickNudge(home.water);
      html = V.water(home.water, home.settings, { ...ctx, date: home.date, nowH: home.now_h });
    }
    if (seq === renderSeq) $screen.innerHTML = html;
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err instanceof SignedOut) return showLogin();
    $screen.innerHTML = V.failed(err.message || 'Zona couldn\'t reach its server.');
  }
}

function showLogin(error = '') {
  ui.me = null;
  $tabs.hidden = true;
  $screen.innerHTML = V.login(error);
  $screen.querySelector('input')?.focus();
}

// ---------- actions ----------
async function saveSettings(patch) {
  await api('/api/settings', { method: 'PUT', body: patch });
  await render();
}

async function logWater(ml, source) {
  await api('/api/water', { method: 'POST', body: { ml, source } });
  if (source === 'nudge') ui.nudgeLogged = true;
  await render();
}

const urlB64 = s => { const pad = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    ui.pushBlocked = standalone() ? 'This browser has no web push.' : 'On iPhone, add Zona to your Home Screen first (Share › Add to Home Screen), then open it from there and turn notifications on.';
    return render();
  }
  if (await Notification.requestPermission() !== 'granted') {
    ui.msg = 'Notifications are blocked. Allow them for Zona in iPhone Settings › Notifications.';
    return render();
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(ui.me.push.public_key) });
  const res = await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  ui.me = { ...ui.me, devices: res.devices };
  ui.msg = 'This iPhone will get nudges and reminders.';
  await render();
}

const ACTIONS = {
  async sync() { await api('/api/sync', { method: 'POST' }); ui.msg = 'Synced.'; await render(); },
  'push-on': enablePush,
  async 'push-test'() { const r = await api('/api/push/test', { method: 'POST' }); ui.msg = r.sent ? 'Test sent.' : 'Nothing was sent. Turn notifications on first.'; await render(); },
  async 'push-test-later'() { await api('/api/push/test?delay=10', { method: 'POST' }); ui.msg = 'Lock your phone now. The test arrives in 10 seconds, and your watch should buzz.'; await render(); },
  async logout() { try { await api('/api/logout', { method: 'POST' }); } finally { showLogin(); } },
  async 'fake-run'() { const r = await api('/api/dev/finish-workout', { method: 'POST', body: { sport: 'running', minutes: 47, name: 'Easy run' } }); ui.nudge = r.nudge; ui.nudgeLogged = false; await render(); },
  async dismiss(t) { dismissed.add(t.dataset.key); try { localStorage.setItem('zona.dismissed', JSON.stringify([...dismissed].slice(-50))); } catch { /* not remembered */ } ui.nudge = null; await render(); },
  reload: render,
};

document.addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t || t.type === 'submit') return;
  const ds = t.dataset;
  try {
    if (ds.tab) { ui.msg = ''; return go(ds.tab, ds.tab === 'home' ? ui.sub : undefined); }
    if (ds.sub) return go('home', ds.sub);
    if (ds.open !== undefined) { ui.open = t.getAttribute('aria-expanded') === 'true' ? '' : ds.open; return render(); }
    if (ds.day) { ui.sel = ds.day; return render(); }
    if (ds.month && ui.month) { ui.month = ym(ui.month + '-01', +ds.month); ui.sel = null; return render(); }
    if (ds.range) { ui.range = +ds.range; return render(); }
    if (ds.log) return logWater(+ds.log, ds.source || 'app');
    if (ds.unlog) { await api(`/api/water/${+ds.unlog}`, { method: 'DELETE' }); return render(); }
    if (ds.planDel) { await api(`/api/plan/${+ds.planDel}`, { method: 'DELETE' }); return render(); }
    if (ds.step) {
      const s = (await api('/api/settings'));
      const [lo, hi] = ds.step === 'base' ? [1500, 5000] : [0, 1000];
      return saveSettings({ [ds.step]: Math.min(hi, Math.max(lo, s[ds.step] + +ds.by)) });
    }
    if (ds.toggle) return saveSettings({ [ds.toggle]: t.getAttribute('aria-checked') !== 'true' });
    if (ds.poll) return saveSettings({ poll: +ds.poll });
    if (ds.every !== undefined) return saveSettings({ remind_every: +ds.every });
    if (ds.act && ACTIONS[ds.act]) { t.disabled = true; return await ACTIONS[ds.act](t); }
  } catch (err) {
    if (err instanceof SignedOut) return showLogin();
    ui.msg = err.message;
    render();
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'loginForm') {
      try { await api('/api/login', { method: 'POST', body: { password: data.password }, signin: true }); } catch (err) { return showLogin(err.message); }
      return render();
    }
    if (form.id === 'planForm') {
      await api('/api/plan', { method: 'POST', body: { weekday: +data.weekday, start: data.start, minutes: +data.minutes, sport: data.sport, name: data.name.trim() } });
      return render();
    }
  } catch (err) {
    if (err instanceof SignedOut) return showLogin();
    ui.msg = err.message;
    render();
  }
});

// ---------- tooltips: hover on desktop, tap on the phone ----------
const tip = document.getElementById('tip');
let tipTimer;
const hideTip = () => { tip.hidden = true; };
function showTip(el, x, y) {
  tip.textContent = el.getAttribute('data-tip');
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 12;
  if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 14);
  if (top < 8) top = y + 18;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
document.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest?.('[data-tip]');
  if (!el || !el.getAttribute('data-tip')) return hideTip();
  showTip(el, e.clientX, e.clientY);
});
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  const el = e.target.closest?.('[data-tip]');
  if (!el || !el.getAttribute('data-tip')) return hideTip();
  showTip(el, e.clientX, e.clientY); clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 2600);
});
document.addEventListener('scroll', hideTip, true);

// ---------- start ----------
async function openNudgeFromUrl() {
  const key = new URLSearchParams(location.search).get('nudge');
  if (!key || !/^workout:\d{1,20}$/.test(key)) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try { ui.nudge = { ...(await api(`/api/nudge?key=${encodeURIComponent(key)}`)), fromUrl: true }; } catch { /* stale link: show the normal screen */ }
}

$tabs.innerHTML = [['home', 'Home'], ['trends', 'Trends'], ['train', 'Train'], ['water', 'Water']]
  .map(([k, l]) => `<button type="button" data-tab="${k}">${V.ICON[k]}${l}</button>`).join('');
window.addEventListener('hashchange', () => { readHash(); render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ui.me) render(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* app still works without offline and push */ });
readHash();
openNudgeFromUrl().finally(render);
