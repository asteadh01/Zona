// Screens as HTML strings. Pure: data in, markup out. Every API value goes through esc().
import { esc, f, nf, sum, L, hhmm, dur, fmtDay, shortDate, monthName, fromKey, DOW, ticksFor, vBars, hBars, heat, lines, bbGauge } from './charts.js';

export const SPORT = { run: ['Run', 'var(--s1)'], bike: ['Ride', 'var(--s2)'], strength: ['Strength', 'var(--s3)'], swim: ['Swim', 'var(--s4)'], other: ['Other', 'var(--s5)'] };
const SPORT_ORDER = ['run', 'bike', 'strength', 'swim', 'other'];
const ZNAME = ['Warm-up', 'Easy', 'Aerobic', 'Threshold', 'Maximum'];
const ZC = ['var(--z1)', 'var(--z2)', 'var(--z3)', 'var(--z4)', 'var(--z5)'];
const ROWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h4.5v-5h3v5H18V9.5"/></svg>',
  trends: '<svg viewBox="0 0 24 24"><path d="M5 20v-8M10 20V5M15 20v-6M20 20V9"/></svg>',
  train: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3h4M18.5 6.5L20 5"/></svg>',
  water: '<svg viewBox="0 0 24 24"><path d="M12 3c3.6 4.6 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.4-6.4 6-11z"/></svg>',
};
const WARN = '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7"/></svg>';
const TONE_ICON = {
  good: CHECK, warn: '<svg viewBox="0 0 16 16"><path d="M3 9c2-3 4 1 6-2s3-1 4-1"/></svg>',
  serious: '<svg viewBox="0 0 16 16"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>', bad: '<svg viewBox="0 0 16 16"><path d="M5.5 4v8M10.5 4v8"/></svg>',
};

const acard = (title, sub, body, cls = '') => `<section class="acard${cls ? ' ' + cls : ''}"><header><h4>${esc(title)}</h4>${sub ? `<span>${esc(sub)}</span>` : ''}</header>${body}</section>`;
const emptyCard = (t, p) => `<section class="acard empty"><h4>${esc(t)}</h4><p class="note">${esc(p)}</p></section>`;
const segBtn = (k, v, label, cur) => `<button type="button" data-${k}="${esc(v)}" aria-pressed="${String(cur) === String(v)}">${esc(label)}</button>`;
const sw = (key, on, label) => `<button class="sw" type="button" role="switch" aria-label="${esc(label)}" aria-checked="${!!on}" data-toggle="${key}"></button>`;
const appHead = (title, small, right = '') => `<header class="ahead"><div><small>${esc(small)}</small><h1>${esc(title)}</h1></div>${right}</header>`;
const sportChip = s => `<span class="chip"><i style="background:${(SPORT[s] || SPORT.other)[1]}"></i>${(SPORT[s] || SPORT.other)[0]}</span>`;
const distLabel = a => a.km ? ` · ${a.sport === 'swim' ? nf(a.km * 1000) + ' m' : a.km.toFixed(1) + ' km'}` : '';
const meter = v => `<div class="meter"><i style="width:${f(Math.max(0, Math.min(100, v * 100)))}%"></i></div>`;

// ---------- shared pieces ----------
export function syncChip(sync, nowIso, fake) {
  const tail = fake ? ' · sample data' : '';
  if (sync.status === 'key') return `<button type="button" class="sync bad" data-act="sync"><i></i>Garmin key refused</button>`;
  if (sync.status === 'error') return `<button type="button" class="sync bad" data-act="sync"><i></i>Sync failed · retry${tail}</button>`;
  if (!sync.last) return `<button type="button" class="sync off" data-act="sync"><i></i>Not synced yet${tail}</button>`;
  const mins = Math.max(0, Math.round((new Date(nowIso) - new Date(sync.last)) / 60000));
  return `<button type="button" class="sync" data-act="sync"><i></i>Synced ${mins < 1 ? 'just now' : mins < 90 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}${tail}</button>`;
}

export function banner(sync) {
  if (sync.status === 'key') return `<div class="banner" role="status">${WARN}<div><b>Zona can't reach Garmin</b>Garmin refused your Personal API key, so nothing new is syncing. Create a new key in Garmin Connect › Settings › Personal API Key and put it in Zona's server settings.</div></div>`;
  if (sync.status === 'error') return `<div class="banner" role="status">${WARN}<div><b>Last sync didn't finish</b>${esc(sync.error || 'Garmin did not answer')}. Zona tries again on its own.</div></div>`;
  return '';
}

