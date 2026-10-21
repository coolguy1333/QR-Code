// Small DOM + UI toolkit. No framework, no innerHTML for user data.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') value = v;
    else if (k === 'html') el.innerHTML = v; // trusted strings only (our own SVG)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...kids) => { clear(el); append(el, kids); return el; };

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export function debounce(fn, ms = 100) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// ---------- toasts / dialogs ----------
export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
}

export function dialog({ title, body, actions, wide = false, onClose }) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); onClose?.(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(undefined); };
    const box = h('div', { class: `dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', {}, title), body, actions ? h('div', { class: 'actions' }, actions(close)) : null);
    const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(undefined); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    (box.querySelector('input,textarea,select,button.primary') || box).focus?.();
  });
}

export const confirmDialog = (message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) =>
  dialog({
    title, body: h('p', {}, message),
    actions: close => [h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'), h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, ok)],
  }).then(v => !!v);

export function promptDialog({ title, label, value = '', ok = 'Save', type = 'text', hint = '' }) {
  const input = h('input', { class: 'input', type, value });
  const body = h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  return dialog({
    title, body,
    actions: close => [h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => close(input.value) }, ok)],
  }).then(v => v ?? null);
}

// ---------- formatting ----------
export const fmtNum = n => new Intl.NumberFormat().format(n ?? 0);
export const fmtDate = ts => ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
export const fmtDateTime = ts => ts ? new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}
export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(ts);
}
let regionNames;
export function countryName(code) {
  if (!code || code === 'Unknown') return 'Unknown';
  try { regionNames ||= new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }); return regionNames.of(code) || code; } catch { return code; }
}
export const flag = code => (/^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) : '🌐');

export async function copyText(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(msg, 'good'); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(msg, 'good'); } catch { toast('Copy failed — select and copy manually.', 'bad'); }
    ta.remove();
  }
}

// ---------- charts ----------
export function lineChart(series, { height = 180, key = 'scans', key2 = 'unique' } = {}) {
  const W = 640, H = height, pl = 34, pr = 8, pt = 10, pb = 22;
  const max = Math.max(1, ...series.map(s => s[key]));
  const nice = Math.max(4, Math.ceil(max / 4) * 4);
  const x = i => pl + (i * (W - pl - pr)) / Math.max(1, series.length - 1);
  const y = v => pt + (1 - v / nice) * (H - pt - pb);
  const path = k => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[k]).toFixed(1)}`).join('');
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Scans over time' });
  const grid = svg('g', { class: 'grid' });
  for (let i = 0; i <= 4; i++) {
    const v = (nice * i) / 4;
    grid.append(svg('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v) }), svg('text', { x: pl - 5, y: y(v) + 3, 'text-anchor': 'end' }, fmtNum(Math.round(v))));
  }
  g.append(grid);
  const step = Math.max(1, Math.ceil(series.length / 7));
  series.forEach((s, i) => { if (i % step === 0 || i === series.length - 1) g.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle' }, s.d.slice(5))); });
  const area = `${path(key)}L${x(series.length - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
  g.append(svg('path', { d: area, fill: 'var(--accent)', opacity: '.12' }));
  g.append(svg('path', { d: path(key), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
  if (key2) g.append(svg('path', { d: path(key2), fill: 'none', stroke: 'var(--good)', 'stroke-width': 1.6, 'stroke-dasharray': '4 3' }));
  series.forEach((s, i) => g.append(svg('circle', { cx: x(i), cy: y(s[key]), r: series.length > 45 ? 6 : 9, fill: 'transparent' }, svg('title', {}, `${s.d}: ${s[key]} scans${key2 ? `, ${s[key2]} unique` : ''}`))));
  return g;
}

export function hourChart(hours) {
  const W = 640, H = 120, max = Math.max(1, ...hours), bw = W / 24;
  const g = svg('svg', { viewBox: `0 0 ${W} ${H + 20}`, class: 'chart', role: 'img', 'aria-label': 'Scans by hour of day' });
  hours.forEach((n, i) => {
    const bh = (n / max) * (H - 8);
    g.append(svg('rect', { x: i * bw + 2, y: H - bh, width: bw - 4, height: Math.max(bh, n ? 2 : 0), rx: 2, fill: 'var(--accent)', opacity: n ? '.85' : '.2' }, svg('title', {}, `${String(i).padStart(2, '0')}:00 — ${n} scans`)));
    if (i % 3 === 0) g.append(svg('text', { x: i * bw + bw / 2, y: H + 14, 'text-anchor': 'middle', 'font-size': 14 }, String(i).padStart(2, '0')));
  });
  return g;
}

export function barList(items, { label = x => x.k, empty = 'No data yet' } = {}) {
  if (!items?.length) return h('p', { class: 'muted' }, empty);
  const max = Math.max(...items.map(i => i.n));
  return h('ul', { class: 'barlist' }, items.map(i => h('li', {}, h('span', {}, label(i)), h('b', {}, fmtNum(i.n)), h('div', { class: 'bar' }, h('i', { style: { width: `${(i.n / max) * 100}%` } })))));
}

export const icon = {
  qr: '▦', link: '🔗', text: '📝', mail: '✉️', phone: '📞', sms: '💬', user: '👤', wifi: '📶', pin: '📍', cal: '📅', app: '📱', share: '🌐', pay: '💳', file: '📄', page: '🖼️', bio: '🧑‍🎤',
};
