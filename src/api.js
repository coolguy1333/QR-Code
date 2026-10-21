import { writeFileSync, rmSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { resolveTxt } from 'node:dns/promises';
import { get, all, run, settings, saveSettings, audit, SETTING_DEFAULTS } from './db.js';
import { config } from './config.js';
import { token, sha256, hashPassword, verifyPassword, passwordProblem, rateLimit, rateLimited, rateReset } from './security.js';
import { HttpError, bad, notFound, createRouter, readJson, readBody, baseUrl, clientIp, send, hostOf } from './http.js';
import {
  publicUser, effectiveMaxCodes, requireUser, requireAdmin, startSession, endSession, createUser, registrationMode,
  checkLogin, normEmail, cleanName, lastActiveAdmin,
} from './auth.js';
import { brief, full, ownCode, prepareCode, insertCode, updateCode, deleteCode, countCodes, assertQuota, payloadOf, removeFile } from './codes.js';
import { statsFor } from './analytics.js';
import { renderQR, rasterAvailable } from './qr.js';
import { normalizeStyle } from '../public/js/qr-render.js';
import { TYPES } from '../public/js/qr-content.js';
import { assertPublicHttps, deliver } from './webhooks.js';

export const api = createRouter();

const parse = s => { try { return JSON.parse(s); } catch { return {}; } };
const pageOf = (q, def = 24) => {
  const limit = Math.min(100, Math.max(1, Number(q.limit) || def));
  const page = Math.max(1, Number(q.page) || 1);
  return { limit, page, offset: (page - 1) * limit };
};
const like = s => `%${String(s).replace(/[%_\\]/g, m => '\\' + m)}%`;
const str = (v, max, label) => {
  const s = String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (s.length > max) throw bad(`${label} is too long.`);
  return s;
};

// =====================================================================
// public
// =====================================================================
api.get('/api/health', () => ({ ok: true }));

api.get('/api/config', ctx => {
  const s = settings();
  return {
    siteName: s.siteName, announcement: s.announcement, registration: registrationMode(),
    raster: rasterAvailable(), allowUserDomains: s.allowUserDomains, maxBulk: s.maxBulk,
    firstRun: get('SELECT COUNT(*) AS n FROM users').n === 0,
    baseUrl: baseUrl(ctx.req),
    user: publicUser(ctx.user),
  };
});

api.post('/api/auth/register', async ctx => {
  const mode = registrationMode();
  if (mode === 'closed') throw new HttpError(403, 'Registration is closed. Ask an administrator for an account.');
  const ip = clientIp(ctx.req);
  if (!rateLimit(`reg:${ip}`, 8, 3600_000)) throw new HttpError(429, 'Too many sign-ups from this network. Try again later.');
  const b = await readJson(ctx.req, 20_000);
  const first = get('SELECT COUNT(*) AS n FROM users').n === 0;
  const user = await createUser({ email: b.email, name: b.name, password: b.password, status: !first && mode === 'approval' ? 'pending' : 'active' });
  audit(user, 'user.register', user.email, user.status);
  if (user.status === 'pending') return { pending: true, message: 'Your account was created and is waiting for an administrator to approve it.' };
  await startSession(ctx.req, ctx.res, user);
  return { user: publicUser(user) };
});

api.post('/api/auth/login', async ctx => {
  const b = await readJson(ctx.req, 20_000);
  const ip = clientIp(ctx.req);
  const key = `login:${ip}:${String(b.email || '').toLowerCase()}`;
  if (rateLimited(key, 8, 15 * 60_000) || !rateLimit(`login-ip:${ip}`, 60, 15 * 60_000)) throw new HttpError(429, 'Too many sign-in attempts. Wait a few minutes and try again.');
  const user = await checkLogin(b.email, b.password);
  if (!user) { rateLimit(key, 8, 15 * 60_000); throw new HttpError(401, 'Email or password is not correct.'); }
  if (user.status === 'pending') throw new HttpError(403, 'Your account is waiting for administrator approval.');
  if (user.status !== 'active') throw new HttpError(403, 'This account has been suspended.');
  rateReset(key);
  await startSession(ctx.req, ctx.res, user);
  return { user: publicUser(user) };
});

api.post('/api/auth/logout', ctx => { endSession(ctx.req, ctx.res); return { ok: true }; });

// Direct image URL for integrations (Zapier, Canva, docs, emails…)
api.get('/api/render', ctx => renderFromQuery(ctx));
function renderFromQuery(ctx) {
  const q = ctx.query;
  const limit = ctx.user ? 600 : 60;
  if (!rateLimit(`render:${ctx.user?.id || clientIp(ctx.req)}`, limit, 60_000)) throw new HttpError(429, 'Rate limit reached. Slow down or use an API key.');
  const data = String(q.data || '');
  if (!data) throw bad('Missing ?data=… (the text or URL to encode).');
  if (data.length > 2000) throw bad('?data is too long (max 2000 characters).');
  const hex = v => (v && /^#?[0-9a-f]{6}$/i.test(v) ? (v.startsWith('#') ? v : '#' + v) : undefined);
  const style = {
    ecc: q.ecc, margin: q.margin, dots: q.dots, eyeOuter: q.eyeOuter, eyeInner: q.eyeInner,
    eyeOuterColor: hex(q.eyeOuterColor) || '', eyeInnerColor: hex(q.eyeInnerColor) || '',
    fg: { type: q.fg2 ? (q.gradient === 'radial' ? 'radial' : 'linear') : 'solid', c1: hex(q.fg), c2: hex(q.fg2), angle: q.angle },
    bg: { type: q.transparent === '1' || q.transparent === 'true' ? 'transparent' : 'solid', c1: hex(q.bg) },
    frame: { type: q.frame || 'none', text: q.frameText ?? 'SCAN ME', color: hex(q.frameColor), textColor: hex(q.frameTextColor) },
  };
  const format = String(q.format || 'svg').toLowerCase();
  const out = renderQR(data, style, { format, size: Number(q.size) || 512, sizeMm: Number(q.sizeMm) || 50 });
  send(ctx.res, 200, out.body, { 'Content-Type': out.type, 'Cache-Control': 'public, max-age=3600', 'Content-Disposition': `inline; filename="qr.${format === 'jpeg' ? 'jpg' : format}"` });
}

// =====================================================================
// account
// =====================================================================
function limitsFor(user) {
  const s = settings();
  const used = get('SELECT COALESCE(SUM(size),0) AS n FROM files WHERE user_id = ?', user.id).n;
  return { maxCodes: effectiveMaxCodes(user), codeCount: countCodes(user.id), storageUsed: used, storageMax: user.role === 'admin' ? 0 : s.maxStorageMB * 1024 * 1024 };
}

api.get('/api/me', ctx => { const u = requireUser(ctx); return { user: publicUser(u), limits: limitsFor(u) }; });

api.patch('/api/me', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 20_000);
  const name = cleanName(b.name);
  if (!name) throw bad('Enter your name.');
  run('UPDATE users SET name = ? WHERE id = ?', name, u.id);
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) };
});

