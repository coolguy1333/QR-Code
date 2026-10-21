import { get, all, run, tx, settings } from './db.js';
import { token } from './security.js';
import { HttpError, bad, notFound } from './http.js';
import { TYPES, cleanFields, staticPayload, shortUrl } from '../public/js/qr-content.js';
import { normalizeStyle } from '../public/js/qr-render.js';
import { hashPassword } from './security.js';
import { effectiveMaxCodes } from './auth.js';
import { matrixFor } from './qr.js';
import { config } from './config.js';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RESERVED_SLUGS = new Set(['api', 'static', 'admin', 'health', 'login', 'register', 'robots.txt', 'favicon.ico', 'favicon.svg', 'r', 'p', 'qr', 'app', 'help', 'about', 'terms', 'privacy']);

export function newSlug(len = 7) {
  for (let tries = 0; tries < 20; tries++) {
    let s = '';
    const bytes = token(len * 2);
    for (let i = 0; i < len; i++) s += ALPHABET[bytes.charCodeAt(i) % ALPHABET.length];
    if (!get('SELECT 1 FROM codes WHERE slug = ?', s)) return s;
  }
  return newSlug(len + 1);
}

export function checkSlug(slug) {
  const s = String(slug).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{3,31}$/.test(s)) throw bad('Custom links need 4–32 letters, numbers, dashes or underscores.');
  if (RESERVED_SLUGS.has(s)) throw bad('That custom link is reserved.');
  if (get('SELECT 1 FROM codes WHERE slug = ?', s)) throw new HttpError(409, 'That custom link is already taken.');
  return s;
}

export function domainBase(row, defaultBase) {
  if (row.domain_id) {
    const d = get('SELECT host FROM domains WHERE id = ?', row.domain_id);
    if (d) return `${defaultBase.startsWith('http:') ? 'http' : 'https'}://${d.host}`;
  }
  return defaultBase;
}

const parse = s => { try { return JSON.parse(s); } catch { return {}; } };

export function payloadOf(row, base) {
  if (row.dynamic) return shortUrl(domainBase(row, base), row.slug);
  try { return staticPayload(row.type, parse(row.fields)); } catch { return ''; }
}

/** Compact form for lists: no embedded images. */
export function brief(row, base) {
  return {
    id: row.id, slug: row.slug, name: row.name, type: row.type, dynamic: !!row.dynamic,
    folderId: row.folder_id, campaignId: row.campaign_id, domainId: row.domain_id,
    status: row.status, expiresAt: row.expires_at, hasPassword: !!row.pass_hash,
    scanCount: row.scan_count, createdAt: row.created_at, updatedAt: row.updated_at,
    shortUrl: row.dynamic ? shortUrl(domainBase(row, base), row.slug) : null,
    userId: row.user_id,
  };
}
export function full(row, base) {
  return { ...brief(row, base), fields: parse(row.fields), style: parse(row.style), payload: payloadOf(row, base) };
}

/** Owners can read/write; administrators can read any code (changes go through the admin routes). */
export function ownCode(user, id, { write = false } = {}) {
  const row = get('SELECT * FROM codes WHERE id = ?', Number(id));
  if (!row || (row.user_id !== user.id && (write || user.role !== 'admin'))) throw notFound('QR code not found.');
  return row;
}

function blockedHosts() {
  return settings().blockedHosts.split(/[\s,]+/).map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
}
export function isBlockedUrl(u) {
  const list = blockedHosts();
  if (!list.length) return false;
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return false; }
  return list.some(b => host === b || host.endsWith('.' + b));
}

function checkBlocked(type, fields) {
  for (const f of TYPES[type].fields) {
    if (f.kind === 'url' && fields[f.key] && isBlockedUrl(fields[f.key])) throw bad('Links to that website are not allowed on this site.');
  }
  for (const l of fields.links || []) if (isBlockedUrl(l.url)) throw bad('Links to that website are not allowed on this site.');
}

function parseDate(v) {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(t)) throw bad('Expiry date is not valid.');
  return Math.round(t);
}

function ownedRef(table, id, user) {
  if (id == null || id === '') return null;
  const row = get(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, Number(id), user.id);
  if (!row) throw bad(`That ${table.slice(0, -1)} does not exist.`);
  return row.id;
}

function domainRef(id, user) {
  if (id == null || id === '') return null;
  const d = get('SELECT * FROM domains WHERE id = ?', Number(id));
  if (!d || !d.verified || (d.user_id && d.user_id !== user.id)) throw bad('That domain is not available.');
  return d.id;
}

export function countCodes(userId) { return get('SELECT COUNT(*) AS n FROM codes WHERE user_id = ?', userId).n; }

export function assertQuota(user, adding = 1) {
  const max = effectiveMaxCodes(user);
  if (max && countCodes(user.id) + adding > max) throw new HttpError(403, `You have reached your limit of ${max} QR codes. Delete some or ask an administrator to raise it.`);
}

