// Everything a visitor sees after scanning a dynamic code.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { get, run, settings } from './db.js';
import { config } from './config.js';
import { verifyPassword, sign, unsign, rateLimit } from './security.js';
import { send, sendHtml, redirect, parseCookies, setCookie, readForm, baseHeaders, CSP_PAGE, clientIp } from './http.js';
import { recordScan } from './analytics.js';
import { isBlockedUrl } from './codes.js';
import { fireWebhooks } from './webhooks.js';
import { safeUrl, socialUrl, paymentUrl, mailtoUrl, telUri, geoParts, vcardText, icsText, CRYPTOS } from '../public/js/qr-content.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parse = s => { try { return JSON.parse(s); } catch { return {}; } };

const BASE_CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
:root{--bg:#f4f5f8;--fg:#14161f;--card:#fff;--muted:#626a7d;--line:#e3e6ee;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0e1017;--fg:#eef0f6;--card:#181b25;--muted:#9aa2b6;--line:#2a2f3d}}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px 24px;box-shadow:0 10px 40px rgba(20,22,40,.08);text-align:center}
h1{margin:0 0 8px;font-size:1.5rem;line-height:1.25;overflow-wrap:anywhere}p{margin:0 0 16px;color:var(--muted);overflow-wrap:anywhere}
.btn{display:inline-block;width:100%;padding:13px 18px;border-radius:12px;border:0;background:var(--accent);color:#fff;font:600 1rem system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.alt{background:transparent;color:var(--fg);border:1px solid var(--line);margin-top:10px}
input[type=password]{width:100%;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;margin-bottom:12px}
pre{white-space:pre-wrap;word-break:break-word;text-align:left;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 14px;font:inherit}
dl{margin:0 0 16px;text-align:left}dt{font-size:.8rem;color:var(--muted);margin-top:10px}dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}
.err{color:#c62828;font-weight:600}.foot{margin-top:18px;font-size:.8rem;color:var(--muted)}.foot a{color:inherit}
img.hero{max-width:100%;border-radius:14px;margin-bottom:16px}
`;

function layout({ title, body, accent, css = '', head = '' }) {
  const a = /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : '#2563eb';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${BASE_CSS}:root{--accent:${a}}${css}</style>${head}</head><body>${body}<script src="/static/js/page.js"></script></body></html>`;
}

function foot(slug) {
  const s = settings();
  return `<div class="foot">Made with <a href="${esc(config.publicUrl || '/')}">${esc(s.siteName)}</a>${slug ? ` · <a href="/${esc(slug)}/report">Report</a>` : ''}</div>`;
}

function messagePage(res, status, title, text, slug) {
  baseHeaders(res, CSP_PAGE);
  sendHtml(res, status, layout({ title, body: `<main class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p></main>${foot(slug)}` }));
}

export function renderNotFound(res) { messagePage(res, 404, 'QR code not found', 'This link does not exist, or the QR code was deleted.'); }

function passwordPage(res, slug, error) {
  baseHeaders(res, CSP_PAGE);
  sendHtml(res, error ? 401 : 200, layout({
    title: 'Password required',
    body: `<main class="card"><h1>Password required</h1><p>The owner of this QR code protected it with a password.</p>
<form method="post" action="/${esc(slug)}/unlock"><input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
${error ? `<p class="err">${esc(error)}</p>` : ''}<button class="btn" type="submit">Continue</button></form></main>${foot(slug)}`,
  }));
}

function interstitial(res, slug, title, text, url, label) {
  baseHeaders(res, CSP_PAGE);
  sendHtml(res, 200, layout({
    title,
    head: `<meta http-equiv="refresh" content="0;url=${esc(url)}">`,
    body: `<main class="card"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="${esc(url)}">${esc(label)}</a></main>${foot(slug)}`,
  }));
}

const copyBtn = (v, label = 'Copy') => `<button class="btn alt" type="button" data-copy="${esc(v)}">${esc(label)}</button>`;

function textPage(res, row, f) {
  baseHeaders(res, CSP_PAGE);
  sendHtml(res, 200, layout({ title: row.name, body: `<main class="card"><pre>${esc(f.text)}</pre>${copyBtn(f.text, 'Copy text')}</main>${foot(row.slug)}` }));
}

function wifiPage(res, row, f) {
  baseHeaders(res, CSP_PAGE);
  const open = f.security === 'nopass';
  sendHtml(res, 200, layout({
    title: 'Wi-Fi network',
    body: `<main class="card"><h1>Wi-Fi network</h1><dl><dt>Network</dt><dd>${esc(f.ssid)}</dd><dt>Security</dt><dd>${open ? 'Open (no password)' : esc(f.security)}</dd>${open ? '' : `<dt>Password</dt><dd>${esc(f.password || '—')}</dd>`}</dl>
${copyBtn(f.ssid, 'Copy network name')}${open || !f.password ? '' : copyBtn(f.password, 'Copy password')}<p class="foot">Open your Wi-Fi settings, choose this network and enter the password.</p></main>${foot(row.slug)}`,
  }));
}

function cryptoPage(res, row, f) {
  baseHeaders(res, CSP_PAGE);
  const c = CRYPTOS[f.coin] || CRYPTOS.bitcoin;
  const uri = paymentUrl(f);
  sendHtml(res, 200, layout({
    title: 'Crypto payment',
    body: `<main class="card"><h1>Pay with ${esc(c.label)}</h1><dl><dt>Address</dt><dd>${esc(f.address)}</dd>${f.amount ? `<dt>Amount</dt><dd>${esc(f.amount)}</dd>` : ''}</dl>
<a class="btn" href="${esc(uri)}">Open in wallet</a>${copyBtn(f.address, 'Copy address')}</main>${foot(row.slug)}`,
  }));
}

function landingPage(res, row, f) {
  baseHeaders(res, CSP_PAGE);
  sendHtml(res, 200, layout({
    title: f.title, accent: f.color,
    body: `<main class="card">${f.image ? `<img class="hero" src="${esc(f.image)}" alt="">` : ''}<h1>${esc(f.title)}</h1>${f.description ? `<p style="white-space:pre-wrap;color:var(--fg)">${esc(f.description)}</p>` : ''}${f.buttonUrl ? `<a class="btn" rel="noopener nofollow ugc" href="${esc(f.buttonUrl)}">${esc(f.buttonText || 'Learn more')}</a>` : ''}</main>${foot(row.slug)}`,
  }));
}

function bioPage(res, row, f) {
  baseHeaders(res, CSP_PAGE);
  const dark = f.theme === 'dark';
  const css = dark ? ':root{--bg:#0e1017;--fg:#eef0f6;--card:#181b25;--muted:#9aa2b6;--line:#2a2f3d}' : ':root{--bg:#f4f5f8;--fg:#14161f;--card:#fff;--muted:#626a7d;--line:#e3e6ee}';
  const links = (f.links || []).map(l => `<a class="btn lnk" rel="noopener nofollow ugc" href="${esc(l.url)}">${esc(l.label)}</a>`).join('');
  sendHtml(res, 200, layout({
    title: f.name, accent: f.color,
    css: `${css}@media(prefers-color-scheme:dark){${dark ? '' : ':root{--bg:#f4f5f8;--fg:#14161f;--card:#fff;--muted:#626a7d;--line:#e3e6ee}'}}.lnk{display:block;margin-bottom:10px}.av{width:92px;height:92px;border-radius:50%;object-fit:cover;margin-bottom:12px;border:3px solid var(--accent)}`,
    body: `<main class="card">${f.avatar ? `<img class="av" src="${esc(f.avatar)}" alt="">` : ''}<h1>${esc(f.name)}</h1>${f.bio ? `<p style="white-space:pre-wrap">${esc(f.bio)}</p>` : ''}${links}</main>${foot(row.slug)}`,
  }));
}

function download(res, mime, filename, body) {
  send(res, 200, body, { 'Content-Type': `${mime}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
}

const INLINE_MIME = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/;
function serveHostedFile(req, res, f) {
  const path = resolve(config.dataDir, 'files', f.id);
  if (!existsSync(path)) return messagePage(res, 404, 'File missing', 'The file for this QR code is no longer available.');
  const size = statSync(path).size;
  const name = f.name.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'file';
  const inline = INLINE_MIME.test(f.mime);
  res.writeHead(200, {
    'Content-Type': f.mime, 'Content-Length': size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=60',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}

function pickAppUrl(ua, f) {
  if (/iPhone|iPad|iPod/i.test(ua)) return f.ios || f.fallback || f.android;
  if (/Android/i.test(ua)) return f.android || f.fallback || f.ios;
  return f.fallback || f.ios || f.android;
}

function unlockCookie(code) { return `qru_${code.id}`; }
function isUnlocked(req, code) {
  const v = parseCookies(req)[unlockCookie(code)];
  return !!v && unsign(v) === String(code.id);
}

export async function handleScan(req, res, slug) {
  const code = get('SELECT c.*, u.status AS owner_status FROM codes c JOIN users u ON u.id = c.user_id WHERE c.slug = ?', slug.toLowerCase());
  if (!code || !code.dynamic) return renderNotFound(res);
  if (code.owner_status !== 'active' || code.status === 'blocked') return messagePage(res, 410, 'QR code disabled', 'This QR code has been disabled by the site administrators.', code.slug);
  if (code.status === 'paused') return messagePage(res, 503, 'Temporarily unavailable', 'The owner of this QR code has paused it. Please try again later.', code.slug);
  if (code.expires_at && code.expires_at < Date.now()) return messagePage(res, 410, 'This QR code has expired', 'The owner set an end date for this code and it has passed.', code.slug);
  if (code.pass_hash && !isUnlocked(req, code)) return passwordPage(res, code.slug, '');

  const f = parse(code.fields);
  const ua = String(req.headers['user-agent'] || '');
  let action;
  try {
    action = resolveAction(code, f, ua);
  } catch {
    return messagePage(res, 500, 'Something is wrong with this QR code', 'The content of this code is not valid anymore.', code.slug);
  }
  if (action.url && isBlockedUrl(action.url)) return messagePage(res, 451, 'Link blocked', 'The destination of this QR code is not allowed on this site.', code.slug);

  if (req.method === 'GET' && !req.headers.range) {
    try {
      const ip = clientIp(req);
      const rec = recordScan(req, ip, code);
      if (rec) fireWebhooks(code.user_id, 'scan', { codeId: code.id, slug: code.slug, name: code.name, type: code.type, country: rec.country, city: rec.city, device: rec.device, os: rec.os, browser: rec.browser, referrer: rec.referrer, at: new Date(rec.ts).toISOString() });
    } catch (e) { console.error('scan record failed', e.message); }
  }
  baseHeaders(res, CSP_PAGE);
  return action.run(res);

  function resolveAction(row, fields, agent) {
    switch (row.type) {
      case 'url': { const url = safeUrl(fields.url); return { url, run: r => redirect(r, url) }; }
      case 'social': { const url = socialUrl(fields); return { url, run: r => redirect(r, url) }; }
      case 'app': { const url = safeUrl(pickAppUrl(agent, fields)); return { url, run: r => redirect(r, url) }; }
      case 'payment': {
        if (fields.kind === 'crypto') return { run: r => cryptoPage(r, row, fields) };
        const url = paymentUrl(fields);
        return { url, run: r => redirect(r, url) };
      }
      case 'email': { const url = mailtoUrl(fields); return { run: r => interstitial(r, row.slug, 'Send an email', fields.to, url, 'Open email app') }; }
      case 'phone': { const url = `tel:${telUri(fields.number)}`; return { run: r => interstitial(r, row.slug, 'Call', fields.number, url, 'Call now') }; }
      case 'sms': { const n = telUri(fields.number); const url = `sms:${n}${fields.message ? `?&body=${encodeURIComponent(fields.message)}` : ''}`; return { run: r => interstitial(r, row.slug, 'Send a text message', fields.number, url, 'Open messages') }; }
      case 'geo': { const g = geoParts(fields); const url = `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`; return { url, run: r => redirect(r, url) }; }
      case 'text': return { run: r => textPage(r, row, fields) };
      case 'wifi': return { run: r => wifiPage(r, row, fields) };
      case 'vcard': return { run: r => download(r, 'text/vcard', 'contact.vcf', vcardText(fields)) };
      case 'event': return { run: r => download(r, 'text/calendar', 'event.ics', icsText(fields)) };
      case 'landing': return { url: fields.buttonUrl || undefined, run: r => landingPage(r, row, fields) };
      case 'bio': return { run: r => bioPage(r, row, fields) };
      case 'pdf': {
        const file = get('SELECT * FROM files WHERE id = ?', fields.file);
        if (!file) throw new Error('missing file');
        return { run: r => { baseHeaders(r, null); serveHostedFile(req, r, file); } };
      }
      default: throw new Error('unknown type');
    }
  }
}

export async function handleUnlock(req, res, slug) {
  const code = get('SELECT * FROM codes WHERE slug = ? AND dynamic = 1', slug.toLowerCase());
  if (!code || !code.pass_hash) return renderNotFound(res);
  const ip = clientIp(req);
  if (!rateLimit(`unlock:${ip}:${code.id}`, 10, 10 * 60_000)) return messagePage(res, 429, 'Too many attempts', 'Please wait a few minutes and try again.', code.slug);
  const form = await readForm(req);
  if (!(await verifyPassword(String(form.password || ''), code.pass_hash))) return passwordPage(res, code.slug, 'That password is not correct.');
  setCookie(res, req, unlockCookie(code), sign(String(code.id), 3600_000), { maxAge: 3600 });
  redirect(res, `/${code.slug}`, 303);
}

export function handleReportForm(req, res, slug, sent = false) {
  const code = get('SELECT slug, name FROM codes WHERE slug = ? AND dynamic = 1', slug.toLowerCase());
  if (!code) return renderNotFound(res);
  baseHeaders(res, CSP_PAGE);
  sendHtml(res, 200, layout({
    title: 'Report a QR code',
    body: sent
      ? `<main class="card"><h1>Thank you</h1><p>Your report was sent to the site administrators.</p></main>`
      : `<main class="card"><h1>Report this QR code</h1><p>Tell us what is wrong (spam, scam, malware, illegal content…).</p>
<form method="post" action="/${esc(code.slug)}/report"><textarea name="reason" required maxlength="500" rows="4" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;margin-bottom:12px"></textarea><button class="btn" type="submit">Send report</button></form></main>`,
  }));
}

export async function handleReportSubmit(req, res, slug) {
  const code = get('SELECT id, slug FROM codes WHERE slug = ? AND dynamic = 1', slug.toLowerCase());
  if (!code) return renderNotFound(res);
  const ip = clientIp(req);
  if (!rateLimit(`report:${ip}`, 5, 3600_000)) return messagePage(res, 429, 'Too many reports', 'Please try again later.', code.slug);
  const form = await readForm(req);
  const reason = String(form.reason || '').trim().slice(0, 500);
  if (!reason) return handleReportForm(req, res, slug);
  run('INSERT INTO reports(code_id,reason,reporter,created_at) VALUES(?,?,?,?)', code.id, reason, '', Date.now());
  handleReportForm(req, res, slug, true);
}