api.post('/api/me/password', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 20_000);
  if (!(await verifyPassword(String(b.current || ''), u.pass_hash))) throw new HttpError(403, 'Your current password is not correct.');
  const problem = passwordProblem(b.next, u.email);
  if (problem) throw bad(problem);
  run('UPDATE users SET pass_hash = ? WHERE id = ?', await hashPassword(b.next), u.id);
  run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, ctx.sessionId ?? -1);
  audit(u, 'user.password', u.email);
  return { ok: true };
});

api.post('/api/me/email', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 20_000);
  if (!(await verifyPassword(String(b.password || ''), u.pass_hash))) throw new HttpError(403, 'Your password is not correct.');
  const email = normEmail(b.email);
  try { run('UPDATE users SET email = ? WHERE id = ?', email, u.id); } catch { throw new HttpError(409, 'That email is already registered.'); }
  audit(u, 'user.email', `${u.email} → ${email}`);
  return { user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) };
});

api.delete('/api/me', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 20_000);
  if (!(await verifyPassword(String(b.password || ''), u.pass_hash))) throw new HttpError(403, 'Your password is not correct.');
  if (u.role === 'admin' && lastActiveAdmin(u.id)) throw new HttpError(409, 'You are the only administrator. Promote someone else first.');
  eraseUser(u);
  audit(null, 'user.self-delete', u.email);
  endSession(ctx.req, ctx.res);
  return { ok: true };
});

function eraseUser(u) {
  const files = all('SELECT id FROM files WHERE user_id = ?', u.id);
  run('DELETE FROM users WHERE id = ?', u.id);
  for (const f of files) { try { rmSync(resolve(config.dataDir, 'files', f.id), { force: true }); } catch { /* ignore */ } }
}

api.get('/api/me/sessions', ctx => {
  const u = requireUser(ctx);
  return { items: all('SELECT id, created_at, expires_at, ua FROM sessions WHERE user_id = ? ORDER BY created_at DESC', u.id).map(s => ({ ...s, current: s.id === ctx.sessionId })) };
});
api.delete('/api/me/sessions/:id', ctx => { const u = requireUser(ctx); run('DELETE FROM sessions WHERE id = ? AND user_id = ?', Number(ctx.params.id), u.id); return { ok: true }; });

api.get('/api/me/export', ctx => {
  const u = requireUser(ctx);
  const base = baseUrl(ctx.req);
  const rows = all('SELECT * FROM codes WHERE user_id = ? ORDER BY id', u.id);
  ctx.res.setHeader('Content-Disposition', 'attachment; filename="qr-studio-export.json"');
  return {
    exportedAt: new Date().toISOString(), user: publicUser(u),
    codes: rows.map(r => full(r, base)),
    folders: all('SELECT * FROM folders WHERE user_id = ?', u.id), campaigns: all('SELECT * FROM campaigns WHERE user_id = ?', u.id),
  };
});

