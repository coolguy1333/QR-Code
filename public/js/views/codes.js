import { h, mount, toast, confirmDialog, copyText, debounce, fmtNum, ago, promptDialog } from '../ui.js';
import { api, qs, state, refreshMe } from '../app.js';
import { TYPES } from '../qr-content.js';
import { makeZip, safeName, saveBlob } from '../export.js';
import { select, pager, statusBadge, typeLabel, TYPE_ICON, loadMeta } from './shared.js';

export default async function render(root, { query }) {
  const meta = await loadMeta();
  const F = { q: query.q || '', type: '', dynamic: '', status: '', folder: query.folder || '', campaign: query.campaign || '', sort: 'created', dir: 'desc', page: 1 };
  const selected = new Set();
  const list = h('div');
  const bar = h('div', { class: 'toolbar', hidden: true });
  let data = null;

  const load = async () => {
    mount(list, h('div', { class: 'spinner' }));
    try { data = await api('GET', `/api/codes${qs({ ...F, limit: 24 })}`); } catch (e) { mount(list, h('div', { class: 'alert bad' }, e.message)); return; }
    draw();
  };
  const reload = () => { selected.clear(); load(); };

  function draw() {
    drawBar();
    if (!data.items.length) {
      mount(list, h('div', { class: 'empty card' }, h('h3', {}, data.total === 0 && !hasFilters() ? 'No QR codes yet' : 'No codes match your filters'),
        h('p', {}, hasFilters() ? 'Try clearing a filter.' : 'Create your first code — it takes under a minute.'),
        hasFilters() ? h('button', { class: 'btn', onclick: () => { Object.assign(F, { q: '', type: '', dynamic: '', status: '', folder: '', campaign: '' }); location.hash = '#/codes'; render(root, { query: {} }); } }, 'Clear filters') : h('a', { class: 'btn primary', href: '#/' }, 'Create a QR code')));
      return;
    }
    mount(list, 
      h('div', { class: 'grid cols-4' }, data.items.map(card)),
      pager(data.page, data.pages, p => { F.page = p; selected.clear(); load(); }));
  }
  const hasFilters = () => F.q || F.type || F.dynamic || F.status || F.folder || F.campaign;

  function card(c) {
    const check = h('input', { type: 'checkbox', checked: selected.has(c.id), 'aria-label': `Select ${c.name}`, onchange: e => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); drawBar(); } });
    return h('div', { class: 'card code-card' },
      h('div', { class: 'row between' }, h('label', { class: 'check', style: { margin: 0 } }, check), h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'badge' }, TYPE_ICON[c.type], ' ', typeLabel(c.type)), statusBadge(c))),
      h('a', { class: 'cover', href: `#/codes/${c.id}` }, h('img', { class: 'qr-thumb', loading: 'lazy', alt: `QR code for ${c.name}`, src: `/api/codes/${c.id}/image/svg?size=300&v=${c.updatedAt}` })),
      h('div', {}, h('h3', { title: c.name }, h('a', { class: 'cover', href: `#/codes/${c.id}` }, c.name)),
        h('small', { class: 'muted' }, c.dynamic ? `${fmtNum(c.scanCount)} scans · ` : '', ago(c.createdAt))),
      h('div', { class: 'row' },
        h('a', { class: 'btn sm', href: `#/codes/${c.id}` }, 'Open'), h('a', { class: 'btn sm', href: `#/codes/${c.id}/edit` }, 'Edit'),
        c.shortUrl ? h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(c.shortUrl, 'Short link copied') }, 'Copy link') : null,
        h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
          if (!(await confirmDialog(`Delete “${c.name}”? ${c.dynamic ? 'Printed copies will stop working.' : ''}`, { ok: 'Delete', danger: true }))) return;
          try { await api('DELETE', `/api/codes/${c.id}`); toast('Deleted'); refreshMe(); reload(); } catch (e) { toast(e.message, 'bad'); }
        } }, 'Delete')));
  }

  function drawBar() {
    bar.hidden = selected.size === 0;
    if (!selected.size) return;
    const ids = [...selected];
    const patchAll = async (body, msg) => {
      try { await Promise.all(ids.map(id => api('PATCH', `/api/codes/${id}`, body))); toast(msg, 'good'); reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    mount(bar, h('b', {}, `${selected.size} selected`),
      select([['', 'Move to folder…'], ['none', 'No folder'], ...meta.folders.map(f => [f.id, f.name])], '', v => v && patchAll({ folderId: v === 'none' ? null : Number(v) }, 'Moved')),
      select([['', 'Add to campaign…'], ['none', 'No campaign'], ...meta.campaigns.map(f => [f.id, f.name])], '', v => v && patchAll({ campaignId: v === 'none' ? null : Number(v) }, 'Updated')),
      h('button', { class: 'btn sm', onclick: async () => {
        try {
          const files = [];
          for (const id of ids) {
            const c = data.items.find(x => x.id === id);
            const r = await api('GET', `/api/codes/${id}/image/png?size=1024`, undefined, { raw: true });
            if (r.ok) files.push({ name: `${safeName(c.name)}-${id}.png`, data: new Uint8Array(await r.arrayBuffer()) });
          }
          saveBlob(makeZip(files), 'qr-codes.zip');
        } catch (e) { toast(e.message, 'bad'); }
      } }, '⬇ Download ZIP'),
      h('button', { class: 'btn sm danger', onclick: async () => {
        if (!(await confirmDialog(`Delete ${ids.length} code(s)? This cannot be undone.`, { ok: 'Delete', danger: true }))) return;
        try { await Promise.all(ids.map(id => api('DELETE', `/api/codes/${id}`))); toast('Deleted'); refreshMe(); reload(); } catch (e) { toast(e.message, 'bad'); }
      } }, 'Delete'),
      h('button', { class: 'btn sm', onclick: () => { selected.clear(); draw(); } }, 'Clear'));
  }

  const search = h('input', { class: 'input search', type: 'search', placeholder: 'Search by name or link…', value: F.q, 'aria-label': 'Search', oninput: debounce(e => { F.q = e.target.value; F.page = 1; reload(); }, 250) });
  const filters = h('div', { class: 'toolbar' }, search,
    select([['', 'All types'], ...Object.entries(TYPES).map(([k, t]) => [k, t.label])], F.type, v => { F.type = v; F.page = 1; reload(); }),
    select([['', 'Static & dynamic'], ['0', 'Static only'], ['1', 'Dynamic only']], F.dynamic, v => { F.dynamic = v; F.page = 1; reload(); }),
    select([['', 'Any status'], ['active', 'Active'], ['paused', 'Paused'], ['blocked', 'Blocked']], F.status, v => { F.status = v; F.page = 1; reload(); }),
    select([['', 'All folders'], ['none', 'No folder'], ...meta.folders.map(f => [f.id, f.name])], F.folder, v => { F.folder = v; F.page = 1; reload(); }),
    select([['', 'All campaigns'], ['none', 'No campaign'], ...meta.campaigns.map(f => [f.id, f.name])], F.campaign, v => { F.campaign = v; F.page = 1; reload(); }),
    select([['created', 'Newest'], ['scans', 'Most scanned'], ['name', 'Name'], ['updated', 'Recently edited']], F.sort, v => { F.sort = v; F.dir = v === 'name' ? 'asc' : 'desc'; reload(); }));

  const lim = state.limits;
  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'My QR codes'), h('p', {}, lim ? `${fmtNum(lim.codeCount)} of ${lim.maxCodes ? fmtNum(lim.maxCodes) : 'unlimited'} codes used` : '')),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/organize' }, 'Folders & campaigns'), h('a', { class: 'btn primary', href: '#/' }, '+ New QR code'))),
    filters, bar, list);
  await load();
}
void promptDialog;