function callCard(call, next, compact) {
  if (!call) return compact ? '' : acard("Today's call", 'waiting for last night', '<p class="note">Zona makes the call once your Body Battery from this morning syncs from Garmin.</p>');
  const pill = `<span class="pill ${esc(call.tone)}">${TONE_ICON[call.tone] || ''}${esc(call.label)}</span>`;
  if (compact) return `<section class="acard callstrip" data-tip="${esc(call.why.join(' · '))}"><div class="row">${pill}<b class="call-h">${esc(call.text)}</b></div></section>`;
  return acard("Today's call", next ? `${next.name} at ${hhmm(next.start_h)}` : 'nothing else planned',
    `${pill}<p class="call-h">${esc(call.text)}</p><p class="lead">${esc(call.sub)}</p>${bbGauge(call.bb)}<ul class="why">${call.why.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
}

// the in-app card after a workout syncs: what the push said, plus the log buttons the push can't carry on iOS
export function nudgeCard(n, logged) {
  if (!n) return '';
  const p = n.payload || {}, ml = p.ml || 0, drink = ml >= 1000 ? L(ml) : `${ml} ml`;
  const title = p.title || `${(p.names || []).join(' and ')} · ${dur(p.minutes || 0)}`;
  if (n.status === 'skipped' && (n.reason === 'short' || n.reason === 'off')) {
    return acard(title, 'goal updated', `<p class="call-h">+${esc(drink)} on today's goal</p><p class="lead">${n.reason === 'short' ? 'Sessions under 20 minutes raise the goal without a nudge.' : 'Nudges are off, so Zona only raised the goal.'}</p>`, 'nudge');
  }
  const action = logged ? `<div class="sent">${CHECK}Logged. It counts toward today's water.</div>`
    : `<button class="btn" type="button" data-log="${Math.min(2000, ml)}" data-source="nudge">Log ${esc(drink)}</button><div class="btnrow"><button class="btn ghost" type="button" data-log="250" data-source="nudge">+250 ml</button><button class="btn ghost" type="button" data-act="dismiss" data-key="${esc(n.key)}">Not now</button></div>`;
  const lead = n.reason === 'quiet' ? 'It was after your active hours, so nothing buzzed. Have some before bed.'
    : `Spread it ${ml >= 1000 ? 'over the next two hours' : 'over the next hour'}.${(p.minutes || 0) >= 120 ? ' After a session this long, add some salt or a sports drink.' : ''}`;
  const at = new Date(n.created), atH = at.getHours() + at.getMinutes() / 60 + at.getSeconds() / 3600;
  return acard(title, n.status === 'sent' ? `nudged ${hhmm(atH)}` : 'no buzz',
    `<p class="call-h">Drink about ${esc(drink)}</p><p class="lead">${esc(lead)}</p>${action}`, 'nudge');
}

// ---------- Home: Today ----------
function tiles(h) {
  const d = h.day || {}, w = h.water, has = v => v != null;
  const kcalBar = has(d.active_kcal) && has(d.total_kcal) && d.total_kcal > 0
    ? `<div class="split"><i style="width:${f(d.active_kcal / d.total_kcal * 100)}%;background:var(--cal-act)"></i><i style="flex:1;background:var(--cal-rest)"></i></div>` : meter(0);
  const t = [
    ['Calories', has(d.total_kcal) ? nf(d.total_kcal) : '—', has(d.active_kcal) ? `${nf(d.active_kcal)} active so far` : 'no data', kcalBar,
      has(d.active_kcal) ? `Active ${nf(d.active_kcal)} kcal, resting ${nf(d.resting_kcal || 0)} kcal` : ''],
    ['Steps', has(d.steps) ? nf(d.steps) : '—', 'of 10,000', meter((d.steps || 0) / 1e4)],
    ['Intensity min', nf(h.intensity_week), 'of 150 this week', meter(h.intensity_week / 150)],
    ['Body Battery', has(d.bb_now) ? d.bb_now : '—', has(d.bb_wake) ? `woke up at ${d.bb_wake}` : 'no data', meter((d.bb_now || 0) / 100)],
    ['Sleep score', has(d.sleep_score) ? d.sleep_score : '—', has(d.sleep_min) ? `${dur(d.sleep_min)} asleep` : 'no data', meter((d.sleep_score || 0) / 100)],
    ['Water', (w.intake / 1000).toFixed(2), `of ${L(w.goal)} goal`, meter(w.intake / w.goal), `Goal: ${L(w.base)} base plus ${w.goal - w.base} ml for sport today`],
  ];
  return `<div class="tiles">${t.map(([b, v, s, bar, tip]) => `<div class="tile"${tip ? ` data-tip="${esc(tip)}"` : ''}><b>${b}</b><span class="num">${esc(v)}</span><small>${esc(s)}</small>${bar}</div>`).join('')}</div>`;
}

