// Content types: field schemas, validation and static-payload encoding.
// Runs unchanged in the browser and in Node.

export const SOCIALS = {
  instagram: { label: 'Instagram', url: h => `https://instagram.com/${h}` },
  facebook: { label: 'Facebook', url: h => `https://facebook.com/${h}` },
  x: { label: 'X (Twitter)', url: h => `https://x.com/${h}` },
  tiktok: { label: 'TikTok', url: h => `https://tiktok.com/@${h}` },
  youtube: { label: 'YouTube', url: h => `https://youtube.com/@${h}` },
  linkedin: { label: 'LinkedIn', url: h => `https://linkedin.com/in/${h}` },
  github: { label: 'GitHub', url: h => `https://github.com/${h}` },
  snapchat: { label: 'Snapchat', url: h => `https://snapchat.com/add/${h}` },
  pinterest: { label: 'Pinterest', url: h => `https://pinterest.com/${h}` },
  threads: { label: 'Threads', url: h => `https://threads.net/@${h}` },
  twitch: { label: 'Twitch', url: h => `https://twitch.tv/${h}` },
  reddit: { label: 'Reddit', url: h => `https://reddit.com/user/${h}` },
  telegram: { label: 'Telegram', url: h => `https://t.me/${h}` },
  whatsapp: { label: 'WhatsApp (phone number)', url: h => `https://wa.me/${h.replace(/\D/g, '')}` },
  spotify: { label: 'Spotify (artist/user ID)', url: h => `https://open.spotify.com/user/${h}` },
  custom: { label: 'Other (full link)', url: h => h },
};

export const CRYPTOS = {
  bitcoin: { label: 'Bitcoin (BTC)', scheme: 'bitcoin', param: 'amount' },
  litecoin: { label: 'Litecoin (LTC)', scheme: 'litecoin', param: 'amount' },
  bitcoincash: { label: 'Bitcoin Cash (BCH)', scheme: 'bitcoincash', param: 'amount' },
  dogecoin: { label: 'Dogecoin (DOGE)', scheme: 'dogecoin', param: 'amount' },
  dash: { label: 'Dash', scheme: 'dash', param: 'amount' },
  ethereum: { label: 'Ethereum (ETH)', scheme: 'ethereum', param: 'value' },
};

const opt = (arr) => arr.map(([value, label]) => ({ value, label }));

