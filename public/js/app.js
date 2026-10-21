import { h, mount, $, toast } from './ui.js';

export const state = { user: null, config: { siteName: 'QR Studio', registration: 'open' }, limits: null };

export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

export async function api(method, path, body, { raw = false, headers = {} } = {}) {
  const init = { method, headers: { 'X-Requested-With': 'qr-studio', ...headers }, credentials: 'same-origin' };
  if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, init); } catch { throw new ApiError('Cannot reach the server. Check your connection.', 0); }
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; renderTopbar(); toast('Your session ended. Please sign in again.', 'bad'); location.hash = '#/login'; }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}
export const qs = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
export const tzOffset = () => -new Date().getTimezoneOffset();

export async function refreshMe() {
  const cfg = await api('GET', '/api/config');
  state.config = cfg;
  state.user = cfg.user;
  if (cfg.user) { try { state.limits = (await api('GET', '/api/me')).limits; } catch { /* ignore */ } } else state.limits = null;
  document.title = `${cfg.siteName} — free QR code generator`;
  const a = $('#announce');
  if (cfg.announcement) { a.textContent = cfg.announcement; a.hidden = false; } else a.hidden = true;
  renderTopbar();
}

// ---------- routes ----------
const routes = [
  [/^\/?$/, () => import('./views/generator.js')],
  [/^\/scan$/, () => import('./views/scanner.js')],
  [/^\/login$/, () => import('./views/auth.js'), { mode: 'login' }],
  [/^\/register$/, () => import('./views/auth.js'), { mode: 'register' }],
  [/^\/dashboard$/, () => import('./views/dashboard.js'), { auth: true }],
  [/^\/codes$/, () => import('./views/codes.js'), { auth: true }],
  [/^\/codes\/(\d+)$/, () => import('./views/code-detail.js'), { auth: true }],
  [/^\/codes\/(\d+)\/edit$/, () => import('./views/generator.js'), { auth: true, edit: true }],
  [/^\/bulk$/, () => import('./views/bulk.js'), { auth: true }],
  [/^\/organize$/, () => import('./views/organize.js'), { auth: true }],
  [/^\/domains$/, () => import('./views/domains.js'), { auth: true }],
  [/^\/developers$/, () => import('./views/developers.js'), { auth: true }],
  [/^\/account$/, () => import('./views/account.js'), { auth: true }],
  [/^\/admin(?:\/([a-z]+))?(?:\/(\d+))?$/, () => import('./views/admin.js'), { auth: true, admin: true }],
];

let cleanup = null;
let navToken = 0;

function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(query || '')) };
}

async function route() {
  const token = ++navToken;
  const { path, query } = currentPath();
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  const main = $('#main');
  let match = null;
  for (const r of routes) { const m = r[0].exec(path); if (m) { match = { m, loader: r[1], opts: r[2] || {} }; break; } }
  renderTopbar();
  if (!match) { mount(main, h('div', { class: 'empty' }, h('h3', {}, 'Page not found'), h('a', { class: 'btn primary', href: '#/' }, 'Back to the generator'))); return; }
  if (match.opts.auth && !state.user) { location.replace(`#/login?next=${encodeURIComponent(path)}`); return; }
  if (match.opts.admin && state.user?.role !== 'admin') { mount(main, h('div', { class: 'empty' }, h('h3', {}, 'Administrators only'))); return; }
  mount(main, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }));
  try {
    const mod = await match.loader();
    if (token !== navToken) return;
    const root = h('div');
    mount(main, root);
    cleanup = (await mod.default(root, { params: match.m.slice(1), query, opts: match.opts, path })) || null;
  } catch (e) {
    if (token !== navToken) return;
    console.error(e);
    mount(main, h('div', { class: 'empty' }, h('h3', {}, 'Something went wrong'), h('p', {}, e.message), h('button', { class: 'btn', onclick: route }, 'Try again')));
  }
  if (token === navToken) { window.scrollTo(0, 0); }
}

// ---------- chrome ----------
const THEME_KEY = 'qr-theme';
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } }
function cycleTheme() {
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[getTheme()];
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  applyTheme(next);
  toast(`Theme: ${next}`);
}

let menuOpen = false;
export function renderTopbar() {
  const { path } = currentPath();
  const link = (href, label) => h('a', { href: `#${href}`, 'aria-current': (href === '/' ? path === '/' : path === href || path.startsWith(href + '/')) ? 'page' : null }, label);
  const u = state.user;
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' },
    link('/', 'Create'),
    u ? [link('/codes', 'My codes'), link('/dashboard', 'Analytics'), link('/bulk', 'Bulk')] : null,
    link('/scan', 'Scan'),
    u?.role === 'admin' ? link('/admin', 'Admin') : null);
  const right = h('div', { class: 'nav-right' },
    h('button', { class: 'btn icon', title: 'Switch theme', 'aria-label': 'Switch theme', style: { fontSize: '1.15rem' }, onclick: cycleTheme }, '◐'),
    u ? userMenu(u) : [h('a', { class: 'btn', href: '#/login' }, 'Sign in'), state.config.registration !== 'closed' ? h('a', { class: 'btn primary', href: '#/register' }, 'Sign up free') : null]);
  mount($('#topbar'), h('a', { class: 'brand', href: '#/' }, h('img', { src: '/favicon.svg', alt: '' }), state.config.siteName), nav, right);
}

function userMenu(u) {
  const wrap = h('div', { class: 'menu' });
  const btn = h('button', { class: 'btn', 'aria-haspopup': 'true', 'aria-expanded': String(menuOpen), onclick: e => { e.stopPropagation(); menuOpen = !menuOpen; renderTopbar(); } }, u.name.split(' ')[0], ' ▾');
  wrap.append(btn);
  if (menuOpen) {
    wrap.append(h('div', { class: 'menu-pop', role: 'menu' },
      h('div', { style: { padding: '8px 12px' } }, h('b', {}, u.name), h('br'), h('small', {}, u.email)),
      h('hr'),
      h('a', { href: '#/organize' }, 'Folders, campaigns & templates'),
      h('a', { href: '#/domains' }, 'Custom domains'),
      h('a', { href: '#/developers' }, 'API & integrations'),
      h('a', { href: '#/account' }, 'Account settings'),
      h('hr'),
      h('button', { onclick: async () => { try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ } state.user = null; state.limits = null; menuOpen = false; renderTopbar(); location.hash = '#/'; toast('Signed out'); } }, 'Sign out')));
  }
  return wrap;
}
document.addEventListener('click', () => { if (menuOpen) { menuOpen = false; renderTopbar(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) { menuOpen = false; renderTopbar(); } });

applyTheme(getTheme());
window.addEventListener('hashchange', route);
refreshMe().catch(e => toast(e.message, 'bad')).finally(route);
