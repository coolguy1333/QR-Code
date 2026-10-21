import { get, all, run, tx, settings, audit } from './db.js';
import { config } from './config.js';
import { token, sha256, hashPassword, verifyPassword, passwordProblem } from './security.js';
import { HttpError, bad, parseCookies, setCookie } from './http.js';
import { isEmail } from '../public/js/qr-content.js';

const SESSION_COOKIE = 'qr_session';
const SESSION_MS = 30 * 86400_000;

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, status: u.status,
    maxCodes: u.max_codes, createdAt: u.created_at, lastLoginAt: u.last_login_at,
  };
}

export function effectiveMaxCodes(u) {
  if (u.role === 'admin') return 0;
  return u.max_codes ?? settings().defaultMaxCodes;
}

export async function startSession(req, res, user) {
  const t = token(32);
  run('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,ip,ua) VALUES(?,?,?,?,?,?)',
    sha256(t), user.id, Date.now(), Date.now() + SESSION_MS, '', String(req.headers['user-agent'] || '').slice(0, 200));
  setCookie(res, req, SESSION_COOKIE, t, { maxAge: SESSION_MS / 1000 });
  run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), user.id);
}

export function endSession(req, res) {
  const t = parseCookies(req)[SESSION_COOKIE];
  if (t) run('DELETE FROM sessions WHERE token_hash = ?', sha256(t));
  setCookie(res, req, SESSION_COOKIE, '', { maxAge: 0 });
}

/** Resolve the caller. Returns {user, via, sessionId} or null. */
export function authenticate(req) {
  const authz = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(authz)) {
    const key = authz.replace(/^Bearer\s+/i, '').trim();
    const row = get('SELECT k.id AS key_id, u.* FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?', sha256(key));
    if (!row || row.status !== 'active') return null;
    run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', Date.now(), row.key_id);
    return { user: row, via: 'key' };
  }
  const t = parseCookies(req)[SESSION_COOKIE];
  if (!t) return null;
  const row = get('SELECT s.id AS sid, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', sha256(t));
  if (!row || row.expires_at < Date.now() || row.status !== 'active') return null;
  if (row.expires_at - Date.now() < SESSION_MS / 2) run('UPDATE sessions SET expires_at = ? WHERE id = ?', Date.now() + SESSION_MS, row.sid);
  return { user: row, via: 'session', sessionId: row.sid };
}

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please sign in.');
  return ctx.user;
}
export function requireAdmin(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'admin') throw new HttpError(403, 'Administrators only.');
  return ctx.user;
}

export function normEmail(e) {
  const v = String(e || '').trim().toLowerCase();
  if (!isEmail(v) || v.length > 200) throw bad('Enter a valid email address.');
  return v;
}

const cleanName = n => String(n ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);

export async function createUser({ email, name, password, role, status }, actor = null) {
  email = normEmail(email);
  const problem = passwordProblem(password, email);
  if (problem) throw bad(problem);
  const hash = await hashPassword(password);
  try {
    return tx(() => {
      const first = get('SELECT COUNT(*) AS n FROM users').n === 0;
      const r = run('INSERT INTO users(email,name,pass_hash,role,status,created_at) VALUES(?,?,?,?,?,?)',
        email, cleanName(name) || email.split('@')[0], hash,
        role || (first || config.adminEmails.includes(email) ? 'admin' : 'user'),
        status || 'active', Date.now());
      return get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
    });
  } catch (e) {
    if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'That email is already registered.');
    throw e;
  }
}

export function registrationMode() {
  const n = get('SELECT COUNT(*) AS n FROM users').n;
  return n === 0 ? 'open' : settings().registration;
}

export async function checkLogin(email, password) {
  const u = get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
  // always burn a hash comparison to equalise timing
  const ok = await verifyPassword(String(password || ''), u?.pass_hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!u || !ok) return null;
  return u;
}

export function lastActiveAdmin(userId) {
  const admins = all("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
  return admins.length === 1 && admins[0].id === userId;
}

export { cleanName, audit };