const pace = (min, km) => { const p = min / km, m = Math.floor(p), s = Math.round((p - m) * 60); return `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`; };
function actStats(a) {
  if (a.sport === 'run' && a.km) return [[a.km.toFixed(1), 'km'], [dur(a.minutes), 'time'], [pace(a.minutes, a.km), '/km'], [a.avg_hr ?? '—', 'avg bpm']];
  if (a.sport === 'bike' && a.km) return [[a.km.toFixed(1), 'km'], [dur(a.minutes), 'time'], [(a.km / a.minutes * 60).toFixed(1), 'km/h'], [a.avg_hr ?? '—', 'avg bpm']];
  if (a.sport === 'swim' && a.km) return [[nf(a.km * 1000), 'm'], [dur(a.minutes), 'time'], [pace(a.minutes / 10, a.km), '/100 m'], [a.avg_hr ?? '—', 'avg bpm']];
  return [[dur(a.minutes), 'time'], [nf(a.kcal), 'kcal'], [a.avg_hr ?? '—', 'avg bpm'], [Math.round(a.zones[3] + a.zones[4]), 'hard min']];
}
const zoneBar = a => sum(a.zones, z => z) < 1 ? '' : `<div class="zbar">${a.zones.map((z, i) => z > 0.5 ? `<i style="flex:${f(z)};background:${ZC[i]}" data-tip="${esc(`Z${i + 1} ${ZNAME[i]}: ${dur(z)}`)}"></i>` : '').join('')}</div><div class="zlab"><span>Z1</span><span>time in heart-rate zones</span><span>Z5</span></div>`;

function sessionsCard(h, open) {
  if (h.sync.status === 'key' && !h.sessions.today.length && !h.sessions.yesterday.length) return acard('Yesterday and today', '', '<p class="note">Nothing new until Zona can reach Garmin again.</p>');
  const { today, yesterday, later } = h.sessions, newest = today[0] || yesterday[0];
  const openId = open ?? (newest ? newest.id : '');
  const row = a => {
    const isOpen = a.id === openId;
    return `<button type="button" class="act actbtn" data-open="${esc(a.id)}" aria-expanded="${isOpen}">${sportChip(a.sport)}<div><b>${esc(a.name)}</b><small>${hhmm(a.start_h)} · ${dur(a.minutes)}${distLabel(a)}</small></div><span class="k">${nf(a.kcal)} kcal</span></button>`
      + (isOpen ? `<div class="actx"><div class="stats">${actStats(a).map(s => `<div><b>${esc(s[0])}</b><small>${s[1]}</small></div>`).join('')}</div>${zoneBar(a)}${a.water_ml != null ? `<span class="wtag">${ICON.water}+${a.water_ml} ml water${a.synced_h != null ? ` · synced ${hhmm(a.synced_h)}` : ''}</span>` : ''}</div>` : '');
  };
  const ahead = later.map(p => `<div class="act plan">${sportChip(p.sport)}<div><b>${esc(p.name)}</b><small>planned · ${dur(p.minutes)}</small></div><span class="state">${hhmm(p.start_h)}</span></div>`).join('');
  const group = (title, rows, none) => `<div class="dayhead">${esc(title)}</div><div class="acts">${rows || `<p class="note">${none}</p>`}</div>`;
  const n = today.length + yesterday.length;
  const yKey = new Date(fromKey(h.date).getTime() - 864e5);
  return acard('Yesterday and today', `${n} session${n === 1 ? '' : 's'}`,
    group('Today', ahead + today.map(row).join(''), 'Nothing yet today.') + group(`Yesterday · ${DOW[yKey.getDay()]} ${yKey.getDate()}`, yesterday.map(row).join(''), 'Rest day.'));
}

function weekCard(h) {
  const cats = h.week.map(d => ({ label: DOW[fromKey(d.date).getDay()][0], hl: d.date === h.date, segs: [d.active_kcal || 0],
    tip: d.future ? `${fmtDay(d.date)}: still ahead` : d.active_kcal != null ? `${fmtDay(d.date)}: ${nf(d.active_kcal)} active kcal${d.date === h.date ? ' so far' : ''}` : `${fmtDay(d.date)}: not synced` }));
  return acard('Active calories this week', 'Mon to Sun', vBars({ cats, colors: ['var(--cal-act)'], h: 124, minMax: 1500, aria: 'Active calories per day this week' }));
}

const switcher = sub => `<div class="seg" role="tablist">${segBtn('sub', 'today', 'Today', sub)}${segBtn('sub', 'month', 'Month', sub)}${segBtn('sub', 'insights', 'Insights', sub)}</div>`;

export function homeToday(h, ui) {
  return appHead('Today', fmtDay(h.date), syncChip(h.sync, h.now, ui.fake)) + switcher('today') + banner(h.sync)
    + (ui.nudge ? nudgeCard(ui.nudge, ui.nudgeLogged) : '')
    + callCard(h.call, h.next) + tiles(h) + sessionsCard(h, ui.open) + weekCard(h);
}

