import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'qr-test-'));
let proc;

class Client {
  constructor() { this.cookie = ''; this.key = ''; }
  async req(method, path, body, { raw = false, headers = {}, noXrw = false } = {}) {
    const h = { ...headers };
    if (!noXrw) h['X-Requested-With'] = 'qr-studio';
    if (this.cookie) h.Cookie = this.cookie;
    if (this.key) h.Authorization = `Bearer ${this.key}`;
    let payload = body;
    if (body !== undefined && !(body instanceof Buffer) && typeof body !== 'string') { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) { const [kv] = c.split(';'); const [k, v] = kv.split('='); this.cookie = this.cookie.split('; ').filter(x => x && !x.startsWith(k + '=')).concat(v ? [`${k}=${v}`] : []).join('; '); }
    if (raw) return res;
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b, o) { return this.req('POST', p, b ?? {}, o); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p, b) { return this.req('DELETE', p, b ?? {}); }
}

before(async () => {
  proc = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, HOST: '127.0.0.1', PUBLIC_URL: '', ADMIN_EMAILS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* wait */ } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc?.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); });

const admin = new Client(), alice = new Client(), anon = new Client();
const pw = 'correct horse battery';

test('first user becomes admin; open registration afterwards', async () => {
  const cfg = await anon.get('/api/config');
  assert.equal(cfg.json.firstRun, true);
  const r = await admin.post('/api/auth/register', { email: 'root@example.com', name: 'Root', password: pw });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'admin');
  assert.equal((await anon.post('/api/auth/register', { email: 'x@example.com', password: pw })).status, 403, 'registration is closed by default');
  await admin.req('PUT', '/api/admin/settings', { registration: 'open' });
  const a = await alice.post('/api/auth/register', { email: 'alice@example.com', name: 'Alice', password: pw });
  assert.equal(a.json.user.role, 'user');
  assert.equal((await anon.post('/api/auth/register', { email: 'bad', password: pw })).status, 400);
  assert.equal((await anon.post('/api/auth/register', { email: 'alice@example.com', password: pw })).status, 409);
  assert.equal((await anon.post('/api/auth/register', { email: 'x@example.com', password: 'short' })).status, 400);
});

test('CSRF header and auth are required', async () => {
  assert.equal((await alice.req('POST', '/api/codes', {}, { noXrw: true })).status, 403);
  assert.equal((await anon.post('/api/codes', {})).status, 401);
  assert.equal((await anon.get('/api/admin/overview')).status, 401);
  assert.equal((await alice.get('/api/admin/overview')).status, 403);
});

test('login / logout', async () => {
  const c = new Client();
  assert.equal((await c.post('/api/auth/login', { email: 'alice@example.com', password: 'nope-nope' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'ALICE@example.com', password: pw })).status, 200);
  assert.equal((await c.get('/api/me')).json.user.email, 'alice@example.com');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).status, 401);
});

