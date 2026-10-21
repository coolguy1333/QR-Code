import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { config } from './config.js';

export const db = new DatabaseSync(resolve(config.dataDir, 'qr.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  max_codes INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  host TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  dynamic INTEGER NOT NULL DEFAULT 0,
  fields TEXT NOT NULL,
  style TEXT NOT NULL,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  domain_id INTEGER REFERENCES domains(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER,
  pass_hash TEXT,
  scan_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS codes_user ON codes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS codes_campaign ON codes(campaign_id);
CREATE INDEX IF NOT EXISTS codes_folder ON codes(folder_id);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  visitor TEXT,
  country TEXT, region TEXT, city TEXT,
  device TEXT, os TEXT, browser TEXT,
  referrer TEXT, lang TEXT
);
CREATE INDEX IF NOT EXISTS scans_code_ts ON scans(code_id, ts);
CREATE INDEX IF NOT EXISTS scans_ts ON scans(ts);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_id INTEGER REFERENCES codes(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT 'scan',
  active INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  last_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_id INTEGER NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  reporter TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_id INTEGER,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_ts ON audit(ts DESC);
`);

const cache = new Map();
const stmt = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };

export const get = (sql, ...p) => stmt(sql).get(...p);
export const all = (sql, ...p) => stmt(sql).all(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- settings ----------
export const SETTING_DEFAULTS = {
  siteName: config.siteName,
  registration: 'open',         // open | approval | closed
  defaultMaxCodes: 1000,        // per user, 0 = unlimited
  maxBulk: 500,                 // rows per bulk request
  maxStorageMB: 200,            // hosted files per user, 0 = unlimited
  allowUserDomains: true,
  announcement: '',
  blockedHosts: '',             // destination hosts that dynamic codes may not point to (one per line)
  scanRetentionDays: 0,         // 0 = keep forever
};

let settingsCache = null;
export function settings() {
  if (!settingsCache) {
    const s = { ...SETTING_DEFAULTS };
    for (const r of all('SELECT key, value FROM settings')) {
      if (r.key in s) { try { s[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
    }
    settingsCache = s;
  }
  return settingsCache;
}
export function saveSettings(patch) {
  tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in SETTING_DEFAULTS) run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v));
    }
  });
  settingsCache = null;
  return settings();
}

export function audit(actor, action, target = '', detail = '') {
  run('INSERT INTO audit(ts,actor_id,actor,action,target,detail) VALUES(?,?,?,?,?,?)', Date.now(), actor?.id ?? null, actor?.email ?? 'system', action, String(target), String(detail).slice(0, 500));
}
