import { h, mount, toast, confirmDialog, dialog, promptDialog, ago, copyText } from '../ui.js';
import { api, state } from '../app.js';
import { copyLine } from './shared.js';

export default async function render(root) {
  const base = state.config.baseUrl;
  const keysBox = h('div'), hooksBox = h('div');

  async function loadKeys() {
    const { items } = await api('GET', '/api/keys');
    mount(keysBox, items.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Name', 'Key', 'Created', 'Last used', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, items.map(k => h('tr', {}, h('td', {}, k.name), h('td', {}, h('code', {}, `${k.prefix}…`)), h('td', {}, ago(k.created_at)), h('td', {}, k.last_used_at ? ago(k.last_used_at) : 'never'),
        h('td', { class: 'num' }, h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Revoke “${k.name}”? Anything using it will stop working.`, { ok: 'Revoke', danger: true })) { await api('DELETE', `/api/keys/${k.id}`); loadKeys(); } } }, 'Revoke'))))))) : h('p', { class: 'muted' }, 'No API keys yet.'));
  }
  async function newKey() {
    const name = await promptDialog({ title: 'New API key', label: 'What is it for?', value: 'My integration', ok: 'Create key' });
    if (!name?.trim()) return;
    try {
      const k = await api('POST', '/api/keys', { name });
      await dialog({ title: 'Your new API key', body: h('div', {}, h('div', { class: 'alert warn' }, 'Copy it now — for security it is shown only once.'), copyLine(k.key)), actions: close => [h('button', { class: 'btn primary', onclick: () => close(true) }, 'Done')] });
      loadKeys();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function loadHooks() {
    const { items } = await api('GET', '/api/webhooks');
    mount(hooksBox, items.length ? items.map(w => h('div', { class: 'card flat', style: { marginBottom: '10px' } },
      h('div', { class: 'row between' }, h('code', { style: { overflowWrap: 'anywhere' } }, w.url), h('span', { class: `badge ${w.active ? 'good' : ''}` }, w.active ? 'Active' : 'Paused')),
      h('small', { class: 'muted' }, w.lastAt ? `Last delivery ${ago(w.lastAt)} · status ${w.lastStatus}` : 'Never delivered'),
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn sm', onclick: async () => { try { const r = await api('POST', `/api/webhooks/${w.id}/test`); toast(`Test sent — response ${r.status}`, /^2/.test(r.status) ? 'good' : 'bad'); loadHooks(); } catch (e) { toast(e.message, 'bad'); } } }, 'Send test'),
        h('button', { class: 'btn sm', onclick: async () => { await api('PATCH', `/api/webhooks/${w.id}`, { active: !w.active }); loadHooks(); } }, w.active ? 'Pause' : 'Resume'),
        h('button', { class: 'btn sm', onclick: () => copyText(w.secret, 'Signing secret copied') }, 'Copy signing secret'),
        h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog('Delete this webhook?', { ok: 'Delete', danger: true })) { await api('DELETE', `/api/webhooks/${w.id}`); loadHooks(); } } }, 'Delete')))) : h('p', { class: 'muted' }, 'No webhooks yet.'));
  }
  async function newHook() {
    const url = await promptDialog({ title: 'Add webhook', label: 'Endpoint URL (https)', value: 'https://', ok: 'Add' });
    if (!url?.trim() || url.trim() === 'https://') return;
    try { await api('POST', '/api/webhooks', { url }); loadHooks(); } catch (e) { toast(e.message, 'bad'); }
  }

  const ep = (m, p, d) => h('div', { class: 'endpoint' }, h('span', { class: `method ${m.toLowerCase()}` }, m), h('code', {}, p), h('span', { class: 'muted' }, d));
  const sample = `${base}/api/render?data=${encodeURIComponent('https://example.com')}&format=png&size=300&fg=4f46e5&dots=rounded&frame=pill-bottom&frameText=SCAN%20ME`;

  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'API & integrations'), h('p', {}, 'Create codes from your own tools, get scan events, or embed QR images anywhere.'))),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', {}, 'API keys'), h('button', { class: 'btn primary sm', onclick: newKey }, '+ New key')), keysBox),
      h('div', { class: 'card' }, h('h2', {}, 'REST API'),
        h('p', { class: 'muted' }, 'Base URL: ', h('code', {}, `${base}/api/v1`), '. Send your key as ', h('code', {}, 'Authorization: Bearer qrs_…'), '. Bodies and responses are JSON.'),
        ep('GET', '/codes', 'List codes (?q, type, dynamic, folder, campaign, page, limit)'),
        ep('POST', '/codes', 'Create a code: {type, dynamic, name, fields, style, slug, expiresAt, password}'),
        ep('GET', '/codes/:id', 'One code, with its QR payload'),
        ep('PATCH', '/codes/:id', 'Update content, destination or style'),
        ep('DELETE', '/codes/:id', 'Delete a code'),
        ep('GET', '/codes/:id/image/{svg|png|jpg|pdf|eps}', 'Download the finished QR image (?size=1024)'),
        ep('GET', '/codes/:id/stats', 'Scan analytics (?days=30)'),
        ep('POST', '/codes/bulk', 'Create many: {type, dynamic, style, rows:[{name, fields}]}'),
        ep('GET', '/render', 'Public image URL: ?data=…&format=png&size=512&fg=000000&bg=ffffff&dots=rounded'),
        h('h3', { style: { marginTop: '16px' } }, 'Examples'),
        h('pre', {}, `curl -X POST ${base}/api/v1/codes \\\n  -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"type":"url","dynamic":true,"name":"Menu","fields":{"url":"https://example.com/menu"}}'`),
        h('pre', {}, `curl -o menu.png "${base}/api/v1/codes/123/image/png?size=1024" -H "Authorization: Bearer YOUR_KEY"`),
        h('p', { class: 'muted' }, 'Field names per type match the form in the generator: ', h('code', {}, 'url: {url}'), ', ', h('code', {}, 'wifi: {ssid, password, security}'), ', ', h('code', {}, 'vcard: {first, last, email, …}'), ', and so on.')),
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', {}, 'Webhooks'), h('button', { class: 'btn primary sm', onclick: newHook }, '+ Add webhook')),
        h('p', { class: 'muted' }, 'We POST a JSON event to your URL each time one of your dynamic codes is scanned. Requests are signed: ', h('code', {}, 'X-QR-Signature: sha256=HMAC(secret, body)'), '.'), hooksBox),
      h('div', { class: 'card' }, h('h2', {}, 'Using it with other tools'),
        h('div', { class: 'grid cols-2' },
          h('div', {}, h('h3', {}, 'Zapier / Make / n8n'), h('p', { class: 'muted' }, 'Use an HTTP / “Webhooks by Zapier” action to call ', h('code', {}, 'POST /api/v1/codes'), ' with your key to create codes from any trigger (new row, new order…). Use a “Catch Hook” URL as a webhook above to react to scans.')),
          h('div', {}, h('h3', {}, 'Canva & design tools'), h('p', { class: 'muted' }, 'Download an SVG or PNG from any code and drop it into your design, or use a ', h('code', {}, '/api/render'), ' image URL where the tool accepts a link. SVG and PDF stay sharp at any size.')),
          h('div', {}, h('h3', {}, 'Google Sheets'), h('p', { class: 'muted' }, 'Show a QR in a cell: ', h('code', {}, `=IMAGE("${base}/api/render?data="&ENCODEURL(A2)&"&format=png")`))),
          h('div', {}, h('h3', {}, 'Websites & emails'), h('p', { class: 'muted' }, 'Embed ', h('code', {}, '<img src="…/api/render?data=…">'), '. Example below.'), h('img', { src: sample, alt: 'Example QR code from the render URL', width: 120, height: 'auto', style: { background: '#fff', borderRadius: '8px', border: '1px solid var(--line)' } }))))));
  await Promise.all([loadKeys(), loadHooks()]);
}
