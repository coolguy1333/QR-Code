import { h, mount, toast, fmtNum, debounce } from '../ui.js';
import { api, state, refreshMe } from '../app.js';
import { TYPES, cleanFields, staticPayload } from '../qr-content.js';
import { normalizeStyle, sceneToSVG } from '../qr-render.js';
import { sceneFor, svgFor } from '../qr-client.js';
import { exportBlob, makeZip, saveBlob, safeName, FORMATS } from '../export.js';
import { field, select, seg, loadMeta, TYPE_ICON } from './shared.js';
import { designPanel } from './design.js';

const BULK_TYPES = Object.entries(TYPES).filter(([, t]) => !t.dynamicOnly).map(([k]) => k);

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [['\t', first.split('\t').length], [';', first.split(';').length], [',', first.split(',').length]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const TRUE = /^(1|true|yes|y|x|on)$/i;

export default async function render(root) {
  const meta = await loadMeta();
  const max = state.config.maxBulk;
  const S = { type: 'url', dynamic: false, text: '', table: [], map: {}, nameCol: '', style: normalizeStyle({}), folderId: '', campaignId: '', domainId: '', format: 'png', px: 1024 };

  const previewBox = h('div');
  const resultBox = h('div');
  const mapBox = h('div');
  const stage = h('div', { class: 'qr-stage', style: { minHeight: '200px' } });
  const textarea = h('textarea', { class: 'input', rows: 8, placeholder: 'Paste rows here, or upload a file…', style: { fontFamily: 'ui-monospace, monospace' }, oninput: e => { S.text = e.target.value; reparse(); } });

  function sampleCSV() {
    const t = TYPES[S.type];
    const keys = t.fields.filter(f => f.kind !== 'file' && f.kind !== 'links' && f.kind !== 'image').map(f => f.key);
    const ex = { url: 'https://example.com/menu', text: 'Hello world', to: 'hello@example.com', number: '+15551234567', ssid: 'Guest WiFi', password: 'welcome123', lat: '48.8584', lng: '2.2945', handle: 'yourname', first: 'Ada', last: 'Lovelace', title: 'Launch party', start: '2026-12-31T20:00', ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' };
    return `name,${keys.join(',')}\nTable 1,${keys.map(k => ex[k] ?? '').join(',')}\nTable 2,${keys.map(k => ex[k] ?? '').join(',')}\n`;
  }

  function reparse() {
    S.table = S.text.trim() ? parseCSV(S.text) : [];
    autoMap(); drawMap(); drawPreview();
  }

  function mappable() { return TYPES[S.type].fields.filter(f => !['file', 'image', 'links'].includes(f.kind)); }

  function autoMap() {
    S.map = {}; S.nameCol = '';
    if (!S.table.length) return;
    const headers = S.table[0].map(norm);
    const used = new Set();
    const hasHeader = mappable().some(f => headers.includes(norm(f.key)) || headers.includes(norm(f.label))) || headers.includes('name');
    S.hasHeader = hasHeader;
    if (hasHeader) {
      const ni = headers.findIndex(x => ['name', 'title', 'label'].includes(x) && !mappable().some(f => norm(f.key) === x));
      if (ni >= 0) { S.nameCol = String(ni); used.add(ni); }
      for (const f of mappable()) {
        const i = headers.findIndex((x, idx) => !used.has(idx) && (x === norm(f.key) || x === norm(f.label)));
        if (i >= 0) { S.map[f.key] = String(i); used.add(i); }
      }
    } else {
      // headerless: columns in field order (required fields first)
      const cols = S.table[0].length;
      const order = mappable().filter(f => f.required || (S.type === 'url'));
      order.slice(0, cols).forEach((f, i) => { S.map[f.key] = String(i); });
      if (cols > order.length) S.nameCol = String(order.length);
    }
  }

  function drawMap() {
    if (!S.table.length) { mount(mapBox); return; }
    const headers = S.hasHeader ? S.table[0] : S.table[0].map((_, i) => `Column ${i + 1}`);
    const opts = [['', '— none —'], ...headers.map((x, i) => [String(i), x || `Column ${i + 1}`])];
    mount(mapBox, h('div', { class: 'card flat' },
      h('div', { class: 'card-title' }, h('h3', {}, 'Match your columns'), h('label', { class: 'check', style: { margin: 0 } }, h('input', { type: 'checkbox', checked: S.hasHeader, onchange: e => { S.hasHeader = e.target.checked; drawMap(); drawPreview(); } }), 'First row is a header')),
      h('div', { class: 'two' }, field('Code name', select(opts, S.nameCol, v => { S.nameCol = v; drawPreview(); }), 'Used to label each code.'),
        mappable().map(f => field(`${f.label}${f.required ? ' *' : ''}`, select(opts, S.map[f.key] ?? '', v => { S.map[f.key] = v; drawPreview(); }))))));
  }

  function buildRows() {
    const body = S.hasHeader ? S.table.slice(1) : S.table;
    return body.map((r, i) => {
      const fields = {};
      for (const f of mappable()) {
        const ci = S.map[f.key];
        if (ci === '' || ci == null) { if (f.default != null) fields[f.key] = f.default; continue; }
        let v = (r[Number(ci)] ?? '').trim();
        if (f.kind === 'checkbox') v = TRUE.test(v);
        else if (f.kind === 'select') { const o = f.options.find(o => norm(o.value) === norm(v) || norm(o.label) === norm(v)); v = o ? o.value : (v || f.default || ''); }
        fields[f.key] = v;
      }
      const name = S.nameCol !== '' ? (r[Number(S.nameCol)] ?? '').trim() : '';
      let error = '', payload = '';
      try { const cleaned = cleanFields(S.type, fields); payload = S.dynamic ? '(short link)' : staticPayload(S.type, cleaned); sceneFor(S.dynamic ? 'https://example.com/abc1234' : payload, S.style); } catch (e) { error = e.message; }
      return { n: i + 1, name: name || `${TYPES[S.type].label} ${i + 1}`, fields, payload, error };
    });
  }

  let rows = [];
  function drawPreview() {
    rows = S.table.length ? buildRows() : [];
    const ok = rows.filter(r => !r.error);
    const sample = ok[0];
    try { const sc = sceneFor(S.dynamic ? 'https://example.com/abc1234' : (sample?.payload || 'https://example.com'), S.style); mount(stage, h('div', { html: sceneToSVG(sc, { px: 240 }), style: { width: '100%', maxWidth: '240px' } })); } catch { /* ignore */ }
    if (!rows.length) { mount(previewBox); runBtn.disabled = true; return; }
    runBtn.disabled = ok.length === 0 || rows.length > max;
    runBtn.textContent = `Create ${fmtNum(ok.length)} QR code${ok.length === 1 ? '' : 's'}`;
    mount(previewBox, h('div', { class: 'card flat' },
      h('div', { class: 'card-title' }, h('h3', {}, `Preview · ${fmtNum(rows.length)} rows`), h('span', { class: 'row' }, h('span', { class: 'badge good' }, `${fmtNum(ok.length)} ready`), rows.length - ok.length ? h('span', { class: 'badge bad' }, `${fmtNum(rows.length - ok.length)} with problems`) : null)),
      rows.length > max ? h('div', { class: 'alert bad' }, `This site allows ${fmtNum(max)} rows per run. Split your file.`) : null,
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['#', 'QR', 'Name', 'Content', 'Status'].map(x => h('th', {}, x)))),
        h('tbody', {}, rows.slice(0, 12).map(r => h('tr', {}, h('td', {}, r.n),
          h('td', {}, r.error ? '' : h('div', { class: 'mini-qr', html: S.dynamic ? '' : svgFor(r.payload, S.style, 64) })), h('td', {}, r.name),
          h('td', { style: { maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, Object.values(r.fields).filter(x => typeof x === 'string' && x).join(' · ')),
          h('td', {}, r.error ? h('span', { class: 'badge bad', title: r.error }, r.error) : h('span', { class: 'badge good' }, 'OK'))))))),
      rows.length > 12 ? h('small', { class: 'muted' }, `Showing the first 12 of ${fmtNum(rows.length)} rows.`) : null));
  }

  async function run() {
    const body = rows.filter(r => !r.error).map(r => ({ name: r.name, fields: r.fields }));
    runBtn.disabled = true; runBtn.textContent = 'Creating…';
    try {
      const res = await api('POST', '/api/codes/bulk', { type: S.type, dynamic: S.dynamic, style: S.style, rows: body, folderId: S.folderId === '' ? null : Number(S.folderId), campaignId: S.campaignId === '' ? null : Number(S.campaignId), domainId: S.dynamic && S.domainId !== '' ? Number(S.domainId) : undefined });
      refreshMe();
      showResults(res);
    } catch (e) { toast(e.message, 'bad'); drawPreview(); }
  }

  function showResults(res) {
    const prog = h('div', { class: 'progress', hidden: true }, h('i', { style: { width: '0%' } }));
    const fmt = h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'File format' }, FORMATS.map(([v, l]) => h('option', { value: v, selected: v === S.format }, l)));
    const zipBtn = h('button', { class: 'btn primary', onclick: async () => {
      zipBtn.disabled = true; prog.hidden = false;
      const files = [];
      try {
        for (let i = 0; i < res.created.length; i++) {
          const c = res.created[i];
          const sc = sceneFor(c.payload, S.style);
          const blob = await exportBlob(sc, fmt.value, { px: S.px, sizeMm: 50 });
          files.push({ name: `${String(i + 1).padStart(3, '0')}-${safeName(c.name)}.${fmt.value}`, data: new Uint8Array(await blob.arrayBuffer()) });
          prog.firstChild.style.width = `${((i + 1) / res.created.length) * 100}%`;
          if (i % 5 === 0) await new Promise(r => setTimeout(r));
        }
        saveBlob(makeZip(files), 'qr-codes.zip');
      } catch (e) { toast(e.message, 'bad'); } finally { zipBtn.disabled = false; prog.hidden = true; }
    } }, '⬇ Download all as ZIP');
    const csvBtn = h('button', { class: 'btn', onclick: () => {
      const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = ['name,short_link,qr_content', ...res.created.map(c => [c.name, c.shortUrl || '', c.payload].map(esc).join(','))].join('\n');
      saveBlob(new Blob([csv], { type: 'text/csv' }), 'qr-codes.csv');
    } }, 'Download list (CSV)');
    mount(resultBox, h('div', { class: 'card' },
      h('h2', {}, `Created ${fmtNum(res.created.length)} QR code${res.created.length === 1 ? '' : 's'}`),
      res.errors.length ? h('div', { class: 'alert warn' }, `${res.errors.length} row(s) were skipped: `, res.errors.slice(0, 5).map(e => `row ${e.row}: ${e.error}`).join(' · ')) : null,
      h('div', { class: 'row' }, fmt, zipBtn, csvBtn, h('a', { class: 'btn', href: '#/codes' }, 'View my codes')), h('div', { style: { height: '10px' } }), prog));
    resultBox.scrollIntoView({ behavior: 'smooth' });
  }

  const typeSel = select(BULK_TYPES.map(k => [k, `${TYPE_ICON[k]} ${TYPES[k].label}`]), S.type, v => { S.type = v; reparse(); });
  const runBtn = h('button', { class: 'btn primary', disabled: true, onclick: run }, 'Create QR codes');
  const fileInput = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain', class: 'sr', onchange: async e => { const f = e.target.files[0]; if (f) { S.text = await f.text(); textarea.value = S.text; reparse(); } } });
  const opt = (items, none) => [['', none], ...items.map(i => [i.id, i.name])];

  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Bulk QR codes'), h('p', {}, `Turn a spreadsheet into up to ${fmtNum(max)} codes at once, then download them all as a ZIP.`))),
    h('div', { class: 'gen' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, '1 · Data'),
          h('div', { class: 'two' }, field('Content type', typeSel), field('Kind', seg([[false, 'Static'], [true, 'Dynamic']], S.dynamic, v => { S.dynamic = v === true; drawPreview(); }), 'Dynamic codes get short links you can edit and track.')),
          field('Paste CSV / spreadsheet rows', textarea, 'Copy cells from Excel or Google Sheets and paste. Put column names in the first row.'),
          h('div', { class: 'row' }, h('label', { class: 'btn' }, '📁 Upload CSV file', fileInput), h('button', { class: 'btn', onclick: () => { S.text = sampleCSV(); textarea.value = S.text; reparse(); } }, 'Use example data'),
            h('button', { class: 'btn', onclick: () => saveBlob(new Blob([sampleCSV()], { type: 'text/csv' }), `bulk-${S.type}-example.csv`) }, 'Download example CSV'))),
        mapBox,
        h('div', { class: 'card' }, h('h2', {}, '2 · Design'), designPanel({ style: S.style, onChange: debounce(drawPreview, 80), templates: meta.templates })),
        h('div', { class: 'card' }, h('h2', {}, '3 · Organize'),
          h('div', { class: 'two' }, field('Folder', select(opt(meta.folders, 'No folder'), '', v => { S.folderId = v; })), field('Campaign', select(opt(meta.campaigns, 'No campaign'), '', v => { S.campaignId = v; }))),
          h('div', { id: 'dom' }, field('Short domain (dynamic codes)', select([['', 'Default domain'], ...meta.domains.map(d => [d.id, d.host])], '', v => { S.domainId = v; })))),
        previewBox, h('div', { class: 'row' }, runBtn), resultBox),
      h('div', { class: 'card preview' }, h('div', { class: 'card-title' }, h('h2', {}, 'Style preview')), stage, h('p', { class: 'hint muted', style: { marginTop: '10px' } }, 'The first valid row is shown. Every code in the batch uses this design.'))));
  drawPreview();
}
