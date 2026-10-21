// Server-side QR rendering: SVG (pure), PDF/EPS (pure), PNG/JPG (resvg, optional).
import qrcode from 'qrcode-generator';
import { makeMatrix } from '../public/js/qr-matrix.js';
import { buildScene, sceneToSVG, sceneToPDF, sceneToEPS, normalizeStyle } from '../public/js/qr-render.js';

let resvgMod = null;
let jpegMod = null;
try { resvgMod = await import('@resvg/resvg-js'); } catch { /* optional */ }
try { jpegMod = (await import('jpeg-js')).default; } catch { /* optional */ }

export const rasterAvailable = () => !!resvgMod;

const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
];
import { existsSync } from 'node:fs';
const fontFiles = FONT_CANDIDATES.filter(existsSync);

export function matrixFor(text, ecc) {
  return makeMatrix(qrcode, text, ecc);
}

export function sceneFor(text, style) {
  const st = normalizeStyle(style);
  return buildScene(matrixFor(text, st.ecc), st);
}

function resvgRender(svg, width) {
  const r = new resvgMod.Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, fontFiles, defaultFontFamily: 'DejaVu Sans' },
    background: undefined,
  });
  return r.render();
}

/** Decode a data: URL image into RGBA (for PDF/EPS logos). */
function logoPixels(scene) {
  const img = scene.items.find(i => i.t === 'image');
  if (!img || !resvgMod) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256"><image x="0" y="0" width="100" height="100" href="${img.src}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  try {
    const out = resvgRender(svg, 256);
    return { w: out.width, h: out.height, rgba: new Uint8Array(out.pixels) };
  } catch { return null; }
}

/**
 * @returns {{type:string, body:Buffer|string}}
 */
export function renderQR(text, style, { format = 'svg', size = 1024, sizeMm = 50 } = {}) {
  const scene = sceneFor(text, style);
  size = Math.min(4096, Math.max(64, Math.round(size)));
  if (format === 'svg') return { type: 'image/svg+xml; charset=utf-8', body: sceneToSVG(scene, { px: size }) };
  if (format === 'pdf') return { type: 'application/pdf', body: Buffer.from(sceneToPDF(scene, { sizeMm, logoPixels: logoPixels(scene) })) };
  if (format === 'eps') return { type: 'application/postscript', body: Buffer.from(sceneToEPS(scene, { sizeMm, logoPixels: logoPixels(scene) }), 'latin1') };
  if (!resvgMod) {
    const e = new Error('PNG/JPG rendering is not available on this server. Use svg, pdf or eps.');
    e.status = 501;
    throw e;
  }
  const svg = sceneToSVG(scene, { px: size });
  const out = resvgRender(svg, size);
  if (format === 'png') return { type: 'image/png', body: out.asPng() };
  if (format === 'jpg' || format === 'jpeg') {
    if (!jpegMod) { const e = new Error('JPG rendering is not available on this server.'); e.status = 501; throw e; }
    const px = out.pixels;
    const rgba = Buffer.alloc(px.length);
    for (let i = 0; i < px.length; i += 4) { // flatten transparency onto white
      const a = px[i + 3] / 255;
      rgba[i] = px[i] * a + 255 * (1 - a); rgba[i + 1] = px[i + 1] * a + 255 * (1 - a); rgba[i + 2] = px[i + 2] * a + 255 * (1 - a); rgba[i + 3] = 255;
    }
    return { type: 'image/jpeg', body: jpegMod.encode({ data: rgba, width: out.width, height: out.height }, 92).data };
  }
  const e = new Error('Unknown format. Use svg, png, jpg, pdf or eps.');
  e.status = 400;
  throw e;
}

export function rasterPixels(text, style, width = 600) {
  const scene = sceneFor(text, style);
  const out = resvgRender(sceneToSVG(scene, { px: width }), width);
  return { data: new Uint8ClampedArray(out.pixels), width: out.width, height: out.height };
}
