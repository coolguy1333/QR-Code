import { createRequire } from 'node:module';
import { all, get, run } from './db.js';
import { sha256 } from './security.js';

const require = createRequire(import.meta.url);
let geoip = null;
try { geoip = require('geoip-country'); } catch { /* optional */ }

// ---------- user-agent ----------
export function parseUA(ua = '') {
  const u = String(ua);
  let os = 'Other';
  if (/iPhone|iPad|iPod/i.test(u)) os = 'iOS';
  else if (/Android/i.test(u)) os = 'Android';
  else if (/CrOS/i.test(u)) os = 'ChromeOS';
  else if (/Windows/i.test(u)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(u)) os = 'macOS';
  else if (/Linux|X11/i.test(u)) os = 'Linux';
  let device = 'Desktop';
  if (/bot|crawl|spider|preview|facebookexternalhit|slurp|headless|curl|wget|python-requests|go-http/i.test(u)) device = 'Bot';
  else if (/iPad|Tablet|Android(?!.*Mobile)/i.test(u)) device = 'Tablet';
  else if (/Mobi|iPhone|iPod|Android/i.test(u)) device = 'Mobile';
  let browser = 'Other';
  if (/Instagram/i.test(u)) browser = 'Instagram';
  else if (/FBAN|FBAV/i.test(u)) browser = 'Facebook';
  else if (/SamsungBrowser/i.test(u)) browser = 'Samsung Internet';
  else if (/Edg\//i.test(u)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(u)) browser = 'Opera';
  else if (/Firefox|FxiOS/i.test(u)) browser = 'Firefox';
  else if (/Chrome|CriOS/i.test(u)) browser = 'Chrome';
  else if (/Safari/i.test(u)) browser = 'Safari';
  return { os, device, browser };
}

const hdr = (req, n) => { const v = req.headers[n]; return v ? String(v) : ''; };

export function geoFor(req, ip) {
  let country = (hdr(req, 'cf-ipcountry') || hdr(req, 'x-vercel-ip-country') || hdr(req, 'cloudfront-viewer-country') || hdr(req, 'x-country-code')).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === 'XX' || country === 'T1') country = '';
  if (!country && geoip && ip) { try { country = geoip.lookup(ip)?.country || ''; } catch { /* ignore */ } }
  const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
  const city = dec(hdr(req, 'cf-ipcity') || hdr(req, 'x-vercel-ip-city')).slice(0, 80);
  const region = dec(hdr(req, 'cf-region') || hdr(req, 'x-vercel-ip-country-region') || hdr(req, 'cf-region-code')).slice(0, 80);
  return { country, city, region };
}

function referrerHost(req) {
  const r = hdr(req, 'referer');
  if (!r) return 'Direct / unknown';
  try { return new URL(r).hostname.replace(/^www\./, '').slice(0, 100) || 'Direct / unknown'; } catch { return 'Direct / unknown'; }
}

/** Returns the scan record (for webhooks) or null for bots. */
export function recordScan(req, ip, code) {
  const ua = hdr(req, 'user-agent');
  const { os, device, browser } = parseUA(ua);
  if (device === 'Bot') return null;
  const geo = geoFor(req, ip);
  const rec = {
    code_id: code.id, ts: Date.now(),
    visitor: sha256(`${ip}|${ua}`).slice(0, 16),
    country: geo.country, region: geo.region, city: geo.city,
    device, os, browser,
    referrer: referrerHost(req),
    lang: hdr(req, 'accept-language').split(',')[0].slice(0, 12),
  };
  run('INSERT INTO scans(code_id,ts,visitor,country,region,city,device,os,browser,referrer,lang) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    rec.code_id, rec.ts, rec.visitor, rec.country, rec.region, rec.city, rec.device, rec.os, rec.browser, rec.referrer, rec.lang);
  run('UPDATE codes SET scan_count = scan_count + 1 WHERE id = ?', code.id);
  return rec;
}

// ---------- stats ----------
/**
 * @param {string} where   SQL condition on table `c` (codes), e.g. "c.user_id = ?"
 * @param {any[]} params
 */
export function statsFor(where, params, { days = 30, tz = 0 } = {}) {
  days = Math.min(365, Math.max(1, Number(days) || 30));
  tz = Math.min(840, Math.max(-840, Math.round(Number(tz) || 0)));
  const now = Date.now();
  const since = now - days * 86400_000;
  const base = `FROM scans s JOIN codes c ON c.id = s.code_id WHERE ${where} AND s.ts >= ?`;
  const p = [...params, since];
  const totals = get(`SELECT COUNT(*) AS total, COUNT(DISTINCT s.visitor) AS uniq ${base}`, ...p);
  const shift = tz * 60;
  const seriesRows = all(`SELECT strftime('%Y-%m-%d', (s.ts/1000) + ${shift}, 'unixepoch') AS d, COUNT(*) AS scans, COUNT(DISTINCT s.visitor) AS uniq ${base} GROUP BY d`, ...p);
  const byDay = new Map(seriesRows.map(r => [r.d, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now + shift * 1000 - i * 86400_000).toISOString().slice(0, 10);
    const r = byDay.get(d);
    series.push({ d, scans: r?.scans || 0, unique: r?.uniq || 0 });
  }
  const hourRows = all(`SELECT CAST(strftime('%H', (s.ts/1000) + ${shift}, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS n ${base} GROUP BY h`, ...p);
  const hours = Array.from({ length: 24 }, (_, h) => hourRows.find(r => r.h === h)?.n || 0);
  const top = col => all(`SELECT COALESCE(NULLIF(s.${col}, ''), 'Unknown') AS k, COUNT(*) AS n ${base} GROUP BY k ORDER BY n DESC LIMIT 12`, ...p);
  return {
    days, total: totals.total, unique: totals.uniq, series, hours,
    countries: top('country'), cities: top('city'), devices: top('device'), os: top('os'), browsers: top('browser'), referrers: top('referrer'),
    topCodes: all(`SELECT c.id, c.name, COUNT(*) AS n ${base} GROUP BY c.id ORDER BY n DESC LIMIT 10`, ...p),
  };
}
