// SVG chart helpers and formatters. Every value that reaches markup goes through esc().

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const f = n => +(+n).toFixed(1);
export const nf = n => Math.round(n).toLocaleString('en-US');
export const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
export const L = ml => (ml / 1000).toFixed(2) + ' L';
export const hhmm = h => { const m = Math.round(h * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
export const dur = min => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtDay = k => { const d = fromKey(k); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
export const shortDate = k => { const d = fromKey(k); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const monthName = ym => { const [y, m] = ym.split('-').map(Number); return [['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1], String(y)]; };

const svgOpen = (w, h, aria) => `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">`;
const rectPath = (x, y, w, h) => `M${f(x)},${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`;
function topRound(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${f(x)},${f(y + h)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h)}Z`;
}
function rightRound(x, y, w, h, r) {
  r = Math.min(r, h / 2, w);
  return `M${f(x)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h - r)}Q${f(x + w)},${f(y + h)} ${f(x + w - r)},${f(y + h)}H${f(x)}Z`;
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), q = raw / p; return (q <= 1 ? 1 : q <= 2 ? 2 : q <= 2.5 ? 2.5 : q <= 5 ? 5 : 10) * p; }
export function ticksFor(max, count = 3) {
  const st = niceStep(Math.max(max, 1e-6) / count), top = Math.ceil(max / st) * st || st, t = [];
  for (let v = 0; v <= top + 1e-9; v += st) t.push(+v.toFixed(6));
  return t;
}

// stacked vertical bars: cats = [{ label, hl, segs: [n…], colors?, tip }]
export function vBars(o) {
  const w = 300, h = o.h || 140, pl = o.pl || 32, pr = 4, pt = 8, pb = 18, iw = w - pl - pr, ih = h - pt - pb;
  const totals = o.cats.map(c => c.segs.reduce((a, b) => a + (b || 0), 0));
  const tk = ticksFor(Math.max(o.minMax || 0, ...totals), 3), top = tk[tk.length - 1];
  const Y = v => pt + ih - v / top * ih;
  const n = o.cats.length, bw = iw / n, gap = Math.max(2, Math.min(8, bw * 0.3)), bi = bw - gap;
  let s = svgOpen(w, h, o.aria);
  tk.forEach((t, i) => { s += `<line x1="${pl}" x2="${w - pr}" y1="${f(Y(t))}" y2="${f(Y(t))}" class="${i ? 'grid' : 'axis'}"/><text x="${pl - 6}" y="${f(Y(t) + 3)}" text-anchor="end">${o.fmt ? o.fmt(t) : nf(t)}</text>`; });
  o.cats.forEach((c, i) => {
    const x = pl + i * bw + gap / 2;
    let last = -1, acc = 0;
    c.segs.forEach((v, j) => { if (v > 0) last = j; });
    c.segs.forEach((v, j) => {
      if (!(v > 0)) return;
      const yTop = Y(acc + v), hh = Y(acc) - yTop - (acc > 0 ? 2 : 0);
      acc += v;
      if (hh < 0.6) return;
      s += `<path d="${j === last ? topRound(x, yTop, bi, hh, 4) : rectPath(x, yTop, bi, hh)}" style="fill:${(c.colors || o.colors)[j]}"/>`;
    });
    if (c.label) s += `<text x="${f(i === 0 ? x : x + bi / 2)}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : 'middle'}"${c.hl ? ' class="hl"' : ''}>${esc(c.label)}</text>`;
    s += `<rect x="${f(pl + i * bw)}" y="${pt}" width="${f(bw)}" height="${ih}" style="fill:transparent" data-tip="${esc(c.tip)}"/>`;
  });
  return s + '</svg>';
}

export function hBars(o) {
  const w = 300, rh = 20, g = 6, pl = o.pl || 84, pr = 52, iw = w - pl - pr, h = o.rows.length * (rh + g) - g;
  let s = svgOpen(w, h, o.aria);
  o.rows.forEach((r, i) => {
    const y = i * (rh + g), bw = r.v > 0 ? Math.max(2, r.v / Math.max(o.max, 1) * iw) : 0;
    s += `<text x="0" y="${y + 13.5}" class="lbl">${esc(r.label)}</text>`;
    if (bw) s += `<path d="${rightRound(pl, y + 3, bw, rh - 6, 4)}" style="fill:${r.color}"/>`;
    s += `<text x="${f(pl + bw + 6)}" y="${y + 13.5}" class="val">${esc(r.valueLabel)}</text>`;
    s += `<rect x="0" y="${y}" width="${w}" height="${rh + g}" style="fill:transparent" data-tip="${esc(r.tip)}"/>`;
  });
  return s + '</svg>';
}

export function heat(o) {
  const w = 300, pl = 28, pb = 14, cw = (w - pl) / o.cols.length, ch = 16, h = o.rows.length * ch + pb;
  const max = Math.max(1, ...o.vals.flat());
  let s = svgOpen(w, h, o.aria);
  o.rows.forEach((rl, r) => {
    s += `<text x="0" y="${f(r * ch + ch / 2 + 2)}" class="lbl" style="font-size:8.5px">${rl}</text>`;
    o.cols.forEach((cl, c) => {
      const v = o.vals[r][c], bin = v ? Math.min(5, Math.ceil(v / max * 5)) : 0;
      s += `<rect x="${f(pl + c * cw)}" y="${f(r * ch)}" width="${f(cw - 2)}" height="${ch - 2}" rx="2" style="fill:${bin ? `var(--q${bin})` : 'var(--surface-2)'}" data-tip="${esc(`${rl} ${hhmm(cl)}: ${v} session${v === 1 ? '' : 's'}`)}"/>`;
    });
  });
  o.cols.forEach((cl, c) => { if (cl % 3 === 0) s += `<text x="${f(pl + c * cw + (cw - 2) / 2)}" y="${h - 3}" text-anchor="middle">${String(cl).padStart(2, '0')}</text>`; });
  return s + '</svg>';
}

export function lines(o) {
  const w = 300, h = o.h || 120, pl = 32, pr = 12, pt = 8, pb = 18, iw = w - pl - pr, ih = h - pt - pb;
  const X = v => pl + (v - o.x0) / (o.x1 - o.x0 || 1) * iw, Y = v => pt + ih - (v - o.y0) / (o.y1 - o.y0) * ih;
  let s = svgOpen(w, h, o.aria);
  if (o.band) s += `<rect x="${pl}" y="${f(Y(o.band[1]))}" width="${iw}" height="${f(Y(o.band[0]) - Y(o.band[1]))}" style="fill:var(--band)"/>`;
  o.yt.forEach((t, i) => { s += `<line x1="${pl}" x2="${w - pr}" y1="${f(Y(t))}" y2="${f(Y(t))}" class="${i ? 'grid' : 'axis'}"/><text x="${pl - 6}" y="${f(Y(t) + 3)}" text-anchor="end">${o.yfmt ? o.yfmt(t) : t}</text>`; });
  (o.xt || []).forEach((t, i, all) => { s += `<text x="${f(X(t.v))}" y="${h - 5}" text-anchor="${i === 0 ? 'start' : i === all.length - 1 && all.length > 2 ? 'end' : 'middle'}">${esc(t.label)}</text>`; });
  if (o.now != null) s += `<line x1="${f(X(o.now))}" x2="${f(X(o.now))}" y1="${pt}" y2="${pt + ih}" class="nowline"/><text x="${f(X(o.now) + 3)}" y="${pt + 7}">now</text>`;
  o.series.forEach(se => {
    if (!se.pts.length) return;
    const d = se.pts.map((p, i) => `${i ? 'L' : 'M'}${f(X(p[0]))},${f(Y(p[1]))}`).join('');
    s += `<path d="${d}" style="fill:none;stroke:${se.color};stroke-width:2;stroke-linejoin:round;stroke-linecap:round;${se.dash ? 'stroke-dasharray:4 3;' : ''}"/>`;
    if (se.end) {
      const p = se.pts[se.pts.length - 1];
      s += `<circle cx="${f(X(p[0]))}" cy="${f(Y(p[1]))}" r="4" style="fill:${se.color};stroke:var(--surface);stroke-width:2"/>`;
      if (se.endLabel != null) s += `<text x="${f(X(p[0]) - 6)}" y="${f(Y(p[1]) - 7)}" text-anchor="end" class="end">${esc(se.endLabel)}</text>`;
    }
  });
  (o.hits || []).forEach(hh => { s += `<rect x="${f(X(hh.a))}" y="${pt}" width="${f(Math.max(1, X(hh.b) - X(hh.a)))}" height="${ih}" style="fill:transparent" data-tip="${esc(hh.tip)}"/>`; });
  return s + '</svg>';
}

// the morning Body Battery on the four-step call scale
export function bbGauge(value) {
  const bb = Math.max(0, Math.min(100, Math.round(+value) || 0)), w = 300, X = v => v / 100 * w;
  const segs = [[0, 30, 'var(--critical)', 'Rest'], [30, 50, 'var(--serious)', 'Go light'], [50, 70, 'var(--warning)', 'Go easy'], [70, 100, 'var(--good)', 'Go']];
  let s = svgOpen(w, 40, `Body Battery ${bb} on the daily call scale`);
  segs.forEach(([a, b, col, lab], i) => {
    s += `<rect x="${f(X(a) + (i ? 1 : 0))}" y="13" width="${f(X(b) - X(a) - (i ? 1 : 0) - (i < 3 ? 1 : 0))}" height="8" rx="2" style="fill:${col};fill-opacity:.45" data-tip="${esc(`Body Battery ${a} to ${b === 100 ? 100 : b - 1}: ${lab}`)}"/>`;
  });
  const x = X(bb);
  s += `<line x1="${f(x)}" x2="${f(x)}" y1="10" y2="24" style="stroke:var(--ink);stroke-width:2;stroke-linecap:round"/><text x="${f(Math.min(w - 8, Math.max(8, x)))}" y="7" text-anchor="middle" class="end">${bb}</text>`;
  [0, 30, 50, 70, 100].forEach((t, i) => { s += `<text x="${f(X(t))}" y="36" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${t}</text>`; });
  return s + '</svg>';
}