// ---------- Home: Month ----------
export function homeMonth(m, h, ui) {
  const sel = ui.sel || m.today;
  const [mName, year] = monthName(m.month);
  const nav = `<div class="monthnav"><button type="button" data-month="-1" aria-label="Previous month">‹</button><button type="button" data-month="1" aria-label="Next month">›</button></div>`;
  let cal = ROWS.map(r => `<span class="cal-h">${r[0]}</span>`).join('') + '<span class="cal-h">Wk</span>';
  let selDay = null;
  m.weeks.forEach(w => {
    w.days.forEach(d => {
      const mins = d.minutes, bin = !mins ? 0 : mins < 30 ? 1 : mins < 60 ? 2 : mins < 90 ? 3 : mins < 120 ? 4 : 5;
      const dots = d.acts.slice(0, 3).map(a => `<i style="background:${(SPORT[a.sport] || SPORT.other)[1]}"></i>`).join('') + (d.acts.length > 3 ? `<b>+${d.acts.length - 3}</b>` : '');
      const tip = d.future ? `${fmtDay(d.date)}: still ahead` : !d.synced && !d.acts.length ? `${fmtDay(d.date)}: not synced` : d.acts.length ? `${fmtDay(d.date)}: ${d.acts.map(a => a.name).join(', ')} (${dur(mins)})` : `${fmtDay(d.date)}: rest`;
      const cls = ['cal-d', 'b' + bin, d.in_month ? '' : 'out', d.future ? 'fut' : '', d.date === sel ? 'sel' : '', d.date === m.today ? 'today' : ''].join(' ');
      cal += `<button type="button" class="${cls}" data-day="${d.date}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span>${fromKey(d.date).getDate()}</span><em>${dots}</em></button>`;
      if (d.date === sel) selDay = d;
    });
    cal += `<span class="cal-w" data-tip="${esc(`Week of ${shortDate(w.start)}: ${dur(w.minutes)}`)}">${w.minutes ? (w.minutes / 60).toFixed(1) + 'h' : '–'}</span>`;
  });
  const ramp = `<div class="ramp"><span>Less</span>${[1, 2, 3, 4, 5].map(b => `<i style="background:var(--q${b})"></i>`).join('')}<span>2h+ a day</span></div>`;
  return appHead(mName, `${year} · training log`, nav) + switcher('month') + banner(h.sync) + callCard(h.call, h.next, true)
    + `<section class="acard"><div class="cal">${cal}</div>${ramp}</section>` + (selDay ? dayCard(selDay) : '');
}

function dayCard(d) {
  let body;
  if (d.future) body = '<p class="note">Nothing logged yet.</p>';
  else if (!d.synced && !d.acts.length) body = '<p class="note">No data for this day.</p>';
  else body = (d.acts.length ? `<div class="acts">${d.acts.map(a => `<div class="act">${sportChip(a.sport)}<div><b>${esc(a.name)}</b><small>${hhmm(a.start_h)} · ${dur(a.minutes)}${distLabel(a)}</small></div><span class="k">${nf(a.kcal)} kcal</span></div>`).join('')}</div>` : '<p class="note">Rest day.</p>')
    + `<div class="legend" style="justify-content:space-between"><span>${d.total_kcal != null ? nf(d.total_kcal) + ' kcal total' : ''}</span><span>${d.steps != null ? nf(d.steps) + ' steps' : ''}</span><span>${d.sleep_score != null ? 'Sleep ' + esc(d.sleep_score) : ''}</span></div>`;
  return acard(fmtDay(d.date), d.acts.length ? `${d.acts.length} session${d.acts.length > 1 ? 's' : ''}` : '', body);
}