// ---------- API keys ----------
api.get('/api/keys', ctx => ({ items: all('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY id DESC', requireUser(ctx).id) }));
api.post('/api/keys', async ctx => {
  const u = requireUser(ctx);
  if (ctx.via === 'key') throw new HttpError(403, 'Create API keys from the website while signed in.');
  const b = await readJson(ctx.req, 5000);
  if (get('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?', u.id).n >= 10) throw bad('You can have at most 10 API keys.');
  const key = `qrs_${token(30)}`;
  const r = run('INSERT INTO api_keys(user_id,name,prefix,key_hash,created_at) VALUES(?,?,?,?,?)', u.id, str(b.name, 60, 'Name') || 'API key', key.slice(0, 9), sha256(key), Date.now());
  return { id: Number(r.lastInsertRowid), key };
});
api.delete('/api/keys/:id', ctx => { run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', Number(ctx.params.id), requireUser(ctx).id); return { ok: true }; });

// ---------- webhooks ----------
const hookOut = h => ({ id: h.id, url: h.url, events: h.events.split(','), active: !!h.active, lastStatus: h.last_status, lastAt: h.last_at, secret: h.secret });
api.get('/api/webhooks', ctx => ({ items: all('SELECT * FROM webhooks WHERE user_id = ? ORDER BY id', requireUser(ctx).id).map(hookOut) }));
api.post('/api/webhooks', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 5000);
  if (get('SELECT COUNT(*) AS n FROM webhooks WHERE user_id = ?', u.id).n >= 5) throw bad('You can have at most 5 webhooks.');
  const url = await assertPublicHttps(String(b.url || ''));
  const r = run('INSERT INTO webhooks(user_id,url,secret,events,created_at) VALUES(?,?,?,?,?)', u.id, url, `whsec_${token(24)}`, 'scan', Date.now());
  return hookOut(get('SELECT * FROM webhooks WHERE id = ?', r.lastInsertRowid));
});
api.patch('/api/webhooks/:id', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 5000);
  const h = get('SELECT * FROM webhooks WHERE id = ? AND user_id = ?', Number(ctx.params.id), u.id);
  if (!h) throw notFound();
  run('UPDATE webhooks SET active = ? WHERE id = ?', b.active ? 1 : 0, h.id);
  return hookOut(get('SELECT * FROM webhooks WHERE id = ?', h.id));
});
api.post('/api/webhooks/:id/test', async ctx => {
  const u = requireUser(ctx);
  const h = get('SELECT * FROM webhooks WHERE id = ? AND user_id = ?', Number(ctx.params.id), u.id);
  if (!h) throw notFound();
  return { status: await deliver(h, 'ping', { message: 'Hello from QR Studio' }) };
});
api.delete('/api/webhooks/:id', ctx => { run('DELETE FROM webhooks WHERE id = ? AND user_id = ?', Number(ctx.params.id), requireUser(ctx).id); return { ok: true }; });

// =====================================================================
// folders / campaigns / templates
// =====================================================================
function simpleCrud(path, table, cols, { extra = '' } = {}) {
  api.get(`/api/${path}`, ctx => {
    const u = requireUser(ctx);
    const col = table === 'folders' ? 'folder_id' : table === 'campaigns' ? 'campaign_id' : null;
    const sel = col ? `, (SELECT COUNT(*) FROM codes WHERE ${col} = t.id) AS codes${table === 'campaigns' ? ', (SELECT COALESCE(SUM(scan_count),0) FROM codes WHERE campaign_id = t.id) AS scans' : ''}` : '';
    return { items: all(`SELECT t.*${sel} FROM ${table} t WHERE t.user_id = ? ORDER BY t.name COLLATE NOCASE`, u.id).map(r => tidy(r)) };
  });
  api.post(`/api/${path}`, async ctx => {
    const u = requireUser(ctx);
    const b = await readJson(ctx.req, 200_000);
    if (get(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, u.id).n >= 200) throw bad('You have reached the limit for this list.');
    const vals = cols.map(c => c.read(b));
    const r = run(`INSERT INTO ${table}(user_id,${cols.map(c => c.col).join(',')},created_at) VALUES(?,${cols.map(() => '?').join(',')},?)`, u.id, ...vals, Date.now());
    return tidy(get(`SELECT * FROM ${table} WHERE id = ?`, r.lastInsertRowid));
  });
  api.patch(`/api/${path}/:id`, async ctx => {
    const u = requireUser(ctx);
    const row = get(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, Number(ctx.params.id), u.id);
    if (!row) throw notFound();
    const b = await readJson(ctx.req, 200_000);
    const sets = cols.filter(c => c.col in b || c.key in b).map(c => [c.col, c.read(b)]);
    if (sets.length) run(`UPDATE ${table} SET ${sets.map(([c]) => c + ' = ?').join(',')} WHERE id = ?`, ...sets.map(([, v]) => v), row.id);
    return tidy(get(`SELECT * FROM ${table} WHERE id = ?`, row.id));
  });
  api.delete(`/api/${path}/:id`, ctx => {
    const u = requireUser(ctx);
    run(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, Number(ctx.params.id), u.id);
    return { ok: true };
  });
  void extra;
}
const tidy = r => { const o = { id: r.id, name: r.name, createdAt: r.created_at }; for (const k of ['description', 'codes', 'scans']) if (k in r) o[k] = r[k]; if ('style' in r) o.style = parse(r.style); return o; };
simpleCrud('folders', 'folders', [{ col: 'name', key: 'name', read: b => str(b.name, 80, 'Name') || (() => { throw bad('Enter a name.'); })() }]);
simpleCrud('campaigns', 'campaigns', [
  { col: 'name', key: 'name', read: b => str(b.name, 80, 'Name') || (() => { throw bad('Enter a name.'); })() },
  { col: 'description', key: 'description', read: b => str(b.description, 300, 'Description') },
]);
simpleCrud('templates', 'templates', [
  { col: 'name', key: 'name', read: b => str(b.name, 80, 'Name') || (() => { throw bad('Enter a name.'); })() },
  { col: 'style', key: 'style', read: b => JSON.stringify(normalizeStyle(b.style)) },
]);

