import { h, mount, toast, confirmDialog, dialog, promptDialog, debounce, fmtNum, fmtBytes, fmtDate, fmtDateTime, ago } from '../ui.js';
import { api, qs, state, tzOffset, refreshMe } from '../app.js';
import { TYPES } from '../qr-content.js';
import { field, select, pager, statusBadge, typeLabel, copyLine } from './shared.js';
import { statsPanel, tile, RANGES } from './analytics.js';

const SECTIONS = [['', 'Overview'], ['users', 'Users'], ['codes', 'All codes'], ['reports', 'Reports'], ['domains', 'Domains'], ['settings', 'Settings'], ['audit', 'Audit log']];

export default async function render(root, { params, query }) {
  const section = params[0] || '';
  const id = params[1] ? Number(params[1]) : null;
  const body = h('div');
  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Administration'), h('p', {}, `Signed in as ${state.user.email}`))),
    h('div', { class: 'tabs', role: 'tablist', style: { marginBottom: '18px', display: 'inline-flex', maxWidth: '100%' } },
      SECTIONS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === section), onclick: () => { location.hash = `#/admin${k ? '/' + k : ''}`; } }, l))),
    body);
  const views = { '': overview, users: id ? userDetail : users, codes, reports, domains, settings, audit };
  const view = views[section];
  if (!view) { mount(body, h('div', { class: 'empty' }, h('h3', {}, 'Unknown section'))); return; }
  await view(body, id, query);
}

const roleBadge = r => h('span', { class: `badge ${r === 'admin' ? 'accent' : ''}` }, r === 'admin' ? 'Admin' : 'Member');
const userStatus = s => h('span', { class: `badge ${s === 'active' ? 'good' : s === 'pending' ? 'warn' : 'bad'}` }, s[0].toUpperCase() + s.slice(1));

// ---------------------------------------------------------------- overview
async function overview(box) {
  let days = 30;
  const stats = h('div');
  const top = h('div');
  async function load() {
    const o = await api('GET', `/api/admin/overview${qs({ days, tz: tzOffset() })}`);
    mount(top, 
      h('div', { class: 'grid cols-4 keep2' },
        tile(o.users.total, 'Users', `${o.users.active} active · ${o.users.pending} pending · ${o.users.suspended} suspended`),
        tile(o.codes.total, 'QR codes', `${o.codes.dynamic} dynamic · ${o.codes.total - o.codes.dynamic} static`),
        tile(o.scans.d7, 'Scans, last 7 days', `${fmtNum(o.scans.d30)} in 30 days · ${fmtNum(o.scans.total)} total`),
        tile(fmtBytes(o.storage.bytes), 'Hosted files', `${o.storage.files} files`)),
      o.users.pending ? h('div', { class: 'alert warn', style: { marginTop: '14px' } }, `${o.users.pending} account(s) waiting for approval. `, h('a', { href: '#/admin/users' }, 'Review')) : null,
      o.openReports ? h('div', { class: 'alert bad', style: { marginTop: '14px' } }, `${o.openReports} open abuse report(s). `, h('a', { href: '#/admin/reports' }, 'Review')) : null,
      h('div', { class: 'card', style: { marginTop: '16px' } }, h('h3', {}, 'Newest users'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, o.recentUsers.map(u => h('tr', {}, h('td', {}, h('a', { href: `#/admin/users/${u.id}` }, u.name), h('br'), h('small', { class: 'muted' }, u.email)), h('td', {}, userStatus(u.status)), h('td', { class: 'num' }, ago(u.createdAt)))))))));
    mount(stats, h('div', { class: 'row between', style: { margin: '18px 0 10px' } }, h('h2', { style: { margin: 0 } }, 'Traffic across the site'), select(RANGES, days, v => { days = Number(v); load(); })), statsPanel(o.stats, { topCodes: true }));
  }
  mount(box, top, stats);
  await load();
}