// ---------- Home: Insights ----------
export function homeInsights(ins, h, ui) {
  const head = appHead('Insights', 'From your last 12 weeks', syncChip(h.sync, h.now, ui.fake)) + switcher('insights') + banner(h.sync);
  if (!ins.enough) return head + emptyCard('Insights need a couple of weeks of data', 'Once Zona has ten sessions it looks for patterns: when you train, how calories trend, how late sessions affect your sleep, and where your HRV sits.');
  const sh = ins.start_hours, peak = sh.peak_hour - sh.first_hour;
  const hcats = sh.hours.map((v, i) => ({ label: (i + sh.first_hour) % 3 === 0 ? String(i + sh.first_hour).padStart(2, '0') : '', segs: [v],
    colors: [i === peak ? 'var(--accent)' : 'var(--q-mute)'], tip: `${hhmm(i + sh.first_hour)} to ${hhmm(i + sh.first_hour + 1)}: ${v} session${v === 1 ? '' : 's'}` }));
  let out = head + acard(`Most sessions start around ${hhmm(sh.peak_hour)}`, '', `<p class="lead">${sh.share}% of your ${sh.sessions} sessions started between ${hhmm(sh.peak_hour)} and ${hhmm(sh.peak_hour + 1)}.</p>` + vBars({ cats: hcats, h: 100, pl: 22, aria: 'Sessions by start hour' }));
  const wk = ins.weekly_kcal, ws = wk.weeks, yt = ticksFor(Math.max(...ws.map(x => x.kcal), 1) * 1.08, 3);
  out += acard(`Active calories ${wk.pct >= 0 ? 'up' : 'down'} ${Math.abs(wk.pct)}%`, 'weekly', `<p class="lead">Week of ${shortDate(ws[7].start)}: ${nf(ws[7].kcal)} kcal, against a ${nf(wk.avg_before)} average over the four weeks before.</p>` +
    lines({ x0: 0, x1: 7, y0: 0, y1: yt[yt.length - 1], yt, yfmt: v => v ? (v / 1000) + 'k' : '0', h: 104, xt: [{ v: 0, label: shortDate(ws[0].start) }, { v: 7, label: shortDate(ws[7].start) }],
      series: [{ pts: ws.map((x, i) => [i, x.kcal]), color: 'var(--accent)', end: true }],
      hits: ws.map((x, i) => ({ a: Math.max(0, i - 0.5), b: Math.min(7, i + 0.5), tip: `Week of ${shortDate(x.start)}: ${nf(x.kcal)} active kcal` })), aria: 'Weekly active calories' }));
  const ls = ins.late_sleep;
  if (ls.late_avg != null && ls.other_avg != null) {
    const diff = ls.other_avg - ls.late_avg;
    out += acard(diff > 1 ? `Late sessions cost you ${diff} sleep points` : "Late sessions don't hurt your sleep", '', '<p class="lead">Nights after a session that started at 19:00 or later, against all other nights.</p>' +
      hBars({ max: 100, aria: 'Sleep score after late sessions', rows: [
        { label: 'After 19:00', v: ls.late_avg, color: 'var(--accent)', valueLabel: ls.late_avg, tip: `${ls.late_nights} nights after a late session: average ${ls.late_avg}` },
        { label: 'Other nights', v: ls.other_avg, color: 'var(--q-mute)', valueLabel: ls.other_avg, tip: `${ls.other_nights} other nights: average ${ls.other_avg}` }] }));
  }
  const hv = ins.hrv;
  if (hv && hv.points.length > 1) {
    const vals = hv.points.map(p => p.ms), y0 = Math.floor(Math.min(...vals, hv.low) / 10) * 10, y1 = Math.ceil(Math.max(...vals, hv.high) / 10) * 10;
    const yts = []; for (let v = y0; v <= y1; v += 10) yts.push(v);
    const n = hv.points.length - 1;
    out += acard(`HRV is ${hv.status}`, 'overnight, ms', `<p class="lead">7-day average ${Math.round(hv.week)} ms. The band is your usual range.</p>` +
      lines({ x0: 0, x1: n, y0, y1, yt: yts, h: 108, band: [hv.low, hv.high], xt: [{ v: 0, label: shortDate(hv.points[0].date) }, { v: n, label: shortDate(hv.points[n].date) }],
        series: [{ pts: hv.points.map((p, i) => [i, p.ms]), color: 'var(--accent)', end: true }],
        hits: hv.points.map((p, i) => ({ a: Math.max(0, i - 0.5), b: Math.min(n, i + 0.5), tip: `${fmtDay(p.date)}: ${Math.round(p.ms)} ms` })), aria: 'Overnight HRV, last 28 days' }));
  }
  return out;
}

