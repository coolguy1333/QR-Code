import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { all, run } from './db.js';
import { createHmac } from 'node:crypto';
import { bad } from './http.js';

function privateAddr(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}

export async function assertPublicHttps(u) {
  let url;
  try { url = new URL(u); } catch { throw bad('Enter a valid https:// URL.'); }
  if (url.protocol !== 'https:') throw bad('Webhook URLs must start with https://');
  if (url.username || url.password) throw bad('Webhook URLs cannot contain credentials.');
  let addrs;
  try { addrs = await lookup(url.hostname, { all: true }); } catch { throw bad('That webhook host could not be resolved.'); }
  if (!addrs.length || addrs.some(a => privateAddr(a.address))) throw bad('Webhook URLs must point to a public server.');
  return url.toString();
}

export async function deliver(hook, event, payload) {
  const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });
  let status = 'error';
  try {
    const url = await assertPublicHttps(hook.url);
    const res = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(6000),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'QR-Studio-Webhook/1', 'X-QR-Signature': `sha256=${hmacFor(hook.secret, body)}`, 'X-QR-Event': event },
      body,
    });
    status = String(res.status);
  } catch (e) { status = String(e.message || 'error').slice(0, 60); }
  run('UPDATE webhooks SET last_status = ?, last_at = ? WHERE id = ?', status, Date.now(), hook.id);
  return status;
}

const hmacFor = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');

export function fireWebhooks(userId, event, payload) {
  const hooks = all("SELECT * FROM webhooks WHERE user_id = ? AND active = 1", userId).filter(h => h.events.split(',').includes(event));
  for (const h of hooks) deliver(h, event, payload).catch(() => {});
}