// ---------------------------------------------------------------- users
async function users(box) {
  const F = { q: '', status: '', role: '', sort: 'created', dir: 'desc', page: 1 };
  const table = h('div');
  async function load() {
    const r = await api('GET', `/api/admin/users${qs(F)}`);
    const th = (label, key) => h('th', { class: 'sortable', onclick: () => { F.dir = F.sort === key && F.dir === 'desc' ? 'asc' : 'desc'; F.sort = key; load(); } }, label, F.sort === key ? (F.dir === 'asc' ? ' ▲' : ' ▼') : '');
    mount(table, 
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, th('User', 'email'), h('th', {}, 'Role'), h('th', {}, 'Status'), th('Codes', 'codes'), h('th', { class: 'num' }, 'Scans'), th('Last sign-in', 'login'), th('Joined', 'created'), h('th', {}, ''))),
        h('tbody', {}, r.items.length ? r.items.map(u => h('tr', {},
          h('td', {}, h('a', { href: `#/admin/users/${u.id}` }, h('b', {}, u.name)), h('br'), h('small', { class: 'muted' }, u.email)), h('td', {}, roleBadge(u.role)), h('td', {}, userStatus(u.status)),
          h('td', { class: 'num' }, fmtNum(u.codes)), h('td', { class: 'num' }, fmtNum(u.scans)), h('td', {}, u.lastLoginAt ? ago(u.lastLoginAt) : 'never'), h('td', {}, fmtDate(u.createdAt)),
          h('td', { class: 'num' }, u.status === 'pending' ? h('button', { class: 'btn sm primary', onclick: async () => { await api('PATCH', `/api/admin/users/${u.id}`, { status: 'active' }); toast('Approved', 'good'); load(); } }, 'Approve') : h('a', { class: 'btn sm', href: `#/admin/users/${u.id}` }, 'Manage')))) : h('tr', {}, h('td', { colspan: 8, class: 'empty' }, 'No users match.'))))),
      pager(r.page, r.pages, p => { F.page = p; load(); }),
      h('p', { class: 'muted', style: { textAlign: 'center' } }, `${fmtNum(r.total)} user${r.total === 1 ? '' : 's'}`));
  }
  async function create() {
    const email = h('input', { class: 'input', type: 'email', required: true }), name = h('input', { class: 'input' }), pw = h('input', { class: 'input', value: '' }), role = select([['user', 'Member'], ['admin', 'Administrator']], 'user', () => {});
    const err = h('div', { class: 'alert bad', hidden: true });
    pw.value = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    await dialog({
      title: 'Add a user', body: h('div', {}, field('Email', email), field('Name', name), field('Password', pw, 'Share it with them securely; they can change it after signing in.'), field('Role', role), err),
      actions: close => [h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
        try { await api('POST', '/api/admin/users', { email: email.value, name: name.value, password: pw.value, role: role.value }); toast('User created', 'good'); close(true); load(); } catch (e) { err.textContent = e.message; err.hidden = false; }
      } }, 'Create user')],
    });
  }
  mount(box,
    h('div', { class: 'toolbar' }, h('input', { class: 'input search', type: 'search', placeholder: 'Search name or email…', 'aria-label': 'Search users', oninput: debounce(e => { F.q = e.target.value; F.page = 1; load(); }, 250) }),
      select([['', 'Any status'], ['active', 'Active'], ['pending', 'Pending'], ['suspended', 'Suspended']], '', v => { F.status = v; F.page = 1; load(); }),
      select([['', 'Any role'], ['admin', 'Administrators'], ['user', 'Members']], '', v => { F.role = v; F.page = 1; load(); }),
      h('button', { class: 'btn primary', onclick: create }, '+ Add user')), table);
  await load();
}