// ---------- Trends ----------
export function trends(t, ui) {
  const n = t.weeks.length;
  let h = appHead('Trends', `Last ${n} weeks`, `<div class="seg" style="width:104px">${segBtn('range', 4, '4W', n)}${segBtn('range', 12, '12W', n)}</div>`);
  const used = SPORT_ORDER.filter(s => t.weeks.some(w => w.minutes[s]));
  const cats = t.weeks.map((w, i) => ({ label: n === 4 || i % 3 === 0 ? shortDate(w.start) : '', hl: i === n - 1, segs: used.map(s => w.minutes[s] / 60),
    tip: `Week of ${shortDate(w.start)}${i === n - 1 ? ' (so far)' : ''}: ` + (used.filter(s => w.minutes[s]).map(s => `${SPORT[s][0]} ${dur(w.minutes[s])}`).join(', ') || 'nothing logged') }));
  if (!used.length) return h + emptyCard('Charts fill in after the first sync', 'Zona backfills 180 days of activities and 12 weeks of daily data the first time it reaches Garmin.');
  h += acard('Training time per week', 'hours', vBars({ cats, colors: used.map(s => SPORT[s][1]), fmt: v => v + 'h', h: 150, aria: 'Training hours per week by sport' }) +
    `<div class="legend">${used.map(s => `<span><i style="background:${SPORT[s][1]}"></i>${SPORT[s][0]} ${(sum(t.weeks, w => w.minutes[s]) / 60).toFixed(1)}h</span>`).join('')}</div>`);
  let best = [0, 0]; t.heat.forEach((r, ri) => r.forEach((v, ci) => { if (v > t.heat[best[0]][best[1]]) best = [ri, ci]; }));
  h += acard('When you train', 'session starts', `<p class="lead">Busiest slot: ${ROWS[best[0]]} around ${hhmm(best[1] + t.first_hour)}.</p>` +
    heat({ rows: ROWS, cols: Array.from({ length: 18 }, (_, i) => i + t.first_hour), vals: t.heat, aria: 'Session starts by weekday and hour' }) +
    `<div class="ramp"><span>Fewer</span>${[1, 2, 3, 4, 5].map(b => `<i style="background:var(--q${b})"></i>`).join('')}<span>More</span></div>`);
  const ccats = t.kcal.map((d, i) => ({ label: i % 7 === 0 ? shortDate(d.date) : '', segs: [d.resting || 0, d.active || 0],
    tip: d.active != null ? `${fmtDay(d.date)}${i === 27 ? ' so far' : ''}: ${nf((d.resting || 0) + d.active)} kcal (${nf(d.active)} active)` : `${fmtDay(d.date)}: not synced` }));
  const have = t.kcal.slice(0, -1).filter(d => d.active != null);
  h += acard('Calories per day', 'last 4 weeks', vBars({ cats: ccats, colors: ['var(--cal-rest)', 'var(--cal-act)'], h: 136, aria: 'Calories per day, resting and active' }) +
    `<div class="legend"><span><i style="background:var(--cal-rest)"></i>Resting</span><span><i style="background:var(--cal-act)"></i>Active, ${nf(sum(have, d => d.active) / Math.max(1, have.length))} a day on average</span></div>`);
  const zt = t.zones, ztot = Math.max(1, sum(zt, x => x));
  if (ztot > 1) h += acard('Time in heart-rate zones', `last ${n} weeks`, hBars({ max: Math.max(...zt), aria: 'Time in heart-rate zones', rows: zt.map((v, i) => ({ label: `Z${i + 1} ${ZNAME[i]}`, v, color: ZC[i], valueLabel: dur(v), tip: `Z${i + 1} ${ZNAME[i]}: ${dur(v)} (${Math.round(v / ztot * 100)}%)` })) }));
  const sl = t.sleep;
  if (sl.length > 1) h += acard('Sleep score', 'last 4 weeks', lines({ x0: 0, x1: sl.length - 1, y0: 40, y1: 100, yt: [40, 70, 100], h: 100,
    xt: [{ v: 0, label: shortDate(sl[0].date) }, { v: sl.length - 1, label: shortDate(sl[sl.length - 1].date) }],
    series: [{ pts: sl.map((d, i) => [i, d.score]), color: 'var(--accent)', end: true, endLabel: sl[sl.length - 1].score }],
    hits: sl.map((d, i) => ({ a: Math.max(0, i - 0.5), b: Math.min(sl.length - 1, i + 0.5), tip: `${fmtDay(d.date)}: score ${d.score}${d.minutes ? ', ' + dur(d.minutes) : ''}` })), aria: 'Sleep score, last 28 days' }));
  return h;
}

