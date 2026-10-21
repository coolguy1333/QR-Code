import { randomBytes, createHash, createHmac, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';

const scrypt = promisify(scryptCb);

const keyFile = resolve(config.dataDir, 'secret.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = readFileSync(keyFile, 'utf8').trim();

export const token = (n = 32) => randomBytes(n).toString('base64url');
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const hmac = s => createHmac('sha256', SECRET).update(s).digest('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64');
  return key.length === want.length && timingSafeEqual(key, want);
}

/** Signed, expiring value: `payload.exp.sig`. */
export function sign(payload, ttlMs) {
  const body = `${payload}.${Date.now() + ttlMs}`;
  return `${body}.${hmac(body)}`;
}
export function unsign(v) {
  const i = String(v).lastIndexOf('.');
  if (i < 0) return null;
  const body = v.slice(0, i), sig = v.slice(i + 1);
  if (!safeEqual(hmac(body), sig)) return null;
  const j = body.lastIndexOf('.');
  if (Number(body.slice(j + 1)) < Date.now()) return null;
  return body.slice(0, j);
}

// ---------- tiny in-memory rate limiter ----------
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}
export function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  return (buckets.get(key) || []).filter(t => now - t < windowMs).length >= limit;
}
export const rateReset = key => buckets.delete(key);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 3600_000) buckets.delete(k);
}, 600_000).unref();

export function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (email && pw.toLowerCase() === email.toLowerCase()) return 'Password cannot be your email address.';
  return '';
}