async function userDetail(box, id) {
  const r = await api('GET', `/api/admin/users/${id}${qs({ tz: tzOffset() })}`);
  const u = r.user;
  const name = h('input', { class: 'input', value: u.name }), email = h('input', { class: 'input', type: 'email', value: u.email }), notes = h('textarea', { class: 'input', value: u.notes || '' });
  const role = select([['user', 'Member'], ['admin', 'Administrator']], u.role, () => {});
  const status = select([['active', 'Active'], ['pending', 'Pending approval'], ['suspended', 'Suspended']], u.status, () => {});
  const max = h('input', { class: 'input', type: 'number', min: 0, placeholder: 'Site default', value: u.maxCodes ?? '' });
  const me = u.id === state.user.id;
  mount(box,
    h('p', {}, h('a', { href: '#/admin/users' }, '← All users')),
    h('div', { class: 'page-head' }, h('div', {}, h('h2', { style: { margin: 0 } }, u.name), h('div', { class: 'row', style: { marginTop: '6px' } }, roleBadge(u.role), userStatus(u.status), h('small', { class: 'muted' }, `Joined ${fmtDate(u.createdAt)} · last sign-in ${u.lastLoginAt ? ago(u.lastLoginAt) : 'never'}`))),
      h('a', { class: 'btn', href: `#/admin/codes?userId=${u.id}` }, 'View their codes')),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, 'Account'),
          h('div', { class: 'two' }, field('Name', name), field('Email', email)),
          h('div', { class: 'two' }, field('Role', role), field('Status', status, me ? 'You cannot lock yourself out.' : null)),
          field('QR code limit', max, `Empty uses the site default. 0 means unlimited. Currently ${r.limits.maxCodes ? fmtNum(r.limits.maxCodes) : 'unlimited'}.`),
          field('Private admin notes', notes),
          h('button', { class: 'btn primary', onclick: async () => {
            try { await api('PATCH', `/api/admin/users/${id}`, { name: name.value, email: email.value, role: role.value, status: status.value, notes: notes.value, maxCodes: max.value === '' ? null : Number(max.value) }); toast('Saved', 'good'); if (me) await refreshMe(); location.reload(); } catch (e) { toast(e.message, 'bad'); }
          } }, 'Save changes')),
        h('div', { class: 'card' }, h('h3', {}, 'Security'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: async () => {
              if (!(await confirmDialog(`Generate a new password for ${u.email}? They will be signed out everywhere.`, { ok: 'Reset password' }))) return;
              try { const p = await api('POST', `/api/admin/users/${id}/reset-password`, {}); await dialog({ title: 'New temporary password', body: h('div', {}, h('div', { class: 'alert warn' }, 'Copy it now and share it securely. It will not be shown again.'), copyLine(p.password)), actions: close => [h('button', { class: 'btn primary', onclick: () => close(true) }, 'Done')] }); } catch (e) { toast(e.message, 'bad'); }
            } }, 'Reset password'),
            h('button', { class: 'btn', onclick: async () => { await api('POST', `/api/admin/users/${id}/logout`); toast('Signed out everywhere', 'good'); } }, 'Sign out everywhere')),
          h('p', { class: 'muted', style: { marginTop: '12px' } }, `${r.sessions.length} active session(s) · ${r.keys.length} API key(s)`)),
        h('div', { class: 'card' }, h('h3', { style: { color: 'var(--bad)' } }, 'Danger zone'), h('p', { class: 'muted' }, 'Deleting a user removes their account, QR codes, analytics and uploaded files permanently.'),
          h('button', { class: 'btn danger', disabled: me, onclick: async () => {
            if (!(await confirmDialog(`Permanently delete ${u.email} and all their data?`, { ok: 'Delete user', danger: true }))) return;
            try { await api('DELETE', `/api/admin/users/${id}`); toast('User deleted'); location.hash = '#/admin/users'; } catch (e) { toast(e.message, 'bad'); }
          } }, 'Delete user'))),
      h('div', { class: 'stack' },
        h('div', { class: 'grid cols-2 keep2' }, tile(r.limits.codeCount, 'QR codes'), tile(fmtBytes(r.limits.storageUsed), 'Storage used')),
        h('div', { class: 'card' }, h('h3', {}, 'Scans of their codes · 30 days'), h('p', { style: { fontSize: '1.6rem', fontWeight: 700, margin: 0 } }, fmtNum(r.stats.total)), h('small', { class: 'muted' }, `${fmtNum(r.stats.unique)} unique visitors`)))));
}

