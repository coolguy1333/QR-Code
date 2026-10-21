import { h, mount, toast, confirmDialog, fmtDateTime, ago, countryName, flag } from '../ui.js';
import { api, qs, tzOffset, refreshMe } from '../app.js';
import { TYPES } from '../qr-content.js';
import { sceneToSVG, scanAdvice } from '../qr-render.js';
import { sceneFor } from '../qr-client.js';
import { exportPanel, statusBadge, typeLabel, copyLine, select, TYPE_ICON } from './shared.js';
import { statsPanel, RANGES } from './analytics.js';

export default async function render(root, { params }) {
  const id = Number(params[0]);
  let code = await api('GET', `/api/codes/${id}`);
  let days = 30;
  const statsBox = h('div');
  const recentBox = h('div');

  let scene = null;
  try { scene = sceneFor(code.payload, code.style); } catch { /* shown below */ }

  async function loadStats() {
    mount(statsBox, h('div', { class: 'spinner' }));
    try {
      const s = await api('GET', `/api/codes/${id}/stats${qs({ days, tz: tzOffset() })}`);
      mount(statsBox, statsPanel(s));
      const r = await api('GET', `/api/codes/${id}/recent`);
      mount(recentBox, h('div', { class: 'card' }, h('h3', {}, 'Recent scans'),
        r.items.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Where', 'Device', 'Browser', 'Referrer'].map(x => h('th', {}, x)))),
          h('tbody', {}, r.items.map(x => h('tr', {}, h('td', {}, ago(x.ts)), h('td', {}, x.country ? `${flag(x.country)} ${x.city ? x.city + ', ' : ''}${countryName(x.country)}` : '—'), h('td', {}, `${x.device} · ${x.os}`), h('td', {}, x.browser), h('td', {}, x.referrer)))))) : h('p', { class: 'muted' }, 'No scans yet. Scan the code with your phone to test it.')));
    } catch (e) { mount(statsBox, h('div', { class: 'alert bad' }, e.message)); }
  }

  function summaryRows() {
    const f = code.fields, rows = [];
    const add = (k, v) => { if (v) rows.push([k, v]); };
    for (const fd of TYPES[code.type].fields) {
      if (['image', 'links', 'file', 'checkbox', 'color'].includes(fd.kind)) continue;
      let v = f[fd.key];
      if (fd.kind === 'select') v = fd.options.find(o => o.value === v)?.label || v;
      if (code.type === 'wifi' && fd.key === 'password') v = v ? '••••••••' : '';
      add(fd.label, v);
    }
    if (f.fileName) add('File', f.fileName);
    if (f.links?.length) add('Links', f.links.map(l => `${l.label} → ${l.url}`).join('\n'));
    return rows;
  }

  const quickEdit = (() => {
    if (!code.dynamic || code.type !== 'url') return null;
    const input = h('input', { class: 'input', value: code.fields.url, 'aria-label': 'Destination URL' });
    const btn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      btn.disabled = true;
      try { code = await api('PATCH', `/api/codes/${id}`, { fields: { url: input.value } }); input.value = code.fields.url; toast('Destination updated — printed codes now go here', 'good'); }
      catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
    } }, 'Update destination');
    return h('div', { class: 'card' }, h('h3', {}, 'Destination'), h('p', { class: 'muted' }, 'Change where this QR code leads — instantly, even for printed copies.'), h('div', { class: 'copyline' }, input, btn));
  })();

  const setStatus = async status => {
    try { code = await api('PATCH', `/api/codes/${id}`, { status }); toast(status === 'active' ? 'Code resumed' : 'Code paused', 'good'); draw(); } catch (e) { toast(e.message, 'bad'); }
  };

  function draw() {
    const stage = h('div', { class: 'qr-stage' }, scene ? h('div', { html: sceneToSVG(scene, { px: 320 }), style: { width: '100%', maxWidth: '320px' } }) : h('p', {}, 'This code cannot be drawn.'));
    const exp = exportPanel({ getScene: () => scene, getName: () => code.name });
    const rows = summaryRows();
    mount(root,
      h('div', { class: 'page-head' }, h('div', {}, h('a', { href: '#/codes', class: 'muted' }, '← My codes'), h('h1', {}, code.name),
        h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'badge' }, TYPE_ICON[code.type], ' ', typeLabel(code.type)), statusBadge(code), code.hasPassword ? h('span', { class: 'badge accent' }, '🔒 Password') : null, code.expiresAt ? h('span', { class: 'badge' }, `Expires ${fmtDateTime(code.expiresAt)}`) : null)),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: `#/codes/${id}/edit` }, 'Edit'),
          code.dynamic ? h('button', { class: 'btn', onclick: () => setStatus(code.status === 'active' ? 'paused' : 'active'), disabled: code.status === 'blocked' }, code.status === 'active' ? 'Pause' : 'Resume') : null,
          h('button', { class: 'btn', onclick: async () => { try { const c = await api('POST', `/api/codes/${id}/duplicate`); toast('Duplicated', 'good'); refreshMe(); location.hash = `#/codes/${c.id}`; } catch (e) { toast(e.message, 'bad'); } } }, 'Duplicate'),
          h('button', { class: 'btn danger', onclick: async () => {
            if (!(await confirmDialog(`Delete “${code.name}”? ${code.dynamic ? 'Printed copies will stop working.' : ''}`, { ok: 'Delete', danger: true }))) return;
            try { await api('DELETE', `/api/codes/${id}`); toast('Deleted'); refreshMe(); location.hash = '#/codes'; } catch (e) { toast(e.message, 'bad'); }
          } }, 'Delete'))),
      code.status === 'blocked' ? h('div', { class: 'alert bad' }, 'An administrator disabled this code. Scans show a “disabled” page.') : null,
      h('div', { class: 'gen' },
        h('div', { class: 'stack' },
          quickEdit,
          code.dynamic ? h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Analytics'), select(RANGES, days, v => { days = Number(v); loadStats(); })) : null,
          code.dynamic ? statsBox : h('div', { class: 'card' }, h('h3', {}, 'Static code'), h('p', { class: 'muted' }, 'Static codes store their content inside the image, so they cannot be edited or tracked. Create a dynamic code if you need scan analytics or want to change the destination later.'), h('a', { class: 'btn', href: '#/' }, 'Create a dynamic code')),
          code.dynamic ? recentBox : null,
          h('div', { class: 'card' }, h('h3', {}, 'Content'), rows.length ? h('dl', { class: 'kv' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', { style: { whiteSpace: 'pre-wrap' } }, v)])) : h('p', { class: 'muted' }, 'Hosted content — open Edit to change it.')),
        ),
        h('div', { class: 'card preview' }, h('div', { class: 'card-title' }, h('h2', {}, 'QR code')), stage, h('div', { style: { height: '12px' } }),
          code.dynamic ? h('div', {}, h('div', { class: 'lbl', style: { fontWeight: 600, fontSize: '.88rem', marginBottom: '4px' } }, 'Short link (what the code contains)'), copyLine(code.shortUrl), h('div', { style: { height: '12px' } })) : null,
          scene ? scanAdvice(code.style, scene.n).filter(a => a.level !== 'info').map(a => h('div', { class: `alert ${a.level === 'bad' ? 'bad' : 'warn'}` }, a.text)) : null,
          exp)));
    if (code.dynamic) loadStats();
  }
  draw();
}
