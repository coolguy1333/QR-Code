import { h, toast, icon, copyText } from '../ui.js';
import { TYPES } from '../qr-content.js';
import { FORMATS, SIZE_PRESETS, exportBlob, saveBlob, safeName, copyPNG } from '../export.js';
import { api, state } from '../app.js';

export const TYPE_ICON = { url: icon.link, text: icon.text, email: icon.mail, phone: icon.phone, sms: icon.sms, vcard: icon.user, wifi: icon.wifi, geo: icon.pin, event: icon.cal, app: icon.app, social: icon.share, payment: icon.pay, pdf: icon.file, landing: icon.page, bio: icon.bio };
export const typeLabel = t => TYPES[t]?.label || t;

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function select(options, value, onChange, props = {}) {
  return h('select', { class: 'input', onchange: e => onChange(e.target.value), ...props },
    options.map(o => { const [v, l] = Array.isArray(o) ? o : [o.value, o.label]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
}

export function seg(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const paint = v => [...wrap.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  for (const [v, l] of options) wrap.append(h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(String(v) === String(value)), onclick: () => { paint(v); onChange(v); } }, l));
  return wrap;
}

export function statusBadge(c) {
  if (!c.dynamic) return h('span', { class: 'badge' }, 'Static');
  if (c.status === 'blocked') return h('span', { class: 'badge bad' }, 'Blocked');
  if (c.status === 'paused') return h('span', { class: 'badge warn' }, 'Paused');
  if (c.expiresAt && c.expiresAt < Date.now()) return h('span', { class: 'badge bad' }, 'Expired');
  return h('span', { class: 'badge good' }, 'Dynamic');
}

export function pager(page, pages, go) {
  if (pages <= 1) return null;
  return h('div', { class: 'pager' },
    h('button', { class: 'btn sm', disabled: page <= 1, onclick: () => go(page - 1) }, '← Prev'),
    h('span', { class: 'muted' }, `Page ${page} of ${pages}`),
    h('button', { class: 'btn sm', disabled: page >= pages, onclick: () => go(page + 1) }, 'Next →'));
}

export function copyLine(value) {
  return h('div', { class: 'copyline' }, h('input', { class: 'input', readonly: true, value, onfocus: e => e.target.select(), 'aria-label': 'Value' }), h('button', { class: 'btn', type: 'button', onclick: () => copyText(value) }, 'Copy'));
}

const PREF = 'qr-export';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch { return {}; } };
const savePref = p => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* ignore */ } };

/** Download / copy controls. `getScene()` must return the current scene (or null when invalid). */
export function exportPanel({ getScene, getName }) {
  const pref = { format: 'png', px: 1024, mm: 50, ...loadPref() };
  const px = h('input', { class: 'input', type: 'number', min: 64, max: 4096, step: 1, value: pref.px, 'aria-label': 'Size in pixels' });
  const mm = h('input', { class: 'input', type: 'number', min: 10, max: 1000, step: 1, value: pref.mm, 'aria-label': 'Print width in millimetres' });
  const sizeSel = h('select', { class: 'input', 'aria-label': 'Size preset', onchange: e => { if (e.target.value) { px.value = e.target.value; update(); } } },
    h('option', { value: '' }, 'Custom'), SIZE_PRESETS.map(([v, l]) => h('option', { value: v, selected: Number(v) === Number(pref.px) }, l)));
  const fmtSel = h('select', { class: 'input', 'aria-label': 'File format', onchange: e => { pref.format = e.target.value; update(); } },
    FORMATS.map(([v, l]) => h('option', { value: v, selected: v === pref.format }, l)));
  const pxBox = h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Size (pixels)'), h('div', { class: 'row' }, h('div', { class: 'grow' }, sizeSel), h('div', { style: { width: '96px' } }, px)));
  const mmBox = h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Printed width (mm)'), mm, h('span', { class: 'hint' }, 'PDF and EPS are vector files: sharp at any size. This sets the default page size.'));
  const update = () => {
    pref.px = Number(px.value) || 1024; pref.mm = Number(mm.value) || 50; pref.format = fmtSel.value; savePref(pref);
    const vec = pref.format === 'pdf' || pref.format === 'eps';
    pxBox.hidden = vec; mmBox.hidden = !vec;
    copyBtn.hidden = !navigator.clipboard?.write || typeof ClipboardItem === 'undefined';
  };
  px.addEventListener('input', () => { sizeSel.value = [...sizeSel.options].some(o => o.value === px.value) ? px.value : ''; update(); });
  mm.addEventListener('input', update);
  const busy = (btn, on) => { btn.disabled = on; };
  const dl = h('button', { class: 'btn primary grow', type: 'button', onclick: async () => {
    const scene = getScene();
    if (!scene) return toast('Fix the content first — there is nothing to download yet.', 'bad');
    busy(dl, true);
    try {
      const f = fmtSel.value;
      saveBlob(await exportBlob(scene, f, { px: Number(px.value) || 1024, sizeMm: Number(mm.value) || 50 }), `${safeName(getName())}.${f}`);
    } catch (e) { toast(e.message, 'bad'); } finally { busy(dl, false); }
  } }, '⬇ Download');
  const copyBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const scene = getScene();
    if (!scene) return toast('Nothing to copy yet.', 'bad');
    try { await copyPNG(scene, Math.min(2048, Number(px.value) || 1024)); toast('Image copied to clipboard', 'good'); } catch (e) { toast(e.message, 'bad'); }
  } }, 'Copy image');
  const el = h('div', {}, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Format'), fmtSel), pxBox, mmBox, h('div', { class: 'row' }, dl, copyBtn));
  update();
  return el;
}

/** Folders, campaigns and domains for selects (logged-in only). */
export async function loadMeta() {
  if (!state.user) return { folders: [], campaigns: [], domains: [], templates: [] };
  const [f, c, d, t] = await Promise.all(['folders', 'campaigns', 'domains', 'templates'].map(x => api('GET', `/api/${x}`).then(r => r.items).catch(() => [])));
  return { folders: f, campaigns: c, domains: d.filter(x => x.verified), templates: t };
}

export const BUILTIN_STYLES = [
  { name: 'Classic', style: {} },
  { name: 'Rounded', style: { dots: 'rounded', eyeOuter: 'rounded', eyeInner: 'rounded' } },
  { name: 'Dots', style: { dots: 'dots', eyeOuter: 'circle', eyeInner: 'circle' } },
  { name: 'Ocean', style: { dots: 'rounded', eyeOuter: 'rounded', eyeInner: 'circle', fg: { type: 'linear', c1: '#0ea5e9', c2: '#1e3a8a', angle: 45 } } },
  { name: 'Sunset', style: { dots: 'dots', eyeOuter: 'circle', eyeInner: 'circle', fg: { type: 'linear', c1: '#f97316', c2: '#be123c', angle: 60 } } },
  { name: 'Forest', style: { dots: 'tiles', eyeOuter: 'rounded', eyeInner: 'rounded', fg: { type: 'solid', c1: '#14532d', c2: '#166534', angle: 0 }, bg: { type: 'solid', c1: '#f0fdf4', c2: '#dcfce7', angle: 0 } } },
  { name: 'Violet', style: { dots: 'classy-rounded', eyeOuter: 'leaf', eyeInner: 'leaf', fg: { type: 'linear', c1: '#7c3aed', c2: '#db2777', angle: 30 } } },
  { name: 'Ink', style: { dots: 'bars-v', eyeOuter: 'square', eyeInner: 'square', fg: { type: 'solid', c1: '#111827', c2: '#111827', angle: 0 } } },
];
