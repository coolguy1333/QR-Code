// Browser-side export: PNG/JPG (canvas), SVG/PDF/EPS (vector writers), ZIP, clipboard, scan test.
import { sceneToSVG, sceneToPDF, sceneToEPS } from './qr-render.js';

export const FORMATS = [['png', 'PNG'], ['svg', 'SVG'], ['jpg', 'JPG'], ['pdf', 'PDF'], ['eps', 'EPS']];
export const SIZE_PRESETS = [[512, 'Small · 512 px'], [1024, 'Medium · 1024 px'], [2048, 'Large · 2048 px (print)'], [4096, 'Poster · 4096 px']];

const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not draw the QR code.')); i.src = src; });

export async function sceneToCanvas(scene, px, { background = null } = {}) {
  const svg = sceneToSVG(scene, { px });
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const w = Math.round(px), h = Math.round((px * scene.h) / scene.w);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

const canvasBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Export failed.'))), type, q));

async function logoPixels(scene) {
  const it = scene.items.find(i => i.t === 'image');
  if (!it) return null;
  const img = await loadImage(it.src);
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const k = Math.min(S / img.width, S / img.height);
  ctx.drawImage(img, (S - img.width * k) / 2, (S - img.height * k) / 2, img.width * k, img.height * k);
  const d = ctx.getImageData(0, 0, S, S);
  return { w: S, h: S, rgba: d.data };
}

/** @returns {Promise<Blob>} */
export async function exportBlob(scene, format, { px = 1024, sizeMm = 50 } = {}) {
  px = Math.min(4096, Math.max(64, Math.round(px)));
  if (format === 'svg') return new Blob([sceneToSVG(scene, { px })], { type: 'image/svg+xml' });
  if (format === 'png') return canvasBlob(await sceneToCanvas(scene, px), 'image/png');
  if (format === 'jpg') return canvasBlob(await sceneToCanvas(scene, px, { background: '#ffffff' }), 'image/jpeg', 0.95);
  if (format === 'pdf') return new Blob([sceneToPDF(scene, { sizeMm, logoPixels: await logoPixels(scene) })], { type: 'application/pdf' });
  if (format === 'eps') return new Blob([sceneToEPS(scene, { sizeMm, logoPixels: await logoPixels(scene) })], { type: 'application/postscript' });
  throw new Error('Unknown format');
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const safeName = s => (String(s || 'qr-code').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'qr-code');

export async function copyPNG(scene, px = 1024) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Your browser cannot copy images. Download the file instead.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': sceneToCanvas(scene, px).then(c => canvasBlob(c, 'image/png')) })]);
}

// ---------- scan test / reader ----------
let jsqrPromise;
export function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  jsqrPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/static/vendor/jsQR.js';
    s.onload = () => res(window.jsQR);
    s.onerror = () => rej(new Error('Could not load the QR reader.'));
    document.head.append(s);
  });
  return jsqrPromise;
}

/** Decode a canvas/ImageData. Returns {text} or null. */
export async function decodeImageData(source) {
  const jsQR = await loadJsQR();
  const d = source instanceof ImageData ? source : source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, source.width, source.height);
  const r = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
  return r ? { text: r.data } : null;
}

export async function decodeWithDetector(bitmapSource) {
  if (!('BarcodeDetector' in window)) return undefined;
  try {
    const det = new window.BarcodeDetector({ formats: ['qr_code'] });
    const res = await det.detect(bitmapSource);
    return res[0] ? { text: res[0].rawValue } : null;
  } catch { return undefined; }
}

export async function scanTest(scene, expected) {
  const canvas = await sceneToCanvas(scene, 640, { background: scene.transparent ? '#ffffff' : null });
  let r = await decodeWithDetector(canvas);
  if (r === undefined) r = await decodeImageData(canvas);
  if (!r) return { ok: false, reason: 'unreadable' };
  return { ok: r.text === expected, text: r.text, reason: r.text === expected ? '' : 'mismatch' };
}

// ---------- ZIP (store only) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ---------- images ----------
/** Downscale an image file to a data URL (PNG keeps transparency). */
export async function fileToDataUrl(file, maxPx = 256) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, maxPx / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const keepAlpha = file.type !== 'image/jpeg';
    let out = c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
    if (out.length > 300000) out = c.toDataURL('image/jpeg', 0.8);
    if (out.length > 380000) throw new Error('That image is too detailed. Try a smaller one.');
    return out;
  } finally { URL.revokeObjectURL(url); }
}