// kind: text|textarea|url|email|tel|number|datetime|checkbox|select|color|file|image|links
export const TYPES = {
  url: {
    label: 'Website URL', group: 'Link', dynamicOk: true,
    fields: [{ key: 'url', label: 'Website address', kind: 'url', required: true, placeholder: 'https://example.com' }],
  },
  text: {
    label: 'Plain text', group: 'Text', dynamicOk: true,
    fields: [{ key: 'text', label: 'Text', kind: 'textarea', required: true, max: 1500 }],
  },
  email: {
    label: 'Email', group: 'Contact', dynamicOk: true,
    fields: [
      { key: 'to', label: 'Email address', kind: 'email', required: true, placeholder: 'hello@example.com' },
      { key: 'subject', label: 'Subject', kind: 'text' },
      { key: 'body', label: 'Message', kind: 'textarea' },
    ],
  },
  phone: {
    label: 'Phone call', group: 'Contact', dynamicOk: true,
    fields: [{ key: 'number', label: 'Phone number', kind: 'tel', required: true, placeholder: '+1 555 123 4567' }],
  },
  sms: {
    label: 'SMS', group: 'Contact', dynamicOk: true,
    fields: [
      { key: 'number', label: 'Phone number', kind: 'tel', required: true, placeholder: '+1 555 123 4567' },
      { key: 'message', label: 'Message', kind: 'textarea' },
    ],
  },
  vcard: {
    label: 'Contact card (vCard)', group: 'Contact', dynamicOk: true,
    fields: [
      { key: 'first', label: 'First name', kind: 'text', half: true },
      { key: 'last', label: 'Last name', kind: 'text', half: true },
      { key: 'org', label: 'Company', kind: 'text', half: true },
      { key: 'title', label: 'Job title', kind: 'text', half: true },
      { key: 'mobile', label: 'Mobile', kind: 'tel', half: true },
      { key: 'phone', label: 'Work phone', kind: 'tel', half: true },
      { key: 'email', label: 'Email', kind: 'email', half: true },
      { key: 'website', label: 'Website', kind: 'url', half: true },
      { key: 'street', label: 'Street', kind: 'text' },
      { key: 'city', label: 'City', kind: 'text', half: true },
      { key: 'state', label: 'State / region', kind: 'text', half: true },
      { key: 'zip', label: 'Postal code', kind: 'text', half: true },
      { key: 'country', label: 'Country', kind: 'text', half: true },
      { key: 'note', label: 'Note', kind: 'textarea' },
    ],
    check: f => (f.first || f.last || f.org) ? '' : 'Enter a name or company.',
  },
  wifi: {
    label: 'Wi-Fi login', group: 'Text', dynamicOk: true,
    fields: [
      { key: 'ssid', label: 'Network name (SSID)', kind: 'text', required: true },
      { key: 'password', label: 'Password', kind: 'text' },
      { key: 'security', label: 'Security', kind: 'select', options: opt([['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'No password']]), default: 'WPA' },
      { key: 'hidden', label: 'Hidden network', kind: 'checkbox' },
    ],
  },
  geo: {
    label: 'Location', group: 'Text', dynamicOk: true,
    fields: [
      { key: 'lat', label: 'Latitude', kind: 'number', required: true, half: true, placeholder: '48.8584' },
      { key: 'lng', label: 'Longitude', kind: 'number', required: true, half: true, placeholder: '2.2945' },
      { key: 'label', label: 'Place name (optional)', kind: 'text' },
    ],
  },
  event: {
    label: 'Calendar event', group: 'Text', dynamicOk: true,
    fields: [
      { key: 'title', label: 'Event title', kind: 'text', required: true },
      { key: 'start', label: 'Starts', kind: 'datetime', required: true, half: true },
      { key: 'end', label: 'Ends', kind: 'datetime', half: true },
      { key: 'allDay', label: 'All-day event', kind: 'checkbox' },
      { key: 'location', label: 'Location', kind: 'text' },
      { key: 'description', label: 'Description', kind: 'textarea' },
    ],
  },
  app: {
    label: 'App store link', group: 'Link', dynamicOk: true,
    hint: 'Dynamic codes send iPhone, Android and desktop visitors to the right store. Static codes use the first link filled in.',
    fields: [
      { key: 'ios', label: 'App Store link (iPhone / iPad)', kind: 'url', placeholder: 'https://apps.apple.com/app/id…' },
      { key: 'android', label: 'Google Play link (Android)', kind: 'url', placeholder: 'https://play.google.com/store/apps/details?id=…' },
      { key: 'fallback', label: 'Other devices (website)', kind: 'url' },
    ],
    check: f => (f.ios || f.android || f.fallback) ? '' : 'Enter at least one link.',
  },
  social: {
    label: 'Social media', group: 'Link', dynamicOk: true,
    fields: [
      { key: 'platform', label: 'Platform', kind: 'select', options: Object.entries(SOCIALS).map(([value, v]) => ({ value, label: v.label })), default: 'instagram' },
      { key: 'handle', label: 'Username or link', kind: 'text', required: true, placeholder: 'yourname' },
    ],
  },
  payment: {
    label: 'Payment link', group: 'Link', dynamicOk: true,
    fields: [
      { key: 'kind', label: 'Payment type', kind: 'select', options: opt([['paypal', 'PayPal.Me'], ['crypto', 'Crypto address'], ['link', 'Other payment link']]), default: 'paypal' },
      { key: 'handle', label: 'PayPal.Me username', kind: 'text', required: true, showIf: { kind: 'paypal' }, placeholder: 'yourname' },
      { key: 'amount', label: 'Amount (optional)', kind: 'text', showIf: { kind: ['paypal', 'crypto'] }, half: true },
      { key: 'currency', label: 'Currency', kind: 'text', showIf: { kind: 'paypal' }, half: true, default: 'USD' },
      { key: 'coin', label: 'Coin', kind: 'select', options: Object.entries(CRYPTOS).map(([value, v]) => ({ value, label: v.label })), showIf: { kind: 'crypto' }, default: 'bitcoin' },
      { key: 'address', label: 'Wallet address', kind: 'text', required: true, showIf: { kind: 'crypto' } },
      { key: 'url', label: 'Payment link', kind: 'url', required: true, showIf: { kind: 'link' }, placeholder: 'https://venmo.com/… or https://cash.app/$…' },
    ],
  },
  pdf: {
    label: 'PDF / file', group: 'Hosted', dynamicOnly: true,
    hint: 'The file is hosted here and the code opens it. Max 15 MB.',
    fields: [
      { key: 'file', label: 'File', kind: 'file', required: true },
      { key: 'title', label: 'Title (optional)', kind: 'text' },
    ],
  },
  landing: {
    label: 'Landing page', group: 'Hosted', dynamicOnly: true,
    hint: 'A simple hosted page with a headline, text and a button.',
    fields: [
      { key: 'title', label: 'Headline', kind: 'text', required: true },
      { key: 'description', label: 'Text', kind: 'textarea', max: 1500 },
      { key: 'image', label: 'Image (optional)', kind: 'image' },
      { key: 'buttonText', label: 'Button text', kind: 'text', half: true, placeholder: 'Learn more' },
      { key: 'buttonUrl', label: 'Button link', kind: 'url', half: true },
      { key: 'color', label: 'Accent color', kind: 'color', default: '#2563eb' },
    ],
  },
  bio: {
    label: 'Link-in-bio page', group: 'Hosted', dynamicOnly: true,
    hint: 'A page of links, like a mini profile. Edit it any time.',
    fields: [
      { key: 'name', label: 'Name / title', kind: 'text', required: true },
      { key: 'bio', label: 'Short bio', kind: 'textarea', max: 500 },
      { key: 'avatar', label: 'Photo (optional)', kind: 'image' },
      { key: 'links', label: 'Links', kind: 'links' },
      { key: 'theme', label: 'Theme', kind: 'select', options: opt([['light', 'Light'], ['dark', 'Dark']]), default: 'light', half: true },
      { key: 'color', label: 'Accent color', kind: 'color', default: '#7c3aed', half: true },
    ],
    check: f => (f.links && f.links.length) ? '' : 'Add at least one link.',
  },
};

export const TYPE_GROUPS = ['Link', 'Contact', 'Text', 'Hosted'];

// ---------- helpers ----------

export function safeUrl(u, { schemes = ['http', 'https'] } = {}) {
  let s = String(u ?? '').trim();
  if (!s) throw new Error('A link is required.');
  if (/[\u0000-\u001f\s]/.test(s)) s = s.replace(/\s+/g, '');
  const m = s.match(/^([a-z][a-z0-9+.-]*):/i);
  if (m) {
    if (!schemes.includes(m[1].toLowerCase())) throw new Error(`Links must start with ${schemes.map(x => x + '://').join(' or ')}`);
  } else if (s.startsWith('//')) {
    s = 'https:' + s;
  } else {
    s = 'https://' + s;
  }
  let parsed;
  try { parsed = new URL(s); } catch { throw new Error('That does not look like a valid link.'); }
  if (['http:', 'https:'].includes(parsed.protocol) && !parsed.hostname.includes('.') && parsed.hostname !== 'localhost') throw new Error('That does not look like a valid link.');
  return s;
}

const esc = (s, re = /[\;,:"]/g) => String(s).replace(re, c => '\\' + c);
const vEsc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\;').replace(/,/g, '\\,');
const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export function vcardText(f) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${vEsc(f.last)};${vEsc(f.first)};;;`);
  lines.push(`FN:${vEsc([f.first, f.last].filter(Boolean).join(' ') || f.org)}`);
  if (f.org) lines.push(`ORG:${vEsc(f.org)}`);
  if (f.title) lines.push(`TITLE:${vEsc(f.title)}`);
  if (f.mobile) lines.push(`TEL;TYPE=CELL:${vEsc(f.mobile)}`);
  if (f.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(f.phone)}`);
  if (f.email) lines.push(`EMAIL:${vEsc(f.email)}`);
  if (f.website) lines.push(`URL:${vEsc(f.website)}`);
  if (f.street || f.city || f.state || f.zip || f.country) {
    lines.push(`ADR;TYPE=WORK:;;${vEsc(f.street)};${vEsc(f.city)};${vEsc(f.state)};${vEsc(f.zip)};${vEsc(f.country)}`);
  }
  if (f.note) lines.push(`NOTE:${vEsc(f.note)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function wifiText(f) {
  const sec = ['WPA', 'WEP', 'nopass'].includes(f.security) ? f.security : 'WPA';
  let s = `WIFI:T:${sec};S:${esc(f.ssid)};`;
  if (sec !== 'nopass' && f.password) s += `P:${esc(f.password)};`;
  if (f.hidden) s += 'H:true;';
  return s + ';';
}

function icsDate(v, allDay) {
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) throw new Error('Enter a valid date and time.');
  if (allDay) return `${m[1]}${m[2]}${m[3]}`;
  return `${m[1]}${m[2]}${m[3]}T${m[4] || '00'}${m[5] || '00'}00`;
}

export function icsText(f, now = new Date()) {
  const allDay = !!f.allDay;
  const start = icsDate(f.start, allDay);
  let end;
  if (allDay) {
    const d = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8)));
    const e = f.end ? icsDate(f.end, true) : null;
    if (e && e > start) end = e;
    else { d.setUTCDate(d.getUTCDate() + 1); end = d.toISOString().slice(0, 10).replace(/-/g, ''); }
  } else {
    end = f.end ? icsDate(f.end, false) : start;
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QR Studio//EN', 'BEGIN:VEVENT',
    `UID:${stamp}-${Math.abs(hash(f.title + start))}@qr-studio`, `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
    allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
    `SUMMARY:${vEsc(f.title)}`];
  if (f.location) lines.push(`LOCATION:${vEsc(f.location)}`);
  if (f.description) lines.push(`DESCRIPTION:${vEsc(f.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return h; }

export function socialUrl(f) {
  const p = SOCIALS[f.platform] || SOCIALS.custom;
  let h = String(f.handle || '').trim();
  if (!h) throw new Error('Enter a username or link.');
  if (/^https?:\/\//i.test(h)) return safeUrl(h);
  h = h.replace(/^@/, '');
  if (f.platform === 'custom') return safeUrl(h);
  if (!/^[\w.\-+]+$/.test(h)) throw new Error('Usernames can only contain letters, numbers, dots, dashes and underscores.');
  return p.url(h);
}

function ethWei(amount) {
  const m = String(amount).trim().match(/^(\d+)(?:\.(\d{1,18}))?$/);
  if (!m) throw new Error('Enter a valid amount.');
  return (BigInt(m[1]) * 10n ** 18n + BigInt((m[2] || '').padEnd(18, '0'))).toString();
}

export function paymentUrl(f) {
  if (f.kind === 'crypto') {
    const c = CRYPTOS[f.coin] || CRYPTOS.bitcoin;
    const addr = String(f.address || '').trim();
    if (!/^[A-Za-z0-9:]{20,100}$/.test(addr)) throw new Error('Enter a valid wallet address.');
    const params = {};
    if (f.amount) {
      if (!/^\d+(\.\d+)?$/.test(String(f.amount).trim())) throw new Error('Enter a valid amount.');
      params[c.param] = c.param === 'value' ? ethWei(f.amount) : String(f.amount).trim();
    }
    const q = qs(params);
    return `${c.scheme}:${addr}${q ? '?' + q : ''}`;
  }
  if (f.kind === 'link') return safeUrl(f.url);
  const h = String(f.handle || '').trim().replace(/^@/, '');
  if (!/^[\w.\-]+$/.test(h)) throw new Error('Enter a valid PayPal.Me username.');
  let u = `https://paypal.me/${h}`;
  if (f.amount) {
    if (!/^\d+(\.\d{1,2})?$/.test(String(f.amount).trim())) throw new Error('Enter a valid amount.');
    u += `/${String(f.amount).trim()}${/^[A-Za-z]{3}$/.test(f.currency || '') ? String(f.currency).toUpperCase() : ''}`;
  }
  return u;
}

export function telUri(n) {
  const v = String(n || '').replace(/[^\d+*#]/g, '');
  if (v.replace(/\D/g, '').length < 3) throw new Error('Enter a valid phone number.');
  return v;
}

export function mailtoUrl(f) {
  const q = qs({ subject: f.subject, body: f.body });
  return `mailto:${f.to}${q ? '?' + q : ''}`;
}

export function geoParts(f) {
  const lat = Number(f.lat), lng = Number(f.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be between -90 and 90.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('Longitude must be between -180 and 180.');
  return { lat, lng };
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
export const isEmail = s => EMAIL_RE.test(String(s || '').trim());

function cleanLinks(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).map(l => ({ label: String(l?.label ?? '').trim().slice(0, 80), url: String(l?.url ?? '').trim().slice(0, 1000) }))
    .filter(l => l.label || l.url).map(l => {
      if (!l.label) throw new Error('Every link needs a label.');
      return { label: l.label, url: safeUrl(l.url, { schemes: ['http', 'https', 'mailto', 'tel'] }) };
    });
}

/** Validate + sanitise a type's fields. Returns the cleaned object or throws Error(message). */
export function cleanFields(type, input) {
  const t = TYPES[type];
  if (!t) throw new Error('Unknown content type.');
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const f of t.fields) {
    if (f.showIf && !visible(f, out)) continue;
    let v = src[f.key];
    if (f.kind === 'checkbox') { out[f.key] = !!v; continue; }
    if (f.kind === 'links') { out[f.key] = cleanLinks(v); continue; }
    if (v == null || v === '') v = f.default ?? '';
    if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`${f.label} is not valid.`);
    v = String(v);
    if (f.kind !== 'textarea') v = v.replace(/[\r\n]+/g, ' ');
    if (f.kind !== 'image') v = v.trim();
    const max = f.kind === 'image' ? 400000 : (f.max || 500);
    if (v.length > max) throw new Error(`${f.label} is too long.`);
    if (f.required && !v) throw new Error(`${f.label} is required.`);
    if (v) {
      if (f.kind === 'url') v = safeUrl(v);
      else if (f.kind === 'email' && !isEmail(v)) throw new Error('Enter a valid email address.');
      else if (f.kind === 'tel') telUri(v);
      else if (f.kind === 'select' && !f.options.some(o => o.value === v)) throw new Error(`${f.label} is not valid.`);
      else if (f.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${f.label} must be a color like #2563eb.`);
      else if (f.kind === 'image' && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error('Images must be PNG, JPEG, WebP or GIF.');
      else if (f.kind === 'datetime') icsDate(v, false);
    }
    out[f.key] = v;
  }
  const msg = t.check?.(out);
  if (msg) throw new Error(msg);
  if (type === 'geo') geoParts(out);
  if (type === 'payment') paymentUrl(out);
  if (type === 'social') socialUrl(out);
  if (type === 'event') icsText(out);
  return out;
}

function visible(field, values) {
  return Object.entries(field.showIf).every(([k, want]) => {
    return Array.isArray(want) ? want.includes(values[k]) : values[k] === want;
  });
}
export { visible as fieldVisible };

/** The text a *static* QR code carries for this content. */
export function staticPayload(type, f) {
  switch (type) {
    case 'url': return safeUrl(f.url);
    case 'text': return String(f.text);
    case 'email': return mailtoUrl(f);
    case 'phone': return `tel:${telUri(f.number)}`;
    case 'sms': return `SMSTO:${telUri(f.number)}:${f.message || ''}`;
    case 'vcard': return vcardText(f);
    case 'wifi': return wifiText(f);
    case 'geo': { const g = geoParts(f); return `geo:${g.lat},${g.lng}`; }
    case 'event': return icsText(f);
    case 'app': return safeUrl(f.fallback || f.ios || f.android);
    case 'social': return socialUrl(f);
    case 'payment': return paymentUrl(f);
    default: throw new Error('This content type needs a dynamic code.');
  }
}

export const shortUrl = (origin, slug) => `${origin.replace(/\/$/, '')}/${slug}`;