// =====================================================================
// custom short domains
// =====================================================================
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const domainOut = d => ({ id: d.id, host: d.host, verified: !!d.verified, global: !d.user_id, token: d.user_id ? d.token : undefined, txtName: `_qr-verify.${d.host}`, createdAt: d.created_at, userId: d.user_id });

api.get('/api/domains', ctx => {
  const u = requireUser(ctx);
  return { items: all('SELECT * FROM domains WHERE user_id = ? OR (user_id IS NULL AND verified = 1) ORDER BY user_id IS NULL DESC, host', u.id).map(domainOut), allowed: settings().allowUserDomains };
});
api.post('/api/domains', async ctx => {
  const u = requireUser(ctx);
  if (!settings().allowUserDomains && u.role !== 'admin') throw new HttpError(403, 'Custom domains are disabled on this site.');
  const b = await readJson(ctx.req, 5000);
  const host = String(b.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(host)) throw bad('Enter a domain like go.example.com');
  if (host === hostOf(ctx.req) || (config.publicUrl && host === new URL(config.publicUrl).hostname)) throw bad('That is this site’s own address.');
  if (get('SELECT COUNT(*) AS n FROM domains WHERE user_id = ?', u.id).n >= 10) throw bad('You can add at most 10 domains.');
  try {
    const r = run('INSERT INTO domains(user_id,host,token,verified,created_at) VALUES(?,?,?,0,?)', u.id, host, `qrs-verify-${token(12)}`, Date.now());
    return domainOut(get('SELECT * FROM domains WHERE id = ?', r.lastInsertRowid));
  } catch { throw new HttpError(409, 'That domain is already registered.'); }
});
api.post('/api/domains/:id/verify', async ctx => {
  const u = requireUser(ctx);
  const d = get('SELECT * FROM domains WHERE id = ? AND user_id = ?', Number(ctx.params.id), u.id);
  if (!d) throw notFound();
  let ok = false;
  try { ok = (await resolveTxt(`_qr-verify.${d.host}`)).some(r => r.join('') === d.token); } catch { /* not found */ }
  if (!ok) throw bad(`We could not find the TXT record. Add a TXT record named _qr-verify.${d.host} with the value ${d.token}, wait a few minutes, then try again.`);
  run('UPDATE domains SET verified = 1 WHERE id = ?', d.id);
  return domainOut(get('SELECT * FROM domains WHERE id = ?', d.id));
});
api.delete('/api/domains/:id', ctx => { run('DELETE FROM domains WHERE id = ? AND user_id = ?', Number(ctx.params.id), requireUser(ctx).id); return { ok: true }; });

// =====================================================================
// codes
// =====================================================================
const SORTS = { created: 'c.created_at', name: 'c.name COLLATE NOCASE', scans: 'c.scan_count', updated: 'c.updated_at' };

