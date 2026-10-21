import http from 'node:http';
import { config } from './config.js';
import { get, db, settings } from './db.js';
import { authenticate } from './auth.js';
import { api, cleanupOrphans } from './api.js';
import { handleScan, handleUnlock, handleReportForm, handleReportSubmit, renderNotFound } from './public.js';
import {
  HttpError, baseHeaders, sendJson, sendHtml, send, redirect, serveStatic, serveFile, PUBLIC_DIR, hostOf, CSP_PAGE,
} from './http.js';
import { resolve } from 'node:path';

const SLUG_RE = /^\/(?:r\/)?([a-z0-9][a-z0-9_-]{2,40})$/i;
const SLUG_SUB_RE = /^\/([a-z0-9][a-z0-9_-]{2,40})\/(unlock|report)$/i;

function isCustomHost(host) {
  if (!host) return false;
  if (config.publicUrl) {
    try { if (new URL(config.publicUrl).hostname === host) return false; } catch { /* ignore */ }
  }
  return !!get('SELECT 1 FROM domains WHERE host = ? AND verified = 1', host);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let o;
  try { o = new URL(origin); } catch { return false; }
  const hosts = new Set([String(req.headers.host || '').toLowerCase()]);
  if (config.trustProxy && req.headers['x-forwarded-host']) hosts.add(String(req.headers['x-forwarded-host']).split(',')[0].trim().toLowerCase());
  if (config.publicUrl) { try { hosts.add(new URL(config.publicUrl).host.toLowerCase()); } catch { /* ignore */ } }
  return hosts.has(o.host.toLowerCase());
}

async function dispatchApi(req, res, url) {
  const pathname = url.pathname.replace(/^\/api\/v1(\/|$)/, '/api$1');
  const m = api.match(req.method === 'HEAD' ? 'GET' : req.method, pathname);
  if (!m.handler) {
    return sendJson(res, m.pathMatched ? 405 : 404, { error: m.pathMatched ? 'Method not allowed.' : 'Unknown API endpoint.' });
  }
  const auth = authenticate(req);
  const ctx = {
    req, res, url, params: m.params, query: Object.fromEntries(url.searchParams),
    user: auth?.user ?? null, via: auth?.via ?? null, sessionId: auth?.sessionId,
  };
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (mutating && ctx.via !== 'key') {
    if (!sameOrigin(req) || req.headers['x-requested-with'] !== 'qr-studio') throw new HttpError(403, 'Cross-site request blocked.');
  }
  const out = await m.handler(ctx);
  if (out !== undefined && !res.writableEnded && !res.headersSent) sendJson(res, 200, out);
}

async function dispatch(req, res) {
  baseHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;
  const host = hostOf(req);
  const custom = isCustomHost(host);

  if (pathname === '/api/health' || pathname === '/health') return sendJson(res, 200, { ok: true });

  if (pathname === '/static/js/page.js') return serveStatic(req, res, pathname) || send(res, 404, '');

  if (custom && pathname === '/') {
    if (config.publicUrl) return redirect(res, config.publicUrl);
    return renderNotFound(res);
  }

  if (!custom) {
    if (pathname === '/' || pathname === '/index.html') {
      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, '');
      return serveFile(req, res, resolve(PUBLIC_DIR, 'index.html'));
    }
    if (pathname.startsWith('/static/')) { if (serveStatic(req, res, pathname)) return; return send(res, 404, 'Not found'); }
    if (pathname === '/favicon.svg' || pathname === '/favicon.ico') return serveFile(req, res, resolve(PUBLIC_DIR, 'favicon.svg')) || send(res, 404, '');
    if (pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /api/\n', { 'Content-Type': 'text/plain' });
    if (pathname.startsWith('/api/')) return dispatchApi(req, res, url);
  }

  const sub = SLUG_SUB_RE.exec(pathname);
  if (sub) {
    if (sub[2] === 'unlock' && method === 'POST') return handleUnlock(req, res, sub[1]);
    if (sub[2] === 'report') {
      if (method === 'POST') return handleReportSubmit(req, res, sub[1]);
      return handleReportForm(req, res, sub[1]);
    }
  }
  const m = SLUG_RE.exec(pathname);
  if (m && (method === 'GET' || method === 'HEAD')) return handleScan(req, res, m[1]);

  if (method === 'GET' || method === 'HEAD') {
    baseHeaders(res, CSP_PAGE);
    return renderNotFound(res);
  }
  send(res, 404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  try {
    await dispatch(req, res);
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof HttpError) {
      if (req.url.startsWith('/api/')) return sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
      return sendHtml(res, e.status, `<p>${e.message.replace(/[<>&]/g, '')}</p>`);
    }
    console.error(`[error] ${req.method} ${req.url}`, e);
    if (req.url.startsWith('/api/')) return sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
    sendHtml(res, 500, '<p>Something went wrong.</p>');
  }
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;

server.listen(config.port, config.host, () => {
  console.log(`${settings().siteName} listening on http://${config.host}:${config.port} (data: ${config.dataDir})`);
});

cleanupOrphans();
const timer = setInterval(() => { try { cleanupOrphans(); } catch (e) { console.error('cleanup failed', e.message); } }, 3600_000);
timer.unref();

function shutdown() {
  console.log('Shutting down…');
  server.close(() => { try { db.close(); } catch { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