// ---------------------------------------------------------------- codes
async function codes(box, _id, query) {
  const F = { q: '', type: '', status: '', userId: query.userId || '', page: 1 };
  const table = h('div');
  async function load() {
    const r = await api('GET', `/api/admin/codes${qs(F)}`);
    mount(table, h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Name', 'Owner', 'Type', 'Status', 'Scans', 'Created', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, r.items.length ? r.items.map(c => h('tr', {},
        h('td', {}, h('b', {}, c.name), c.shortUrl ? [h('br'), h('small', { class: 'muted' }, c.shortUrl)] : null), h('td', {}, c.ownerEmail), h('td', {}, typeLabel(c.type)), h('td', {}, statusBadge(c)),
        h('td', { class: 'num' }, fmtNum(c.scanCount)), h('td', {}, fmtDate(c.createdAt)),
        h('td', { class: 'num' }, c.dynamic ? h('button', { class: 'btn sm', onclick: async () => { await api('PATCH', `/api/admin/codes/${c.id}`, { status: c.status === 'blocked' ? 'active' : 'blocked' }); load(); } }, c.status === 'blocked' ? 'Unblock' : 'Block') : null, ' ',
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Delete “${c.name}” owned by ${c.ownerEmail}?`, { ok: 'Delete', danger: true })) { await api('DELETE', `/api/admin/codes/${c.id}`); load(); } } }, 'Delete')))) : h('tr', {}, h('td', { colspan: 7, class: 'empty' }, 'No codes found.'))))),
      pager(r.page, r.pages, p => { F.page = p; load(); }), h('p', { class: 'muted', style: { textAlign: 'center' } }, `${fmtNum(r.total)} code${r.total === 1 ? '' : 's'}`));
  }
  mount(box, F.userId ? h('div', { class: 'alert info' }, `Showing codes of user #${F.userId}. `, h('a', { href: '#/admin/codes' }, 'Show everyone')) : null,
    h('div', { class: 'toolbar' }, h('input', { class: 'input search', type: 'search', placeholder: 'Search name or short link…', 'aria-label': 'Search codes', oninput: debounce(e => { F.q = e.target.value; F.page = 1; load(); }, 250) }),
      select([['', 'All types'], ...Object.entries(TYPES).map(([k, t]) => [k, t.label])], '', v => { F.type = v; F.page = 1; load(); }),
      select([['', 'Any status'], ['active', 'Active'], ['paused', 'Paused'], ['blocked', 'Blocked']], '', v => { F.status = v; F.page = 1; load(); })), table);
  await load();
}

// ---------------------------------------------------------------- reports
async function reports(box) {
  let status = 'open';
  const list = h('div');
  async function load() {
    const { items } = await api('GET', `/api/admin/reports${qs({ status })}`);
    mount(list, items.length ? items.map(r => h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'row between' }, h('div', {}, h('b', {}, r.name), ' ', h('code', {}, `/${r.slug}`), ' ', h('span', { class: 'badge' }, typeLabel(r.type)), r.code_status === 'blocked' ? h('span', { class: 'badge bad' }, 'Blocked') : null), h('small', { class: 'muted' }, ago(r.created_at))),
      h('p', { style: { margin: '10px 0', whiteSpace: 'pre-wrap' } }, r.reason), h('small', { class: 'muted' }, `Owner: ${r.owner_email}`),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        status === 'open' ? [h('button', { class: 'btn sm danger', onclick: async () => { await api('PATCH', `/api/admin/reports/${r.id}`, { status: 'closed', blockCode: true }); toast('Code blocked', 'good'); load(); } }, 'Block code & close'),
          h('button', { class: 'btn sm', onclick: async () => { await api('PATCH', `/api/admin/reports/${r.id}`, { status: 'closed' }); load(); } }, 'Dismiss')] : h('button', { class: 'btn sm', onclick: async () => { await api('PATCH', `/api/admin/reports/${r.id}`, { status: 'open' }); load(); } }, 'Reopen'),
        h('a', { class: 'btn sm', href: `/${r.slug}`, target: '_blank', rel: 'noopener' }, 'Open page ↗')))) : h('div', { class: 'empty card' }, h('h3', {}, status === 'open' ? 'No open reports 🎉' : 'Nothing here')));
  }
  mount(box, h('div', { class: 'toolbar' }, select([['open', 'Open reports'], ['closed', 'Closed reports']], status, v => { status = v; load(); })), list);
  await load();
}