function listCodes(ctx, { all: everyone = false } = {}) {
  const u = ctx.user;
  const q = ctx.query;
  const where = [], p = [];
  if (!everyone) { where.push('c.user_id = ?'); p.push(u.id); }
  if (q.q) { where.push("(c.name LIKE ? ESCAPE '\\' OR c.slug LIKE ? ESCAPE '\\')"); p.push(like(q.q), like(q.q)); }
  if (q.type && TYPES[q.type]) { where.push('c.type = ?'); p.push(q.type); }
  if (q.dynamic === '0' || q.dynamic === '1') { where.push('c.dynamic = ?'); p.push(Number(q.dynamic)); }
  if (q.status && ['active', 'paused', 'blocked'].includes(q.status)) { where.push('c.status = ?'); p.push(q.status); }
  if (q.folder === 'none') where.push('c.folder_id IS NULL'); else if (q.folder) { where.push('c.folder_id = ?'); p.push(Number(q.folder)); }
  if (q.campaign === 'none') where.push('c.campaign_id IS NULL'); else if (q.campaign) { where.push('c.campaign_id = ?'); p.push(Number(q.campaign)); }
  if (q.userId && everyone) { where.push('c.user_id = ?'); p.push(Number(q.userId)); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { limit, page, offset } = pageOf(q);
  const order = `${SORTS[q.sort] || SORTS.created} ${q.dir === 'asc' ? 'ASC' : 'DESC'}, c.id DESC`;
  const total = get(`SELECT COUNT(*) AS n FROM codes c ${w}`, ...p).n;
  const rows = all(`SELECT c.*, u.email AS owner_email FROM codes c JOIN users u ON u.id = c.user_id ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...p, limit, offset);
  const base = baseUrl(ctx.req);
  return { items: rows.map(r => ({ ...brief(r, base), ownerEmail: everyone ? r.owner_email : undefined })), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

api.get('/api/codes', ctx => { requireUser(ctx); return listCodes(ctx); });

api.post('/api/codes', async ctx => {
  const u = requireUser(ctx);
  if (!rateLimit(`mk:${u.id}`, 120, 60_000)) throw new HttpError(429, 'Slow down a little.');
  const b = await readJson(ctx.req);
  assertQuota(u, 1);
  const p = await prepareCode(u, b);
  const row = insertCode(u, p);
  return full(row, baseUrl(ctx.req));
});

api.get('/api/codes/:id', ctx => full(ownCode(requireUser(ctx), ctx.params.id), baseUrl(ctx.req)));

api.patch('/api/codes/:id', async ctx => {
  const u = requireUser(ctx);
  const row = ownCode(u, ctx.params.id, { write: true });
  const b = await readJson(ctx.req);
  const p = await prepareCode(u, b, row);
  return full(updateCode(u, row, p), baseUrl(ctx.req));
});

api.delete('/api/codes/:id', ctx => { deleteCode(ownCode(requireUser(ctx), ctx.params.id, { write: true })); return { ok: true }; });

api.post('/api/codes/:id/duplicate', async ctx => {
  const u = requireUser(ctx);
  const row = ownCode(u, ctx.params.id, { write: true });
  assertQuota(u, 1);
  if (parse(row.fields).file) throw bad('Codes with an uploaded file cannot be duplicated. Upload the file again in a new code.');
  const p = await prepareCode(u, { type: row.type, dynamic: !!row.dynamic, name: `${row.name} (copy)`, fields: parse(row.fields), style: parse(row.style), folderId: row.folder_id, campaignId: row.campaign_id, domainId: row.domain_id });
  return full(insertCode(u, p), baseUrl(ctx.req));
});

api.post('/api/codes/bulk', async ctx => {
  const u = requireUser(ctx);
  const b = await readJson(ctx.req, 5 * 1024 * 1024);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const max = settings().maxBulk;
  if (!rows.length) throw bad('No rows to create.');
  if (rows.length > max) throw bad(`Bulk requests are limited to ${max} rows.`);
  if (!rateLimit(`bulk:${u.id}`, 10, 3600_000)) throw new HttpError(429, 'Too many bulk runs this hour.');
  const limit = effectiveMaxCodes(u);
  const room = limit ? Math.max(0, limit - countCodes(u.id)) : Infinity;
  const base = baseUrl(ctx.req);
  const created = [], errors = [];
  for (let i = 0; i < rows.length; i++) {
    if (created.length >= room) { errors.push({ row: i + 1, error: 'QR code limit reached.' }); continue; }
    try {
      const r = rows[i] || {};
      const p = await prepareCode(u, { type: b.type, dynamic: !!b.dynamic, name: r.name, fields: r.fields, style: b.style, folderId: b.folderId, campaignId: b.campaignId, domainId: b.domainId, slug: r.slug, expiresAt: b.expiresAt });
      const row = insertCode(u, p);
      created.push({ row: i + 1, id: row.id, name: row.name, slug: row.slug, shortUrl: brief(row, base).shortUrl, payload: payloadOf(row, base) });
    } catch (e) { errors.push({ row: i + 1, error: e.message }); }
  }
  return { created, errors };
});

api.get('/api/codes/:id/image/:fmt', ctx => {
  const u = requireUser(ctx);
  const row = ownCode(u, ctx.params.id);
  if (!rateLimit(`img:${u.id}`, 600, 60_000)) throw new HttpError(429, 'Slow down a little.');
  const fmt = ctx.params.fmt.toLowerCase();
  const size = Number(ctx.query.size) || 1024;
  const etag = `W/"${row.updated_at}-${fmt}-${size}-${ctx.query.sizeMm || ''}-${row.domain_id || ''}"`;
  if (ctx.req.headers['if-none-match'] === etag) return send(ctx.res, 304, '', { ETag: etag });
  const out = renderQR(payloadOf(row, baseUrl(ctx.req)), parse(row.style), { format: fmt, size, sizeMm: Number(ctx.query.sizeMm) || 50 });
  send(ctx.res, 200, out.body, { 'Content-Type': out.type, ETag: etag, 'Cache-Control': 'private, no-cache', 'Content-Disposition': `inline; filename="${row.name.replace(/[^\w.\- ]+/g, '_').slice(0, 60) || 'qr'}.${fmt}"` });
});

api.get('/api/codes/:id/stats', ctx => {
  const row = ownCode(requireUser(ctx), ctx.params.id);
  return { ...statsFor('c.id = ?', [row.id], ctx.query), code: brief(row, baseUrl(ctx.req)) };
});

api.get('/api/codes/:id/recent', ctx => {
  const row = ownCode(requireUser(ctx), ctx.params.id);
  return { items: all('SELECT ts, country, city, device, os, browser, referrer FROM scans WHERE code_id = ? ORDER BY ts DESC LIMIT 30', row.id) };
});

api.get('/api/stats', ctx => {
  const u = requireUser(ctx);
  const q = ctx.query;
  let where = 'c.user_id = ?';
  const p = [u.id];
  if (q.campaign) { where += ' AND c.campaign_id = ?'; p.push(Number(q.campaign)); }
  if (q.folder) { where += ' AND c.folder_id = ?'; p.push(Number(q.folder)); }
  const counts = get('SELECT COUNT(*) AS codes, COALESCE(SUM(dynamic),0) AS dynamic, COALESCE(SUM(scan_count),0) AS scans FROM codes WHERE user_id = ?', u.id);
  return { ...statsFor(where, p, q), counts };
});

// ---------- uploads ----------
const UPLOAD_TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const MAGIC = { '.pdf': b => b.subarray(0, 5).toString() === '%PDF-', '.png': b => b.subarray(1, 4).toString() === 'PNG', '.jpg': b => b[0] === 0xff && b[1] === 0xd8, '.jpeg': b => b[0] === 0xff && b[1] === 0xd8, '.gif': b => b.subarray(0, 3).toString() === 'GIF', '.webp': b => b.subarray(8, 12).toString() === 'WEBP', '.zip': b => b.subarray(0, 2).toString() === 'PK' };

api.post('/api/upload', async ctx => {
  const u = requireUser(ctx);
  if (!rateLimit(`up:${u.id}`, 30, 3600_000)) throw new HttpError(429, 'Too many uploads. Try again later.');
  let name = '';
  try { name = decodeURIComponent(String(ctx.req.headers['x-filename'] || '')); } catch { /* ignore */ }
  name = name.replace(/[\u0000-\u001f/\\]/g, '').trim().slice(0, 120) || 'file';
  const ext = extname(name).toLowerCase();
  if (!UPLOAD_TYPES[ext]) throw bad('That file type is not supported. Try PDF, an image, Office document, text, zip, mp3 or mp4.');
  const buf = await readBody(ctx.req, config.maxUploadBytes);
  if (!buf.length) throw bad('The file is empty.');
  if (MAGIC[ext] && !MAGIC[ext](buf)) throw bad('The file does not look like a real ' + ext.slice(1).toUpperCase() + '.');
  const st = settings();
  const used = get('SELECT COALESCE(SUM(size),0) AS n FROM files WHERE user_id = ?', u.id).n;
  if (u.role !== 'admin' && st.maxStorageMB && used + buf.length > st.maxStorageMB * 1024 * 1024) throw new HttpError(403, `You have used your ${st.maxStorageMB} MB of file storage.`);
  const id = token(18);
  writeFileSync(resolve(config.dataDir, 'files', id), buf, { mode: 0o600 });
  run('INSERT INTO files(id,user_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)', id, u.id, name, UPLOAD_TYPES[ext], buf.length, Date.now());
  return { id, name, size: buf.length, mime: UPLOAD_TYPES[ext] };
});

export function cleanupOrphans() {
  const old = all('SELECT id FROM files WHERE code_id IS NULL AND created_at < ?', Date.now() - 86400_000);
  for (const f of old) removeFile(f.id);
  const days = settings().scanRetentionDays;
  if (days > 0) run('DELETE FROM scans WHERE ts < ?', Date.now() - days * 86400_000);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
}

// =====================================================================
// admin
// =====================================================================
const A = (fn) => ctx => { requireAdmin(ctx); return fn(ctx); };

api.get('/api/admin/overview', A(ctx => {
  const day = 86400_000, now = Date.now();
  const users = get("SELECT COUNT(*) AS total, SUM(status='active') AS active, SUM(status='pending') AS pending, SUM(status='suspended') AS suspended, SUM(role='admin') AS admins FROM users");
  const codes = get('SELECT COUNT(*) AS total, COALESCE(SUM(dynamic),0) AS dynamic, COALESCE(SUM(status=\'blocked\'),0) AS blocked FROM codes');
  const scans = { total: get('SELECT COUNT(*) AS n FROM scans').n, d7: get('SELECT COUNT(*) AS n FROM scans WHERE ts >= ?', now - 7 * day).n, d30: get('SELECT COUNT(*) AS n FROM scans WHERE ts >= ?', now - 30 * day).n };
  const stats = statsFor('1 = 1', [], { days: Number(ctx.query.days) || 30, tz: ctx.query.tz });
  const signups = all("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') AS d, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY d", now - 30 * day);
  return {
    users, codes, scans, stats, signups,
    storage: get('SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS files FROM files'),
    openReports: get("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").n,
    recentUsers: all('SELECT id, email, name, status, created_at FROM users ORDER BY id DESC LIMIT 6').map(u => ({ id: u.id, email: u.email, name: u.name, status: u.status, createdAt: u.created_at })),
    dbBytes: 0,
  };
}));

api.get('/api/admin/users', A(ctx => {
  const q = ctx.query;
  const where = [], p = [];
  if (q.q) { where.push("(u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"); p.push(like(q.q), like(q.q)); }
  if (['active', 'pending', 'suspended'].includes(q.status)) { where.push('u.status = ?'); p.push(q.status); }
  if (['admin', 'user'].includes(q.role)) { where.push('u.role = ?'); p.push(q.role); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { limit, page, offset } = pageOf(q, 25);
  const total = get(`SELECT COUNT(*) AS n FROM users u ${w}`, ...p).n;
  const sort = { created: 'u.created_at', email: 'u.email COLLATE NOCASE', login: 'u.last_login_at', codes: 'codes' }[q.sort] || 'u.created_at';
  const rows = all(`SELECT u.*, (SELECT COUNT(*) FROM codes WHERE user_id = u.id) AS codes, (SELECT COALESCE(SUM(scan_count),0) FROM codes WHERE user_id = u.id) AS scans FROM users u ${w} ORDER BY ${sort} ${q.dir === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`, ...p, limit, offset);
  return { items: rows.map(r => ({ ...publicUser(r), notes: r.notes, codes: r.codes, scans: r.scans })), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}));

api.post('/api/admin/users', A(async ctx => {
  const b = await readJson(ctx.req, 20_000);
  const role = b.role === 'admin' ? 'admin' : 'user';
  const user = await createUser({ email: b.email, name: b.name, password: b.password, role, status: 'active' });
  audit(ctx.user, 'user.create', user.email, role);
  return publicUser(user);
}));

api.get('/api/admin/users/:id', A(ctx => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u) throw notFound('User not found.');
  return {
    user: { ...publicUser(u), notes: u.notes },
    limits: limitsFor(u),
    sessions: all('SELECT id, created_at, expires_at, ua FROM sessions WHERE user_id = ? ORDER BY created_at DESC', u.id),
    keys: all('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ?', u.id),
    stats: statsFor('c.user_id = ?', [u.id], { days: 30, tz: ctx.query.tz }),
  };
}));

api.patch('/api/admin/users/:id', A(async ctx => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u) throw notFound('User not found.');
  const b = await readJson(ctx.req, 20_000);
  const upd = {};
  if ('name' in b) upd.name = cleanName(b.name) || u.name;
  if ('notes' in b) upd.notes = str(b.notes, 1000, 'Notes');
  if ('role' in b) { if (!['admin', 'user'].includes(b.role)) throw bad('Invalid role.'); upd.role = b.role; }
  if ('status' in b) { if (!['active', 'pending', 'suspended'].includes(b.status)) throw bad('Invalid status.'); upd.status = b.status; }
  if ('maxCodes' in b) {
    if (b.maxCodes === null || b.maxCodes === '') upd.max_codes = null;
    else { const n = Math.floor(Number(b.maxCodes)); if (!(n >= 0 && n <= 1_000_000)) throw bad('Limit must be 0 (unlimited) or a positive number.'); upd.max_codes = n; }
  }
  if ('email' in b) upd.email = normEmail(b.email);
  const losingAdmin = (upd.role === 'user' && u.role === 'admin') || (upd.status && upd.status !== 'active' && u.role === 'admin' && u.status === 'active');
  if (losingAdmin && lastActiveAdmin(u.id)) throw new HttpError(409, 'This is the only active administrator.');
  const keys = Object.keys(upd);
  if (keys.length) {
    try { run(`UPDATE users SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map(k => upd[k]), u.id); } catch { throw new HttpError(409, 'That email is already registered.'); }
  }
  if (upd.status && upd.status !== 'active') run('DELETE FROM sessions WHERE user_id = ?', u.id);
  audit(ctx.user, 'user.update', u.email, JSON.stringify(upd));
  return publicUser(get('SELECT * FROM users WHERE id = ?', u.id));
}));

