import { h, mount, toast, confirmDialog, promptDialog, fmtNum } from '../ui.js';
import { api } from '../app.js';
import { svgFor } from '../qr-client.js';

export default async function render(root) {
  const box = h('div', { class: 'stack' });
  async function load() {
    const [folders, campaigns, templates] = await Promise.all(['folders', 'campaigns', 'templates'].map(x => api('GET', `/api/${x}`).then(r => r.items)));
    mount(box, 
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', {}, 'Folders'), h('button', { class: 'btn primary sm', onclick: () => add('folders', 'New folder') }, '+ New folder')),
        h('p', { class: 'muted' }, 'Group codes however you like — by client, location or event.'),
        list(folders, 'folders', f => [h('a', { href: `#/codes?folder=${f.id}` }, f.name), h('small', { class: 'muted' }, ` · ${fmtNum(f.codes)} codes`)], 'No folders yet.')),
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', {}, 'Campaigns'), h('button', { class: 'btn primary sm', onclick: () => add('campaigns', 'New campaign', true) }, '+ New campaign')),
        h('p', { class: 'muted' }, 'Compare how a set of codes performs, like a poster run or a mailing.'),
        list(campaigns, 'campaigns', c => [h('a', { href: `#/codes?campaign=${c.id}` }, c.name), h('small', { class: 'muted' }, ` · ${fmtNum(c.codes)} codes · ${fmtNum(c.scans)} scans${c.description ? ' · ' + c.description : ''}`)], 'No campaigns yet.', true)),
      h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h2', {}, 'Brand templates')),
        h('p', { class: 'muted' }, 'Save a look (colors, shapes, logo, frame) from the generator with “+ Save as template”, then reuse it for single codes and bulk runs.'),
        templates.length ? h('div', { class: 'grid cols-4' }, templates.map(t => h('div', { class: 'card flat code-card' },
          h('div', { class: 'qr-thumb', html: safeSvg(t.style) }), h('b', {}, t.name),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { const n = await promptDialog({ title: 'Rename template', label: 'Name', value: t.name }); if (n?.trim()) { await api('PATCH', `/api/templates/${t.id}`, { name: n.trim() }); load(); } } }, 'Rename'),
            h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Delete template “${t.name}”?`, { ok: 'Delete', danger: true })) { await api('DELETE', `/api/templates/${t.id}`); load(); } } }, 'Delete'))))) : h('p', { class: 'muted' }, 'No templates yet.')));
  }
  const safeSvg = style => { try { return svgFor('https://example.com', style, 200); } catch { return ''; } };
  function list(items, path, label, empty, withDesc = false) {
    if (!items.length) return h('p', { class: 'muted' }, empty);
    return h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, items.map(i => h('tr', {}, h('td', {}, label(i)),
      h('td', { class: 'num' }, h('button', { class: 'btn sm', onclick: async () => {
        const n = await promptDialog({ title: 'Rename', label: 'Name', value: i.name });
        if (!n?.trim()) return;
        const body = { name: n.trim() };
        if (withDesc) { const d = await promptDialog({ title: 'Description (optional)', label: 'Description', value: i.description || '' }); if (d !== null) body.description = d; }
        try { await api('PATCH', `/api/${path}/${i.id}`, body); load(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Rename'), ' ', h('button', { class: 'btn sm danger', onclick: async () => {
        if (await confirmDialog(`Delete “${i.name}”? Codes inside are kept.`, { ok: 'Delete', danger: true })) { await api('DELETE', `/api/${path}/${i.id}`); load(); }
      } }, 'Delete'))))))); 
  }
  async function add(path, title, withDesc) {
    const name = await promptDialog({ title, label: 'Name', ok: 'Create' });
    if (!name?.trim()) return;
    const body = { name: name.trim() };
    if (withDesc) body.description = (await promptDialog({ title: 'Description (optional)', label: 'What is this campaign for?', ok: 'Save' })) || '';
    try { await api('POST', `/api/${path}`, body); load(); } catch (e) { toast(e.message, 'bad'); }
  }
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Folders, campaigns & templates'), h('p', {}, 'Keep your codes organized and your branding consistent.'))), box);
  await load();
}