// ---------------------------------------------------------------- domains
async function domains(box) {
  const list = h('div');
  async function load() {
    const { items } = await api('GET', '/api/admin/domains');
    mount(list, h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Domain', 'Owner', 'Status', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, items.length ? items.map(d => h('tr', {}, h('td', {}, h('b', {}, d.host)), h('td', {}, d.global ? 'Site-wide' : d.ownerEmail), h('td', {}, d.verified ? h('span', { class: 'badge good' }, 'Verified') : h('span', { class: 'badge warn' }, 'Unverified')),
        h('td', { class: 'num' }, h('button', { class: 'btn sm', onclick: async () => { await api('PATCH', `/api/admin/domains/${d.id}`, { verified: !d.verified }); load(); } }, d.verified ? 'Unverify' : 'Mark verified'), ' ',
          h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(`Remove ${d.host}?`, { ok: 'Remove', danger: true })) { await api('DELETE', `/api/admin/domains/${d.id}`); load(); } } }, 'Remove')))) : h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'No domains yet.'))))));
  }
  mount(box,
    h('div', { class: 'alert info' }, 'Site-wide domains are available to every user. Point the domain at this server (or add it as an alias of this site in WebManager) — any path then resolves short links, while the dashboard and API stay on the main address.'),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', onclick: async () => {
      const host = await promptDialog({ title: 'Add a site-wide domain', label: 'Domain', hint: 'e.g. qr.example.com', ok: 'Add' });
      if (!host?.trim()) return;
      try { await api('POST', '/api/admin/domains', { host }); toast('Domain added', 'good'); load(); } catch (e) { toast(e.message, 'bad'); }
    } }, '+ Add domain')), list);
  await load();
}

// ---------------------------------------------------------------- settings
async function settings(box) {
  const { settings: s } = await api('GET', '/api/admin/settings');
  const v = { ...s };
  const num = (key, label, hint) => field(label, h('input', { class: 'input', type: 'number', min: 0, value: v[key], oninput: e => { v[key] = Number(e.target.value); } }), hint);
  mount(box, h('div', { class: 'card', style: { maxWidth: '760px' } },
    h('h2', {}, 'Site settings'),
    field('Site name', h('input', { class: 'input', value: v.siteName, maxlength: 60, oninput: e => { v.siteName = e.target.value; } })),
    field('Registration', select([['open', 'Open — anyone can sign up'], ['approval', 'Approval — new accounts wait for an admin'], ['closed', 'Closed — admins add users']], v.registration, x => { v.registration = x; })),
    field('Announcement banner', h('input', { class: 'input', value: v.announcement, maxlength: 300, placeholder: 'Shown at the top of every page. Leave empty for none.', oninput: e => { v.announcement = e.target.value; } })),
    h('div', { class: 'two' }, num('defaultMaxCodes', 'Default QR code limit per user', '0 means unlimited. Per-user overrides are on each user page.'), num('maxBulk', 'Rows per bulk run', 'Maximum codes created in one bulk request.')),
    h('div', { class: 'two' }, num('maxStorageMB', 'Hosted file storage per user (MB)', '0 means unlimited.'), num('scanRetentionDays', 'Keep scan analytics for (days)', '0 keeps them forever.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.allowUserDomains, onchange: e => { v.allowUserDomains = e.target.checked; } }), 'Let users add their own custom short domains'),
    field('Blocked destination websites', h('textarea', { class: 'input', rows: 4, placeholder: 'one domain per line, e.g. bad.example', value: v.blockedHosts, oninput: e => { v.blockedHosts = e.target.value; } }), 'Dynamic codes cannot point to these sites (subdomains included). Existing codes pointing there show a “blocked” page.'),
    h('button', { class: 'btn primary', onclick: async () => { try { await api('PUT', '/api/admin/settings', v); await refreshMe(); toast('Settings saved', 'good'); } catch (e) { toast(e.message, 'bad'); } } }, 'Save settings')));
}

// ---------------------------------------------------------------- audit
async function audit(box) {
  let page = 1;
  const table = h('div');
  async function load() {
    const r = await api('GET', `/api/admin/audit${qs({ page, limit: 50 })}`);
    mount(table, h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'Target', 'Detail'].map(x => h('th', {}, x)))),
      h('tbody', {}, r.items.map(a => h('tr', {}, h('td', { style: { whiteSpace: 'nowrap' } }, fmtDateTime(a.ts)), h('td', {}, a.actor), h('td', {}, h('code', {}, a.action)), h('td', {}, a.target), h('td', { style: { maxWidth: '320px', overflowWrap: 'anywhere' } }, a.detail)))))),
      pager(r.page, r.pages, p => { page = p; load(); }));
  }
  mount(box, table);
  await load();
}