api.post('/api/admin/users/:id/reset-password', A(async ctx => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u) throw notFound('User not found.');
  const b = await readJson(ctx.req, 5000);
  const pw = b.password || token(9);
  const problem = passwordProblem(pw, u.email);
  if (problem) throw bad(problem);
  run('UPDATE users SET pass_hash = ? WHERE id = ?', await hashPassword(pw), u.id);
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  audit(ctx.user, 'user.reset-password', u.email);
  return { password: pw };
}));

api.post('/api/admin/users/:id/logout', A(ctx => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u) throw notFound('User not found.');
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  audit(ctx.user, 'user.logout', u.email);
  return { ok: true };
}));

api.delete('/api/admin/users/:id', A(ctx => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
  if (!u) throw notFound('User not found.');
  if (u.id === ctx.user.id) throw new HttpError(409, 'Use the account page to delete your own account.');
  if (u.role === 'admin' && lastActiveAdmin(u.id)) throw new HttpError(409, 'This is the only active administrator.');
  eraseUser(u);
  audit(ctx.user, 'user.delete', u.email);
  return { ok: true };
}));

api.get('/api/admin/codes', A(ctx => listCodes(ctx, { all: true })));

api.patch('/api/admin/codes/:id', A(async ctx => {
  const row = get('SELECT * FROM codes WHERE id = ?', Number(ctx.params.id));
  if (!row) throw notFound();
  const b = await readJson(ctx.req, 5000);
  if (!['active', 'paused', 'blocked'].includes(b.status)) throw bad('Invalid status.');
  run('UPDATE codes SET status = ?, updated_at = ? WHERE id = ?', b.status, Date.now(), row.id);
  audit(ctx.user, 'code.status', `${row.slug || row.id}`, b.status);
  return { ok: true };
}));
api.delete('/api/admin/codes/:id', A(ctx => {
  const row = get('SELECT * FROM codes WHERE id = ?', Number(ctx.params.id));
  if (!row) throw notFound();
  deleteCode(row);
  audit(ctx.user, 'code.delete', `${row.slug || row.id}`, row.name);
  return { ok: true };
}));