let staticCode, dynCode;
test('static code create + validation', async () => {
  const bad = await alice.post('/api/codes', { type: 'url', fields: { url: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);
  const r = await alice.post('/api/codes', { type: 'wifi', name: 'Cafe', fields: { ssid: 'Cafe;WiFi', password: 'p:ss', security: 'WPA' } });
  assert.equal(r.status, 200);
  staticCode = r.json;
  assert.equal(staticCode.dynamic, false);
  assert.equal(staticCode.payload, 'WIFI:T:WPA;S:Cafe\\;WiFi;P:p\\:ss;;');
  assert.equal((await alice.post('/api/codes', { type: 'landing', dynamic: false, fields: { title: 'x' } })).json.dynamic, true);
});

test('dynamic code: redirect, analytics, edit destination', async () => {
  const r = await alice.post('/api/codes', { type: 'url', dynamic: true, name: 'Promo', fields: { url: 'https://example.com/a' }, slug: 'promo-1' });
  assert.equal(r.status, 200, r.text);
  dynCode = r.json;
  assert.equal(dynCode.slug, 'promo-1');
  assert.match(dynCode.payload, /\/promo-1$/);
  const hit = await anon.get('/promo-1', { raw: true, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604', 'Accept-Language': 'de-DE', 'cf-ipcountry': 'DE', Referer: 'https://news.example.org/post' } });
  assert.equal(hit.status, 302);
  assert.equal(hit.headers.get('location'), 'https://example.com/a');
  await anon.get('/r/promo-1', { raw: true, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Mobile Safari/537' } });
  await anon.get('/promo-1', { raw: true, headers: { 'User-Agent': 'Googlebot/2.1' } }); // bots are not counted
  const st = await alice.get(`/api/codes/${dynCode.id}/stats?days=7`);
  assert.equal(st.json.total, 2);
  assert.deepEqual(st.json.countries.find(c => c.k === 'DE'), { k: 'DE', n: 1 });
  assert.ok(st.json.devices.some(d => d.k === 'Mobile'));
  assert.ok(st.json.os.some(d => d.k === 'iOS') && st.json.os.some(d => d.k === 'Android'));
  assert.ok(st.json.referrers.some(d => d.k === 'news.example.org'));
  const up = await alice.patch(`/api/codes/${dynCode.id}`, { fields: { url: 'https://example.com/b' } });
  assert.equal(up.status, 200);
  assert.equal(up.json.payload, dynCode.payload, 'QR payload must not change when destination changes');
  const hit2 = await anon.get('/promo-1', { raw: true });
  assert.equal(hit2.headers.get('location'), 'https://example.com/b');
  assert.equal((await alice.post('/api/codes', { type: 'url', dynamic: true, fields: { url: 'https://x.com' }, slug: 'promo-1' })).status, 409);
});

test('pause, expiry, password', async () => {
  await alice.patch(`/api/codes/${dynCode.id}`, { status: 'paused' });
  assert.equal((await anon.get('/promo-1', { raw: true })).status, 503);
  await alice.patch(`/api/codes/${dynCode.id}`, { status: 'active', expiresAt: Date.now() - 1000 });
  assert.equal((await anon.get('/promo-1', { raw: true })).status, 410);
  await alice.patch(`/api/codes/${dynCode.id}`, { expiresAt: null, password: 'secret1' });
  const gate = await anon.get('/promo-1', { raw: true });
  assert.equal(gate.status, 200);
  assert.match(await gate.text(), /Password required/);
  const wrong = await anon.req('POST', '/promo-1/unlock', 'password=nope', { raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(wrong.status, 401);
  const ok = await anon.req('POST', '/promo-1/unlock', 'password=secret1', { raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(ok.status, 303);
  const after = await anon.get('/promo-1', { raw: true });
  assert.equal(after.status, 302);
  await alice.patch(`/api/codes/${dynCode.id}`, { clearPassword: true });
});

test('content pages', async () => {
  const mk = async (type, fields) => (await alice.post('/api/codes', { type, dynamic: true, fields })).json;
  const vc = await mk('vcard', { first: 'Ada', last: 'Lovelace', email: 'ada@example.com' });
  const r = await anon.get(`/${vc.slug}`, { raw: true });
  assert.match(r.headers.get('content-type'), /text\/vcard/);
  assert.match(await r.text(), /FN:Ada Lovelace/);
  const bio = await mk('bio', { name: '<script>alert(1)</script>', links: [{ label: 'Site', url: 'example.com' }] });
  const html = await (await anon.get(`/${bio.slug}`, { raw: true })).text();
  assert.ok(!html.includes('<script>alert'), 'bio page must escape user text');
  assert.match(html, /href="https:\/\/example\.com"/);
  const app = await mk('app', { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x', fallback: 'https://example.com' });
  const ios = await anon.get(`/${app.slug}`, { raw: true, headers: { 'User-Agent': 'iPhone Safari Mobile' } });
  assert.match(ios.headers.get('location'), /apple/);
  const and = await anon.get(`/${app.slug}`, { raw: true, headers: { 'User-Agent': 'Android Chrome Mobile' } });
  assert.match(and.headers.get('location'), /play\.google/);
  const desk = await anon.get(`/${app.slug}`, { raw: true, headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' } });
  assert.equal(desk.headers.get('location'), 'https://example.com');
  const ev = await mk('event', { title: 'Party', start: '2026-12-31T20:00', end: '2026-12-31T23:30', location: 'Home' });
  assert.match(await (await anon.get(`/${ev.slug}`, { raw: true })).text(), /DTSTART:20261231T200000/);
});

test('file upload + hosted PDF', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const badUp = await alice.req('POST', '/api/upload', Buffer.from('MZ not a pdf'), { headers: { 'X-Filename': 'a.pdf' } });
  assert.equal(badUp.status, 400);
  const up = await alice.req('POST', '/api/upload', pdf, { headers: { 'X-Filename': 'Menu.pdf', 'Content-Type': 'application/octet-stream' } });
  assert.equal(up.status, 200, up.text);
  const code = await alice.post('/api/codes', { type: 'pdf', fields: { file: up.json.id, title: 'Menu' } });
  assert.equal(code.status, 200, code.text);
  const r = await anon.get(`/${code.json.slug}`, { raw: true });
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal((await r.text()).slice(0, 5), '%PDF-');
  const other = new Client();
  await other.post('/api/auth/register', { email: 'eve@example.com', name: 'Eve', password: pw });
  assert.equal((await other.post('/api/codes', { type: 'pdf', fields: { file: up.json.id } })).status, 400, 'cannot reuse another user\'s file');
});

test('folders, campaigns, templates, listing, ownership', async () => {
  const f = (await alice.post('/api/folders', { name: 'Print' })).json;
  const c = (await alice.post('/api/campaigns', { name: 'Spring', description: 'x' })).json;
  const code = (await alice.post('/api/codes', { type: 'text', name: 'Foldered', fields: { text: 'hello' }, folderId: f.id, campaignId: c.id })).json;
  const list = (await alice.get(`/api/codes?folder=${f.id}&campaign=${c.id}`)).json;
  assert.equal(list.total, 1);
  assert.equal((await alice.get('/api/folders')).json.items[0].codes, 1);
  const eve = new Client();
  await eve.post('/api/auth/login', { email: 'eve@example.com', password: pw });
  assert.equal((await eve.get(`/api/codes/${code.id}`)).status, 404);
  assert.equal((await eve.patch(`/api/codes/${code.id}`, { name: 'x' })).status, 404);
  assert.equal((await eve.post('/api/codes', { type: 'text', fields: { text: 'a' }, folderId: f.id })).status, 400);
  assert.equal((await alice.get(`/api/stats?campaign=${c.id}`)).status, 200);
  await alice.post('/api/templates', { name: 'Brand', style: { dots: 'rounded', fg: { type: 'solid', c1: '#112233' } } });
  assert.equal((await alice.get('/api/templates')).json.items[0].style.dots, 'rounded');
});

test('bulk create', async () => {
  const rows = [{ name: 'A', fields: { url: 'example.com/a' } }, { name: 'B', fields: { url: 'nope nope' } }, { name: 'C', fields: { url: 'https://example.com/c' } }];
  const r = await alice.post('/api/codes/bulk', { type: 'url', dynamic: false, rows });
  assert.equal(r.status, 200);
  assert.equal(r.json.created.length, 2);
  assert.equal(r.json.errors[0].row, 2);
  assert.equal(r.json.created[0].payload, 'https://example.com/a');
});

test('image endpoints', async () => {
  for (const [fmt, type] of [['svg', 'image/svg'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['pdf', 'application/pdf'], ['eps', 'application/postscript']]) {
    const r = await alice.get(`/api/codes/${staticCode.id}/image/${fmt}?size=300`, { raw: true });
    assert.equal(r.status, 200, fmt);
    assert.ok(r.headers.get('content-type').startsWith(type), fmt);
    assert.ok((await r.arrayBuffer()).byteLength > 200);
  }
  const pub = await anon.get('/api/render?data=hello&format=png&size=200&fg=112233&dots=rounded', { raw: true });
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('content-type'), 'image/png');
  assert.equal((await anon.get('/api/render')).status, 400);
});

test('API key auth on /api/v1', async () => {
  const k = await alice.post('/api/keys', { name: 'zap' });
  assert.match(k.json.key, /^qrs_/);
  const c = new Client(); c.key = k.json.key;
  const r = await c.req('POST', '/api/v1/codes', { type: 'url', dynamic: true, fields: { url: 'https://example.com/api' } }, { noXrw: true });
  assert.equal(r.status, 200, r.text);
  assert.equal((await c.req('GET', '/api/v1/codes', undefined, { noXrw: true })).json.total >= 1, true);
  const bad = new Client(); bad.key = 'qrs_wrong';
  assert.equal((await bad.req('GET', '/api/v1/codes', undefined, { noXrw: true })).status, 401);
  assert.equal((await c.req('POST', '/api/keys', {}, { noXrw: true })).status, 403);
});

test('webhook URL must be public https', async () => {
  assert.equal((await alice.post('/api/webhooks', { url: 'http://example.com/hook' })).status, 400);
  assert.equal((await alice.post('/api/webhooks', { url: 'https://127.0.0.1/hook' })).status, 400);
});

test('admin: users, limits, suspension, settings, reports', async () => {
  const ov = await admin.get('/api/admin/overview');
  assert.equal(ov.status, 200);
  assert.ok(ov.json.users.total >= 3);
  const users = (await admin.get('/api/admin/users?q=alice')).json;
  assert.equal(users.items.length, 1);
  const id = users.items[0].id;
  assert.equal((await admin.patch(`/api/admin/users/${id}`, { maxCodes: 1 })).status, 200);
  const lim = await alice.post('/api/codes', { type: 'text', fields: { text: 'over limit' } });
  assert.equal(lim.status, 403);
  await admin.patch(`/api/admin/users/${id}`, { maxCodes: null });
  // report -> block
  await anon.req('POST', `/${dynCode.slug}/report`, 'reason=spam', { raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const reports = (await admin.get('/api/admin/reports')).json.items;
  assert.equal(reports.length, 1);
  await admin.patch(`/api/admin/reports/${reports[0].id}`, { status: 'closed', blockCode: true });
  assert.equal((await anon.get(`/${dynCode.slug}`, { raw: true })).status, 410);
  assert.equal((await alice.patch(`/api/codes/${dynCode.id}`, { status: 'active' })).status, 403);
  // blocked destination hosts
  await admin.req('PUT', '/api/admin/settings', { blockedHosts: 'evil.example' });
  assert.equal((await alice.post('/api/codes', { type: 'url', dynamic: true, fields: { url: 'https://sub.evil.example/x' } })).status, 400);
  await admin.req('PUT', '/api/admin/settings', { blockedHosts: '' });
  // suspend -> sessions die + codes disabled
  const live = (await alice.post('/api/codes', { type: 'url', dynamic: true, fields: { url: 'https://example.com/live' } })).json;
  await admin.patch(`/api/admin/users/${id}`, { status: 'suspended' });
  assert.equal((await alice.get('/api/me')).status, 401);
  assert.equal((await anon.get(`/${live.slug}`, { raw: true })).status, 410);
  assert.equal((await new Client().post('/api/auth/login', { email: 'alice@example.com', password: pw })).status, 403);
  await admin.patch(`/api/admin/users/${id}`, { status: 'active' });
  // reset password
  const rp = await admin.post(`/api/admin/users/${id}/reset-password`, {});
  assert.ok(rp.json.password.length >= 8);
  assert.equal((await new Client().post('/api/auth/login', { email: 'alice@example.com', password: rp.json.password })).status, 200);
  // last admin protected
  const me = (await admin.get('/api/me')).json.user;
  assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { role: 'user' })).status, 409);
  assert.equal((await admin.del(`/api/admin/users/${me.id}`)).status, 409);
  // settings + audit
  assert.equal((await admin.req('PUT', '/api/admin/settings', { registration: 'closed' })).status, 200);
  assert.equal((await new Client().post('/api/auth/register', { email: 'new@example.com', password: pw })).status, 403);
  await admin.req('PUT', '/api/admin/settings', { registration: 'approval' });
  const pend = await new Client().post('/api/auth/register', { email: 'pending@example.com', password: pw });
  assert.equal(pend.json.pending, true);
  assert.ok((await admin.get('/api/admin/audit')).json.items.length > 5);
  await admin.req('PUT', '/api/admin/settings', { registration: 'open' });
});

test('custom domain scan routing', async () => {
  await admin.post('/api/admin/domains', { host: 'go.example.org' });
  const d = (await admin.get('/api/domains')).json.items.find(x => x.host === 'go.example.org');
  assert.ok(d.global && d.verified);
  const cr = await admin.post('/api/codes', { type: 'url', dynamic: true, fields: { url: 'https://example.com/d' }, domainId: d.id, slug: 'dom-test' });
  assert.equal(cr.status, 200, cr.text);
  const c = cr.json;
  assert.equal(c.shortUrl, 'http://go.example.org/dom-test'); // scheme follows the site's own (http in tests)
  const viaHost = (path, host) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, headers: { Host: host } }, res => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
  });
  assert.equal((await viaHost('/dom-test', 'go.example.org')).statusCode, 302);
  assert.equal((await viaHost('/api/config', 'go.example.org')).statusCode, 404, 'no app/API on custom domains');
  assert.equal((await viaHost('/', 'go.example.org')).statusCode, 404);
  assert.equal((await viaHost('/api/config', '127.0.0.1')).statusCode, 200);
});

test('deleting a code and a user cleans up', async () => {
  const eve = new Client();
  await eve.post('/api/auth/login', { email: 'eve@example.com', password: pw });
  const c = (await eve.post('/api/codes', { type: 'url', dynamic: true, fields: { url: 'https://example.com/e' } })).json;
  assert.equal((await eve.del(`/api/codes/${c.id}`)).status, 200);
  assert.equal((await anon.get(`/${c.slug}`, { raw: true })).status, 404);
  const id = (await admin.get('/api/admin/users?q=eve')).json.items[0].id;
  assert.equal((await admin.del(`/api/admin/users/${id}`)).status, 200);
  assert.equal((await eve.get('/api/me')).status, 401);
});
