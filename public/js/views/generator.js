import { h, mount, toast, debounce } from '../ui.js';
import { api, state } from '../app.js';
import { TYPES, TYPE_GROUPS, cleanFields, staticPayload, fieldVisible } from '../qr-content.js';
import { normalizeStyle, scanAdvice, sceneToSVG } from '../qr-render.js';
import { sceneFor } from '../qr-client.js';
import { scanTest, fileToDataUrl } from '../export.js';
import { field, select, seg, exportPanel, loadMeta, TYPE_ICON } from './shared.js';
import { designPanel } from './design.js';

const STYLE_KEY = 'qr-last-style';
const loadLastStyle = () => { try { return JSON.parse(localStorage.getItem(STYLE_KEY)) || {}; } catch { return {}; } };
const saveLastStyle = s => { try { localStorage.setItem(STYLE_KEY, JSON.stringify({ ...s, logo: null })); } catch { /* ignore */ } };
const pad = n => String(n).padStart(2, '0');
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const SAMPLE = 'https://example.com';

export default async function render(root, { params, opts, query }) {
  const editId = opts.edit ? Number(params[0]) : null;
  const meta = await loadMeta();
  const existing = editId ? await api('GET', `/api/codes/${editId}`) : null;

  const S = {
    type: existing?.type || (TYPES[query.type] ? query.type : 'url'),
    dynamic: existing ? existing.dynamic : (TYPES[query.type]?.dynamicOnly ?? false),
    fieldsByType: existing ? { [existing.type]: structuredClone(existing.fields) } : {},
    style: normalizeStyle(existing?.style || loadLastStyle()),
    name: existing?.name || '',
    slug: '', expiresAt: existing?.expiresAt ? toLocalInput(existing.expiresAt) : '', password: '', clearPassword: false,
    status: existing?.status || 'active',
    folderId: existing?.folderId ?? '', campaignId: existing?.campaignId ?? '', domainId: existing?.domainId ?? '',
  };
  const fieldsOf = () => (S.fieldsByType[S.type] ||= defaults(S.type));
  function defaults(type) { const o = {}; for (const f of TYPES[type].fields) if (f.default != null) o[f.key] = f.default; return o; }

  // ---------- preview ----------
  const stage = h('div', { class: 'qr-stage', 'aria-live': 'polite' });
  const notice = h('div');
  const testBox = h('div', { class: 'scan-test', hidden: true });
  const adviceBox = h('ul', { class: 'advice' });
  const payloadBox = h('div');
  let scene = null, payload = '', testToken = 0;

  function dynamicBase() {
    const d = meta.domains.find(x => String(x.id) === String(S.domainId));
    return d ? `${state.config.baseUrl.startsWith('http:') ? 'http' : 'https'}://${d.host}` : state.config.baseUrl;
  }

  function computePayload() {
    const cleaned = cleanFields(S.type, fieldsOf());
    if (S.dynamic) return existing ? existing.payload : `${dynamicBase()}/${S.slug || 'x7k2m9a'}`;
    return staticPayload(S.type, cleaned);
  }

  const refresh = debounce(async () => {
    saveLastStyle(S.style);
    let err = '';
    try { payload = computePayload(); scene = sceneFor(payload, S.style); } catch (e) { err = e.message; scene = null; }
    const token = ++testToken;
    if (scene) {
      mount(stage, h('div', { html: sceneToSVG(scene, { px: 320 }), style: { width: '100%', maxWidth: '320px' } }));
      stage.classList.remove('err');
      mount(notice);
      const adv = scanAdvice(S.style, scene.n);
      mount(adviceBox, ...adv.map(a => h('li', { class: a.level }, a.text)));
      testBox.hidden = false; testBox.className = 'scan-test'; testBox.textContent = 'Testing scannability…';
      scanTest(scene, payload).then(r => {
        if (token !== testToken) return;
        if (r.ok) { testBox.className = 'scan-test good'; testBox.textContent = '✓ Scan test passed — this code reads correctly.'; }
        else { testBox.className = 'scan-test warn'; testBox.textContent = r.reason === 'mismatch' ? '⚠ The code read back different data. Simplify the design and test with your phone.' : '⚠ We could not read this design automatically. Test it with your phone before printing.'; }
      }).catch(() => { if (token === testToken) testBox.hidden = true; });
      mount(payloadBox, S.dynamic
        ? h('div', { class: 'hint muted' }, existing ? 'This code points to:' : 'Final link is created when you save:', ' ', h('code', {}, payload))
        : h('div', { class: 'hint muted' }, `${payload.length} characters · version ${Math.round((scene.n - 17) / 4)}`));
    } else {
      testBox.hidden = true; mount(adviceBox);
      const sample = (() => { try { return sceneFor(SAMPLE, S.style); } catch { return null; } })();
      mount(stage, sample ? h('div', { html: sceneToSVG(sample, { px: 320 }), style: { width: '100%', maxWidth: '320px', opacity: '.3', filter: 'grayscale(.6)' } }) : null);
      mount(notice, h('div', { class: 'alert info' }, err || 'Enter your content to see your QR code.'));
      mount(payloadBox);
    }
  }, 70);

  // ---------- type picker ----------
  const typesCard = h('div', { class: 'card' });
  function drawTypes() {
    mount(typesCard, h('div', { class: 'card-title' }, h('h2', {}, '1 · What is it for?')),
      TYPE_GROUPS.filter(g => state.user || g !== 'Hosted').map(g => [h('div', { class: 'group-label' }, { Link: 'Links', Contact: 'Contact', Text: 'Info', Hosted: 'Hosted pages & files' }[g]),
        h('div', { class: 'types' }, Object.entries(TYPES).filter(([, t]) => t.group === g && (state.user || !t.dynamicOnly)).map(([id, t]) => h('button', {
          type: 'button', class: 'type', 'aria-pressed': String(S.type === id), onclick: () => {
            S.type = id; if (TYPES[id].dynamicOnly) S.dynamic = true; drawTypes(); drawContent(); drawSave(); refresh();
          } }, h('span', { class: 'ic' }, TYPE_ICON[id]), t.label)))]));
  }

  // ---------- content form ----------
  const contentCard = h('div', { class: 'card' });

  function drawContent() {
    const t = TYPES[S.type];
    const values = fieldsOf();
    const form = h('div');
    let pair = null;
    const place = (f, el) => {
      if (f.half) {
        if (!pair) { pair = h('div', { class: 'two' }); form.append(pair); }
        pair.append(el);
        if (pair.children.length === 2) pair = null;
      } else { pair = null; form.append(el); }
    };
    for (const f of t.fields) {
      const vals = { ...defaults(S.type), ...values };
      if (f.showIf && !fieldVisible(f, vals)) continue;
      place(f, fieldInput(f, values));
    }
    const modeBox = t.dynamicOnly
      ? h('div', { class: 'alert info' }, t.hint, ' This is always a dynamic code (hosted by this site).')
      : !state.user ? null : h('div', { style: { marginBottom: '14px' } },
        seg([[false, 'Static'], [true, 'Dynamic']], S.dynamic, v => { S.dynamic = v === true || v === 'true'; drawContent(); drawSave(); refresh(); }),
        h('p', { class: 'hint muted', style: { margin: '8px 0 0' } }, S.dynamic
          ? 'Dynamic: the code points to a short link you control. Change the destination after printing, track scans, add an expiry date or password.'
          : 'Static: the content is stored inside the code. Works forever, no account needed — but it cannot be edited or tracked.'),
        S.dynamic && !state.user ? h('div', { class: 'alert warn', style: { marginTop: '10px' } }, h('a', { href: '#/register' }, 'Create a free account'), ' or ', h('a', { href: '#/login' }, 'sign in'), ' to save dynamic codes.') : null);
    mount(contentCard, h('div', { class: 'card-title' }, h('h2', {}, existing ? `Edit · ${TYPES[S.type].label}` : '2 · Content')),
      existing ? (existing.dynamic ? h('div', { class: 'alert info' }, 'This is a dynamic code. Changing the content does not change the QR image, so printed copies keep working.') : null) : modeBox,
      !existing && t.hint && !t.dynamicOnly ? h('p', { class: 'hint muted' }, t.hint) : null, form);
  }

  function fieldInput(f, values) {
    const set = v => { values[f.key] = v; refresh(); };
    const val = values[f.key] ?? f.default ?? '';
    const lbl = (el, hint) => field(f.label + (f.required ? ' *' : ''), el, hint);
    switch (f.kind) {
      case 'textarea': return lbl(h('textarea', { class: 'input', value: val, maxlength: f.max || 500, oninput: e => set(e.target.value) }));
      case 'checkbox': return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!values[f.key], onchange: e => set(e.target.checked) }), f.label);
      case 'select': return lbl(select(f.options, val, v => { values[f.key] = v; drawContent(); refresh(); }));
      case 'color': return lbl(h('input', { type: 'color', value: val || '#2563eb', oninput: e => set(e.target.value) }));
      case 'datetime': return lbl(h('input', { class: 'input', type: 'datetime-local', value: val, oninput: e => set(e.target.value) }));
      case 'file': return lbl(fileInput(values));
      case 'image': return lbl(imageInput(f, values));
      case 'links': return linksEditor(values);
      default: return lbl(h('input', {
        class: 'input', type: f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : 'text', value: val, placeholder: f.placeholder || '',
        inputmode: f.kind === 'number' ? 'decimal' : null, autocomplete: 'off', maxlength: f.max || 500, oninput: e => set(e.target.value),
      }));
    }
  }

  function fileInput(values) {
    const status = h('div', { class: 'hint' }, values.fileName ? `Uploaded: ${values.fileName}` : 'PDF, image, Office document, text, zip, mp3 or mp4 — up to 15 MB.');
    const input = h('input', { class: 'input', type: 'file', onchange: async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!state.user) { status.textContent = 'Sign in to upload files.'; return; }
      if (f.size > 15 * 1024 * 1024) { status.textContent = 'That file is larger than 15 MB.'; return; }
      status.textContent = 'Uploading…';
      try {
        const r = await api('POST', '/api/upload', f, { headers: { 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' } });
        values.file = r.id; values.fileName = r.name; status.textContent = `Uploaded: ${r.name}`; refresh();
      } catch (err) { status.textContent = err.message; e.target.value = ''; }
    } });
    return h('div', {}, input, status);
  }

  function imageInput(f, values) {
    const wrap = h('div');
    const draw = () => mount(wrap, 
      values[f.key] ? h('div', { class: 'row' }, h('img', { class: 'thumb', src: values[f.key], alt: '' }), h('button', { class: 'btn sm danger', type: 'button', onclick: () => { values[f.key] = ''; draw(); refresh(); } }, 'Remove')) : null,
      h('input', { class: 'input', type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', onchange: async e => {
        const file = e.target.files[0];
        if (!file) return;
        try { values[f.key] = await fileToDataUrl(file, f.key === 'avatar' ? 256 : 800); draw(); refresh(); } catch (err) { toast(err.message, 'bad'); }
      } }));
    draw();
    return wrap;
  }

  function linksEditor(values) {
    values.links ||= [{ label: '', url: '' }];
    const wrap = h('div', { class: 'field links-editor' }, h('span', { class: 'lbl' }, 'Links *'));
    const list = h('div');
    const draw = () => {
      mount(list, ...values.links.map((l, i) => h('div', { class: 'row' },
        h('input', { class: 'input', placeholder: 'Label', value: l.label, maxlength: 80, 'aria-label': `Link ${i + 1} label`, oninput: e => { l.label = e.target.value; refresh(); } }),
        h('input', { class: 'input', placeholder: 'https://…', value: l.url, 'aria-label': `Link ${i + 1} address`, oninput: e => { l.url = e.target.value; refresh(); } }),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Remove link', onclick: () => { values.links.splice(i, 1); draw(); refresh(); } }, '✕'))));
    };
    draw();
    wrap.append(list, h('button', { class: 'btn sm', type: 'button', onclick: () => { if (values.links.length < 30) { values.links.push({ label: '', url: '' }); draw(); } } }, '+ Add link'));
    return wrap;
  }

  // ---------- design ----------
  const designCard = h('div', { class: 'card' });
  const templates = meta.templates;
  designCard.append(h('div', { class: 'card-title' }, h('h2', {}, existing ? 'Design' : '3 · Design')),
    designPanel({
      style: S.style, onChange: refresh, templates, canSaveTemplate: !!state.user,
      onTemplateSaved: async (name, style) => {
        try { const t = await api('POST', '/api/templates', { name, style }); templates.push(t); toast('Template saved', 'good'); } catch (e) { toast(e.message, 'bad'); }
      },
    }));

  // ---------- save / organise ----------
  const saveCard = h('div', { class: 'card' });
  function drawSave() {
    if (!state.user && state.config.registration === 'closed') { mount(saveCard); saveCard.hidden = true; return; }
    if (!state.user) {
      mount(saveCard, h('div', { class: 'card-title' }, h('h2', {}, '4 · Save & track')),
        h('p', { class: 'muted' }, 'Free account: save your codes, create dynamic codes you can edit later, see scan analytics, bulk-create from a spreadsheet and use the API.'),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/register' }, 'Create free account'), h('a', { class: 'btn', href: '#/login' }, 'Sign in')));
      return;
    }
    const opt = (items, none) => [['', none], ...items.map(i => [i.id, i.name])];
    const lockedBlocked = existing?.status === 'blocked';
    mount(saveCard, h('div', { class: 'card-title' }, h('h2', {}, existing ? 'Details' : '4 · Save')),
      field('Name', h('input', { class: 'input', value: S.name, maxlength: 100, placeholder: TYPES[S.type].label, oninput: e => { S.name = e.target.value; } }), 'Only you see this.'),
      h('div', { class: 'two' },
        field('Folder', select(opt(meta.folders, 'No folder'), S.folderId, v => { S.folderId = v; })),
        field('Campaign', select(opt(meta.campaigns, 'No campaign'), S.campaignId, v => { S.campaignId = v; }))),
      S.dynamic ? h('div', {},
        h('div', { class: 'group-label' }, 'Dynamic code settings'),
        !existing ? h('div', { class: 'two' },
          field('Short domain', select([['', `${new URL(state.config.baseUrl).host} (default)`], ...meta.domains.map(d => [d.id, d.host])], S.domainId, v => { S.domainId = v; refresh(); })),
          field('Custom link (optional)', h('input', { class: 'input', value: S.slug, maxlength: 32, placeholder: 'my-promo', oninput: e => { S.slug = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''); e.target.value = S.slug; refresh(); } }), 'Letters, numbers, dash. 4–32 characters.')) : null,
        h('div', { class: 'two' },
          field('Expires on', h('input', { class: 'input', type: 'datetime-local', value: S.expiresAt, oninput: e => { S.expiresAt = e.target.value; } }), 'Leave empty to never expire.'),
          field(existing?.hasPassword ? 'Password (set — type to change)' : 'Password protection', h('input', { class: 'input', type: 'password', value: S.password, autocomplete: 'new-password', placeholder: existing?.hasPassword ? '••••••' : 'Optional', oninput: e => { S.password = e.target.value; } }), existing?.hasPassword ? null : 'Visitors must enter it before the content opens.')),
        existing?.hasPassword ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: e => { S.clearPassword = e.target.checked; } }), 'Remove password protection') : null,
        existing ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.status === 'active', disabled: lockedBlocked, onchange: e => { S.status = e.target.checked ? 'active' : 'paused'; } }), lockedBlocked ? 'Disabled by an administrator' : 'Code is active (untick to pause scans)') : null) : null,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn primary', type: 'button', id: 'save-btn', onclick: save }, existing ? 'Save changes' : S.dynamic ? 'Create dynamic code' : 'Save to my codes'),
        existing ? h('a', { class: 'btn', href: `#/codes/${existing.id}` }, 'Cancel') : null));
  }

  async function save() {
    const btn = saveCard.querySelector('#save-btn');
    let cleaned;
    try { cleaned = cleanFields(S.type, fieldsOf()); if (!S.dynamic) staticPayload(S.type, cleaned); } catch (e) { return toast(e.message, 'bad'); }
    const body = {
      name: S.name.trim(), style: S.style, fields: cleaned,
      folderId: S.folderId === '' ? null : Number(S.folderId), campaignId: S.campaignId === '' ? null : Number(S.campaignId),
    };
    if (S.dynamic) {
      body.expiresAt = S.expiresAt ? new Date(S.expiresAt).getTime() : null;
      if (S.password) body.password = S.password;
      if (S.clearPassword) body.clearPassword = true;
      if (existing) body.status = S.status;
      else { body.domainId = S.domainId === '' ? null : Number(S.domainId); if (S.slug) body.slug = S.slug; }
    }
    if (!existing) { body.type = S.type; body.dynamic = S.dynamic; }
    btn.disabled = true;
    try {
      const saved = existing ? await api('PATCH', `/api/codes/${existing.id}`, body) : await api('POST', '/api/codes', body);
      toast(existing ? 'Saved' : 'QR code saved', 'good');
      location.hash = `#/codes/${saved.id}`;
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
  }

  // ---------- assemble ----------
  const exportCard = h('div', { class: 'card preview' },
    h('div', { class: 'card-title' }, h('h2', {}, 'Preview')),
    stage, h('div', { style: { height: '10px' } }), notice, testBox, adviceBox, payloadBox, h('div', { style: { height: '12px' } }),
    exportPanel({ getScene: () => scene, getName: () => S.name || TYPES[S.type].label }));

  drawTypes(); drawContent(); drawSave();
  const left = h('div', { class: 'stack' }, existing ? null : typesCard, contentCard, designCard, saveCard);
  mount(root,
    existing ? h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Edit “${existing.name}”`), h('p', {}, 'Update the content, destination or design.'))) :
      (state.user ? h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Create a QR code'), h('p', {}, 'Pick a type, add your content, style it and download.'))) :
        h('div', { class: 'hero' }, h('h1', {}, 'Free QR code generator'), h('p', {}, 'Static and dynamic QR codes with your colors, logo and frame. Download PNG, SVG, JPG, PDF or EPS — free, no account needed.'))),
    h('div', { class: 'gen' }, left, exportCard));
  refresh();
  return () => { refresh.cancel(); testToken++; };
}