api.get('/api/admin/reports', A(ctx => {
  const status = ctx.query.status === 'closed' ? 'closed' : 'open';
  return { items: all(`SELECT r.id, r.reason, r.status, r.created_at, c.id AS code_id, c.slug, c.name, c.type, c.status AS code_status, u.email AS owner_email
    FROM reports r JOIN codes c ON c.id = r.code_id JOIN users u ON u.id = c.user_id WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`, status) };
}));
api.patch('/api/admin/reports/:id', A(async ctx => {
  const b = await readJson(ctx.req, 2000);
  const r = get('SELECT * FROM reports WHERE id = ?', Number(ctx.params.id));
  if (!r) throw notFound();
  run('UPDATE reports SET status = ? WHERE id = ?', b.status === 'open' ? 'open' : 'closed', r.id);
  if (b.blockCode) { run("UPDATE codes SET status = 'blocked' WHERE id = ?", r.code_id); audit(ctx.user, 'code.status', String(r.code_id), 'blocked (report)'); }
  return { ok: true };
}));

api.get('/api/admin/domains', A(() => ({
  items: all('SELECT d.*, u.email AS owner_email FROM domains d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.user_id IS NULL DESC, d.host').map(d => ({ ...domainOut(d), token: d.token, ownerEmail: d.owner_email })),
})));
api.post('/api/admin/domains', A(async ctx => {
  const b = await readJson(ctx.req, 5000);
  const host = String(b.host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(host)) throw bad('Enter a domain like go.example.com');
  try { run('INSERT INTO domains(user_id,host,token,verified,created_at) VALUES(NULL,?,?,1,?)', host, token(8), Date.now()); } catch { throw new HttpError(409, 'That domain is already registered.'); }
  audit(ctx.user, 'domain.add', host);
  return { ok: true };
}));
api.patch('/api/admin/domains/:id', A(async ctx => {
  const b = await readJson(ctx.req, 2000);
  run('UPDATE domains SET verified = ? WHERE id = ?', b.verified ? 1 : 0, Number(ctx.params.id));
  audit(ctx.user, 'domain.verify', String(ctx.params.id), String(!!b.verified));
  return { ok: true };
}));
api.delete('/api/admin/domains/:id', A(ctx => {
  const d = get('SELECT host FROM domains WHERE id = ?', Number(ctx.params.id));
  run('DELETE FROM domains WHERE id = ?', Number(ctx.params.id));
  audit(ctx.user, 'domain.delete', d?.host || '');
  return { ok: true };
}));