// ---------- Water ----------
export function water(w, s, ui) {
  const left = Math.max(0, w.goal - w.intake);
  let h = appHead('Water', fmtDay(ui.date)) + (ui.nudge ? nudgeCard(ui.nudge, ui.nudgeLogged) : '');
  h += acard('Today', left ? `${L(left)} to go` : 'goal reached', `<div class="big"><span class="num">${(w.intake / 1000).toFixed(2)}</span><span class="unit">of ${L(w.goal)}</span></div>
    <div class="meter" style="height:8px;border-radius:4px"><i style="width:${f(Math.min(100, w.intake / w.goal * 100))}%"></i></div>
    <div class="btnrow"><button class="btn ghost" type="button" data-log="250">+250 ml</button><button class="btn ghost" type="button" data-log="500">+500 ml</button></div>
    ${w.logs.length ? `<ul class="slist">${w.logs.slice().reverse().map(x => `<li><span>${hhmm(x.h)} · ${nf(x.ml)} ml${x.source === 'nudge' ? ' · from a nudge' : ''}</span><button type="button" data-unlog="${esc(x.id)}" aria-label="Remove ${nf(x.ml)} ml at ${hhmm(x.h)}">Remove</button></li>`).join('')}</ul>` : ''}`);
  const stepper = (k, by, label) => `<div class="stepper"><button type="button" data-step="${k}" data-by="${-by}" aria-label="Less">−</button><output>${esc(label)}</output><button type="button" data-step="${k}" data-by="${by}" aria-label="More">+</button></div>`;
  const list = w.sessions.length
    ? `<ul class="slist">${w.sessions.map(x => `<li><span>${esc(x.name)} · ${hhmm(x.start_h)}</span><span>+${nf(x.ml)} ml · ${x.done ? `synced ${hhmm(x.synced_h || 0)}` : 'planned'}</span></li>`).join('')}</ul>`
    : '<p class="note">No sport synced yet today, so the goal is your base.</p>';
  h += acard('Daily goal', 'your rule', `<div class="set">
    <div class="set-r"><span>Base per day</span>${stepper('base', 250, L(s.base))}</div>
    <div class="set-r"><span>Per hour of sport</span>${stepper('per_hour', 50, s.per_hour + ' ml')}</div>
    <div class="set-r"><span>Count planned sessions early</span>${sw('count_planned', s.count_planned, 'Count planned sessions in the goal from the morning')}</div></div>${list}
    <div class="formula">${L(s.base)}${w.sessions.map(x => ` + ${nf(x.ml)} ml`).join('')} = <b>${L(w.goal)}</b></div>
    <p class="note">${s.count_planned ? 'Planned sessions count from the morning, and each one switches to its real length once it syncs.' : 'Starts at your base. Each session adds its hours × your amount per hour, rounded to 50 ml, once it syncs from Garmin.'}</p>`);
  h += acard('After a workout', s.nudge ? 'nudge on' : 'nudge off', `<div class="set">
    <div class="set-r"><span>Nudge me to drink</span>${sw('nudge', s.nudge, 'Nudge me to drink after a workout')}</div>
    <div class="set-r"><span>Check Garmin</span><div class="seg">${segBtn('poll', 5, 'After plans · 5 min', s.poll)}${segBtn('poll', 15, 'All day · 15 min', s.poll)}</div></div>
    <div class="set-r"><span>Skip sessions under</span><span class="v">20 min</span></div></div>
    <p class="note">Garmin doesn't tell Zona when a workout arrives, so the server checks. ${s.poll === 5 ? 'Every 5 minutes for 3 hours after a planned session starts, every 30 minutes otherwise.' : 'Every 15 minutes, all day.'}</p>
    ${ui.fake ? '<button class="btn quiet" type="button" data-act="fake-run">Sample data: finish a 47-min run now</button>' : ''}`);
  const logs = w.logs.slice().sort((a, b) => a.h - b.h), pts = [[7, 0]];
  let acc = 0; logs.forEach(x => { pts.push([x.h, acc]); acc += x.ml; pts.push([x.h, acc]); }); pts.push([Math.max(7, ui.nowH), acc]);
  const goalAt = t => { let g = w.goal_steps[0][1]; w.goal_steps.forEach(([gh, gv]) => { if (gh <= t) g = gv; }); return g; };
  const yt = ticksFor(Math.max(w.goal, acc) * 1.04, 3), hits = [];
  for (let t = 7; t < 22; t++) hits.push({ a: t, b: t + 1, tip: t + 1 > ui.nowH + 1 ? `${hhmm(t)}: still ahead` : `${hhmm(t + 1)}: ${L(sum(logs.filter(x => x.h <= t + 1), x => x.ml))} drunk, goal ${L(goalAt(t + 1))}` });
  h += acard('Intake through the day', '', lines({ x0: 7, x1: 22, y0: 0, y1: yt[yt.length - 1], yt, yfmt: v => (v / 1000) + ' L', h: 124, now: ui.nowH >= 7 && ui.nowH <= 22 ? ui.nowH : null,
    xt: [{ v: 7, label: '07' }, { v: 12, label: '12' }, { v: 17, label: '17' }, { v: 22, label: '22' }],
    series: [{ pts: w.goal_steps, color: 'var(--ink-2)', dash: true }, { pts, color: 'var(--accent)', end: true }], hits, aria: 'Water intake against a goal that rises as workouts sync' }) +
    '<div class="legend"><span><i style="background:var(--accent)"></i>You</span><span><i class="dash"></i>Goal, steps up as workouts sync</span></div>');
  h += acard('Reminders', s.remind_every ? `every ${s.remind_every} min` : 'off', `<div class="set">
    <div class="set-r"><span>Remind every</span><div class="seg">${segBtn('every', 0, 'Off', s.remind_every)}${segBtn('every', 45, '45 min', s.remind_every)}${segBtn('every', 60, '1 h', s.remind_every)}${segBtn('every', 90, '1.5 h', s.remind_every)}</div></div>
    <div class="set-r"><span>Active hours</span><span class="v">${String(s.active_from).padStart(2, '0')}:00 – ${String(s.active_to).padStart(2, '0')}:00</span></div>
    <div class="set-r"><span>Pause during planned sessions</span>${sw('pause_in_workouts', s.pause_in_workouts, 'Pause reminders during planned sessions')}</div>
    <div class="set-r"><span>Morning call notification</span>${sw('call_push', s.call_push, "Send today's call as a morning notification")}</div></div>
    <p class="note">Reminders skip once you reach the goal. Your watch mirrors them from the iPhone, where you can read and dismiss them.</p>`);
  return h;
}

