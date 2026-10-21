import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = resolve(ROOT, 'public');

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = m => new HttpError(400, m);
export const forbidden = (m = 'You do not have access to that.') => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);

export function clientIp(req) {
  if (config.trustProxy) {
    const r = req.headers['x-real-ip'];
    if (r) return String(r).trim();
    const x = req.headers['x-forwarded-for'];
    if (x) return String(x).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

export const hostOf = req => String(req.headers['x-forwarded-host'] && config.trustProxy ? req.headers['x-forwarded-host'] : req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');

export function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  const proto = config.trustProxy && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : (req.socket.encrypted ? 'https' : 'http');
  const host = config.trustProxy && req.headers['x-forwarded-host'] ? String(req.headers['x-forwarded-host']).split(',')[0].trim() : req.headers.host;
  return `${proto}://${host}`;
}

export const isHttps = req => baseUrl(req).startsWith('https:');

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}

export function setCookie(res, req, name, value, { maxAge, path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax`;
  if (maxAge != null) c += `; Max-Age=${Math.floor(maxAge)}`;
  if (isHttps(req)) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

export const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const CSP_PAGE = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: https: http:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function baseHeaders(res, csp = CSP_APP) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  if (csp) res.setHeader('Content-Security-Policy', csp);
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  res.end(body);
}
export function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
export function sendHtml(res, status, html, extra = {}) {
  send(res, status, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
}
export function redirect(res, url, status = 302) {
  send(res, status, '', { Location: url, 'Cache-Control': 'no-store' });
}

export async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) throw new HttpError(413, 'That upload is too large.');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'That upload is too large.');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = config.maxJsonBytes) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' ? v : {}; } catch { throw bad('Invalid JSON.'); }
}

export async function readForm(req, limit = 20_000) {
  const buf = await readBody(req, limit);
  return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
}

// ---------- router ----------
export function createRouter() {
  const routes = [];
  const add = (method, path, handler) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
        return { handler: r.handler, params };
      }
      return { pathMatched };
    },
  };
}

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const VENDOR = {
  '/static/vendor/qrcode.mjs': resolve(ROOT, 'node_modules/qrcode-generator/dist/qrcode.mjs'),
  '/static/vendor/jsQR.js': resolve(ROOT, 'node_modules/jsqr/dist/jsQR.js'),
};

export function serveStatic(req, res, pathname) {
  let file = VENDOR[pathname];
  if (!file) {
    const rel = normalize(decodeURIComponent(pathname.replace(/^\/static\//, '')));
    file = resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + sep)) return false;
  }
  return serveFile(req, res, file);
}

export function serveFile(req, res, file, headers = {}) {
  if (!existsSync(file)) return false;
  const st = statSync(file);
  if (!st.isFile()) return false;
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const h = { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'no-cache', ...headers };
  if (req.headers['if-none-match'] === etag) { send(res, 304, '', h); return true; }
  send(res, 200, req.method === 'HEAD' ? '' : readFileSync(file), h);
  return true;
}