api.get('/api/admin/settings', A(() => ({ settings: settings(), defaults: SETTING_DEFAULTS })));
api.put('/api/admin/settings', A(async ctx => {
  const b = await readJson(ctx.req, 50_000);
  const out = {};
  const num = (k, lo, hi) => { if (k in b) { const n = Math.floor(Number(b[k])); if (!(n >= lo && n <= hi)) throw bad(`${k} must be between ${lo} and ${hi}.`); out[k] = n; } };
  if ('siteName' in b) out.siteName = str(b.siteName, 60, 'Site name') || SETTING_DEFAULTS.siteName;
  if ('registration' in b) { if (!['open', 'approval', 'closed'].includes(b.registration)) throw bad('Invalid registration mode.'); out.registration = b.registration; }
  if ('allowUserDomains' in b) out.allowUserDomains = !!b.allowUserDomains;
  if ('announcement' in b) out.announcement = str(b.announcement, 300, 'Announcement');
  if ('blockedHosts' in b) out.blockedHosts = String(b.blockedHosts).slice(0, 5000);
  num('defaultMaxCodes', 0, 1_000_000); num('maxBulk', 1, 5000); num('maxStorageMB', 0, 1_000_000); num('scanRetentionDays', 0, 3650);
  const s = saveSettings(out);
  audit(ctx.user, 'settings.update', Object.keys(out).join(','));
  return { settings: s };
}));

api.get('/api/admin/audit', A(ctx => {
  const { limit, page, offset } = pageOf(ctx.query, 50);
  const total = get('SELECT COUNT(*) AS n FROM audit').n;
  return { items: all('SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}));