// ---------- Train: the week plan, plus app settings ----------
export function train(plan, me, sync, ui) {
  const byDay = ROWS.map((r, i) => plan.filter(p => p.weekday === i));
  let h = appHead('Train', 'Your week plan');
  h += acard('Every week', `${plan.length} session${plan.length === 1 ? '' : 's'}`, plan.length
    ? byDay.map((items, i) => items.length ? `<div class="dayhead">${ROWS[i]}</div><div class="acts">${items.map(p => `<div class="act">${sportChip(p.sport)}<div><b>${esc(p.name)}</b><small>${hhmm(p.start_h)} · ${dur(p.minutes)}</small></div><button class="btn quiet" type="button" data-plan-del="${esc(p.id)}" aria-label="Remove ${esc(p.name)} on ${ROWS[i]}">Remove</button></div>`).join('')}</div>` : '').join('')
    : '<p class="note">Add the sessions you usually do. Zona uses them for the daily call ("Go ahead with your run"), for checking Garmin more often right after a session, and for holding one nudge for back-to-back sessions.</p>');
  const opt = (v, l) => `<option value="${v}">${l}</option>`;
  h += `<section class="acard"><header><h4>Add a session</h4></header><form class="form" id="planForm">
    <label>Day<select class="field" name="weekday">${ROWS.map((r, i) => opt(i, r)).join('')}</select></label>
    <label>Starts<input class="field" name="start" type="time" value="07:00" required></label>
    <label>Sport<select class="field" name="sport">${SPORT_ORDER.map(s => opt(s, SPORT[s][0])).join('')}</select></label>
    <label>Minutes<input class="field" name="minutes" type="number" min="5" max="600" value="45" required></label>
    <label class="wide">Name<input class="field" name="name" maxlength="60" value="Easy run" required></label>
    <button class="btn" type="submit" style="grid-column:1/-1">Add to the week</button></form>
    <p class="note">Building workouts and sending them to your watch comes in the next version.</p></section>`;
  const pushState = !me.push.enabled ? '<p class="note">Push isn\'t configured on the server yet (ZONA_VAPID_* settings).</p>'
    : ui.pushBlocked ? `<p class="note">${esc(ui.pushBlocked)}</p>`
      : `<div class="btnrow"><button class="btn" type="button" data-act="push-on">${me.devices ? 'Re-register this iPhone' : 'Turn on notifications'}</button><button class="btn ghost" type="button" data-act="push-test"${me.devices ? '' : ' disabled'}>Send a test</button></div>
        <button class="btn ghost" type="button" data-act="push-test-later"${me.devices ? '' : ' disabled'}>Test the watch: send in 10 s, then lock the phone</button>
        <p class="note">${me.devices} device${me.devices === 1 ? '' : 's'} registered.</p>`;
  h += acard('Zona', me.fake ? 'sample data' : 'your Garmin', `<div class="set">
    <div class="set-r"><span>Garmin sync</span><span class="v">${esc(sync.status === 'ok' ? 'working' : sync.status === 'key' ? 'key refused' : sync.status === 'error' ? 'last try failed' : 'not yet')}</span></div></div>
    <button class="btn quiet" type="button" data-act="sync">Sync now</button>${pushState}
    ${ui.msg ? `<p class="note" role="status">${esc(ui.msg)}</p>` : ''}
    <a class="btn quiet" href="/api/garmin-shapes" target="_blank" rel="noopener">Garmin data shapes (field names, no values)</a>
    <button class="btn quiet" type="button" data-act="logout">Sign out on every device</button>`);
  return h;
}

export function login(err) {
  return `<section class="acard login"><h1>Zona</h1><p class="lead">Your training, sleep and water, from Garmin.</p>
    <form id="loginForm" class="set"><input class="field" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required>
    <button class="btn" type="submit" style="margin-top:10px">Sign in</button></form>${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}</section>`;
}

export const loading = () => '<p class="note" role="status" style="padding:40px 0;text-align:center">Loading…</p>';
export const failed = msg => `<section class="acard">${WARN.replace('<svg', '<svg width="20" height="20" style="fill:none;stroke:var(--warn-ink);stroke-width:2"')}<h4>Couldn't load this</h4><p class="note">${esc(msg)}</p><button class="btn quiet" type="button" data-act="reload">Try again</button></section>`;