function attachFile(user, fields, codeId) {
  if (!fields.file) return;
  const f = get('SELECT * FROM files WHERE id = ? AND user_id = ?', fields.file, user.id);
  if (!f || (f.code_id && f.code_id !== codeId)) throw bad('That file is not available. Upload it again.');
  fields.fileName = f.name;
  fields.fileSize = f.size;
  fields.fileMime = f.mime;
}

/** Validate input into column values. `existing` = current row when editing. */
export async function prepareCode(user, input, existing = null) {
  try {
    return await prepareCodeUnchecked(user, input, existing);
  } catch (e) {
    throw e instanceof HttpError ? e : bad(e.message);
  }
}

async function prepareCodeUnchecked(user, input, existing) {
  const type = existing ? existing.type : String(input.type || '');
  const t = TYPES[type];
  if (!t) throw bad('Choose what the QR code should contain.');
  const dynamic = existing ? !!existing.dynamic : (t.dynamicOnly ? true : !!input.dynamic);
  if (!dynamic && t.dynamicOnly) throw bad('This content type needs a dynamic code.');
  const fields = cleanFields(type, input.fields ?? (existing ? parse(existing.fields) : {}));
  if (dynamic) checkBlocked(type, fields);
  const style = normalizeStyle(input.style ?? (existing ? parse(existing.style) : {}));
  const name = String(input.name ?? existing?.name ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 100) || `${t.label}`;
  if (!dynamic) {
    const payload = staticPayload(type, fields);
    matrixFor(payload, style.ecc); // throws "too much data"
  }
  const out = { type, dynamic, fields, style, name };
  out.folder_id = 'folderId' in input ? ownedRef('folders', input.folderId, user) : (existing?.folder_id ?? null);
  out.campaign_id = 'campaignId' in input ? ownedRef('campaigns', input.campaignId, user) : (existing?.campaign_id ?? null);
  out.domain_id = dynamic && 'domainId' in input ? domainRef(input.domainId, user) : (existing?.domain_id ?? null);
  out.expires_at = dynamic && 'expiresAt' in input ? parseDate(input.expiresAt) : (existing?.expires_at ?? null);
  out.status = existing?.status ?? 'active';
  if ('status' in input && dynamic) {
    if (!['active', 'paused'].includes(input.status)) throw bad('Status must be active or paused.');
    if (existing?.status === 'blocked' && user.role !== 'admin') throw new HttpError(403, 'An administrator has disabled this code.');
    out.status = input.status;
  }
  out.pass_hash = existing?.pass_hash ?? null;
  if (dynamic) {
    if (input.clearPassword) out.pass_hash = null;
    else if (typeof input.password === 'string' && input.password !== '') {
      if (input.password.length < 4 || input.password.length > 100) throw bad('Passwords for codes need 4–100 characters.');
      out.pass_hash = await hashPassword(input.password);
    }
  }
  if (!existing) {
    out.slug = dynamic ? (input.slug ? checkSlug(input.slug) : newSlug()) : null;
  }
  return out;
}

export function insertCode(user, p) {
  return tx(() => {
    attachFile(user, p.fields, null);
    const now = Date.now();
    const r = run(`INSERT INTO codes(user_id,slug,name,type,dynamic,fields,style,folder_id,campaign_id,domain_id,status,expires_at,pass_hash,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      user.id, p.slug, p.name, p.type, p.dynamic ? 1 : 0, JSON.stringify(p.fields), JSON.stringify(p.style), p.folder_id, p.campaign_id, p.domain_id, p.status, p.expires_at, p.pass_hash, now, now);
    const id = Number(r.lastInsertRowid);
    if (p.fields.file) run('UPDATE files SET code_id = ? WHERE id = ?', id, p.fields.file);
    return get('SELECT * FROM codes WHERE id = ?', id);
  });
}

export function updateCode(user, row, p) {
  return tx(() => {
    const oldFile = parse(row.fields).file;
    attachFile({ id: row.user_id }, p.fields, row.id);
    run(`UPDATE codes SET name=?, fields=?, style=?, folder_id=?, campaign_id=?, domain_id=?, status=?, expires_at=?, pass_hash=?, updated_at=? WHERE id=?`,
      p.name, JSON.stringify(p.fields), JSON.stringify(p.style), p.folder_id, p.campaign_id, p.domain_id, p.status, p.expires_at, p.pass_hash, Date.now(), row.id);
    if (p.fields.file) run('UPDATE files SET code_id = ? WHERE id = ?', row.id, p.fields.file);
    if (oldFile && oldFile !== p.fields.file) removeFile(oldFile);
    return get('SELECT * FROM codes WHERE id = ?', row.id);
  });
}

export function removeFile(id) {
  run('DELETE FROM files WHERE id = ?', id);
  try { rmSync(resolve(config.dataDir, 'files', id), { force: true }); } catch { /* ignore */ }
}

export function deleteCode(row) {
  const files = all('SELECT id FROM files WHERE code_id = ?', row.id);
  run('DELETE FROM codes WHERE id = ?', row.id);
  for (const f of files) removeFile(f.id);
}

export const PAGE_SIZE_MAX = 100;
