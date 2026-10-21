// QR styling + vector output (SVG / PDF / EPS). No DOM, no dependencies:
// runs unchanged in the browser and in Node.

export const SHAPES = {
  dots: [['square', 'Square'], ['rounded', 'Rounded'], ['dots', 'Dots'], ['tiles', 'Tiles'], ['classy', 'Classy'], ['classy-rounded', 'Classy round'], ['diamond', 'Diamond'], ['bars-v', 'Bars (vertical)'], ['bars-h', 'Bars (horizontal)']],
  eyeOuter: [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle'], ['leaf', 'Leaf'], ['chamfer', 'Octagon']],
  eyeInner: [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle'], ['diamond', 'Diamond'], ['leaf', 'Leaf']],
  frame: [['none', 'None'], ['box-bottom', 'Box · text below'], ['box-top', 'Box · text above'], ['pill-bottom', 'Pill below'], ['bubble-bottom', 'Bubble below'], ['bubble-top', 'Bubble above']],
};

export const DEFAULT_STYLE = {
  ecc: 'M',
  margin: 4,
  dots: 'square',
  fg: { type: 'solid', c1: '#000000', c2: '#2563eb', angle: 45 },
  bg: { type: 'solid', c1: '#ffffff', c2: '#dbeafe', angle: 45 },
  eyeOuter: 'square',
  eyeInner: 'square',
  eyeOuterColor: '',
  eyeInnerColor: '',
  logo: null,
  frame: { type: 'none', text: 'SCAN ME', color: '#000000', textColor: '#ffffff' },
};

const HEX = /^#[0-9a-f]{6}$/i;
const pick = (v, list, d) => (list.some(([k]) => k === v) ? v : d);
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const color = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);

function paint(p, d, allowTransparent) {
  p = p && typeof p === 'object' ? p : {};
  const types = allowTransparent ? ['solid', 'linear', 'radial', 'transparent'] : ['solid', 'linear', 'radial'];
  return {
    type: types.includes(p.type) ? p.type : d.type,
    c1: color(p.c1, d.c1), c2: color(p.c2, d.c2),
    angle: clamp(p.angle, 0, 360, d.angle),
  };
}

/** Defensive normalisation: used on both client and server. */
export function normalizeStyle(s) {
  s = s && typeof s === 'object' ? s : {};
  const D = DEFAULT_STYLE;
  let logo = null;
  if (s.logo && typeof s.logo.src === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s.logo.src) && s.logo.src.length <= 400000) {
    logo = {
      src: s.logo.src,
      size: clamp(s.logo.size, 5, 30, 20),
      margin: clamp(s.logo.margin, 0, 4, 1),
      shape: s.logo.shape === 'circle' ? 'circle' : 'square',
      hideDots: s.logo.hideDots !== false,
      bg: color(s.logo.bg, '#ffffff'),
    };
  }
  const fr = s.frame && typeof s.frame === 'object' ? s.frame : {};
  return {
    ecc: ['L', 'M', 'Q', 'H'].includes(s.ecc) ? s.ecc : D.ecc,
    margin: Math.round(clamp(s.margin, 0, 20, D.margin)),
    dots: pick(s.dots, SHAPES.dots, D.dots),
    fg: paint(s.fg, D.fg, false),
    bg: paint(s.bg, D.bg, true),
    eyeOuter: pick(s.eyeOuter, SHAPES.eyeOuter, D.eyeOuter),
    eyeInner: pick(s.eyeInner, SHAPES.eyeInner, D.eyeInner),
    eyeOuterColor: s.eyeOuterColor ? color(s.eyeOuterColor, '') : '',
    eyeInnerColor: s.eyeInnerColor ? color(s.eyeInnerColor, '') : '',
    logo,
    frame: {
      type: pick(fr.type, SHAPES.frame, 'none'),
      text: String(fr.text ?? D.frame.text).replace(/[\u0000-\u001f]/g, ' ').slice(0, 30),
      color: color(fr.color, D.frame.color),
      textColor: color(fr.textColor, D.frame.textColor),
    },
  };
}

// ---------- colour helpers ----------
export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = c => '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); };
export function luminance(h) {
  const [r, g, b] = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Paint = {type, c1, c2, angle, box:{x,y,w,h}} */
function gradGeom(p) {
  const { x, y, w, h } = p.box;
  const cx = x + w / 2, cy = y + h / 2;
  const th = (p.angle * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
  const L = (Math.abs(w * co) + Math.abs(h * si)) / 2 || 1;
  return { cx, cy, co, si, L, R: Math.hypot(w, h) / 2 || 1 };
}
export function paintColorAt(p, x, y) {
  if (p.type === 'solid') return p.c1;
  const g = gradGeom(p);
  let t;
  if (p.type === 'linear') t = ((x - g.cx) * g.co + (y - g.cy) * g.si) / (2 * g.L) + 0.5;
  else t = Math.hypot(x - g.cx, y - g.cy) / g.R;
  return mix(p.c1, p.c2, Math.min(1, Math.max(0, t)));
}

// ---------- geometry ----------
const K = 0.5522847498;
const f = n => { const r = Math.round(n * 1000) / 1000; return String(r === 0 ? 0 : r); };

// An outline = {pts:[x,y] start, segs:[['L',x,y]|['C',x1,y1,x2,y2,x,y]]}, drawn clockwise (y down).
function outline(x, y, w, h, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  const segs = [];
  const corner = (rad, cx1, cy1, cx2, cy2, ex, ey) => { if (rad > 0) segs.push(['C', cx1, cy1, cx2, cy2, ex, ey]); };
  segs.push(['L', x + w - tr, y]);
  corner(tr, x + w - tr + tr * K, y, x + w, y + tr - tr * K, x + w, y + tr);
  segs.push(['L', x + w, y + h - br]);
  corner(br, x + w, y + h - br + br * K, x + w - br + br * K, y + h, x + w - br, y + h);
  segs.push(['L', x + bl, y + h]);
  corner(bl, x + bl - bl * K, y + h, x, y + h - bl + bl * K, x, y + h - bl);
  segs.push(['L', x, y + tl]);
  corner(tl, x, y + tl - tl * K, x + tl - tl * K, y, x + tl, y);
  return { start: [x + tl, y], segs };
}
function polygon(points) {
  return { start: points[0], segs: points.slice(1).concat([points[0]]).map(p => ['L', p[0], p[1]]) };
}
function reverse(o) {
  const pts = [o.start, ...o.segs.map(s => [s[s.length - 2], s[s.length - 1]])];
  const segs = [];
  for (let i = o.segs.length - 1; i >= 0; i--) {
    const s = o.segs[i], to = pts[i];
    segs.push(s[0] === 'C' ? ['C', s[3], s[4], s[1], s[2], to[0], to[1]] : ['L', to[0], to[1]]);
  }
  return { start: pts[pts.length - 1], segs };
}
const toD = o => `M${f(o.start[0])} ${f(o.start[1])}` + o.segs.map(s => s[0] + s.slice(1).map(f).join(' ')).join('') + 'Z';
const rect = (x, y, w, h, r = 0) => outline(x, y, w, h, r);

function modulePath(shape, x, y, nb) {
  const ex = nb.r ? 0.02 : 0, ey = nb.b ? 0.02 : 0;
  switch (shape) {
    case 'rounded': {
      const r = 0.5;
      return rect(x, y, 1 + ex, 1 + ey, [!nb.t && !nb.l ? r : 0, !nb.t && !nb.r ? r : 0, !nb.b && !nb.r ? r : 0, !nb.b && !nb.l ? r : 0]);
    }
    case 'dots': return rect(x + 0.03, y + 0.03, 0.94, 0.94, 0.47);
    case 'tiles': return rect(x + 0.07, y + 0.07, 0.86, 0.86, 0.14);
    case 'classy': return rect(x, y, 1.02, 1.02, [0.4, 0, 0.4, 0]);
    case 'classy-rounded': return rect(x, y, 1.02, 1.02, [0.45, 0.1, 0.45, 0.1]);
    case 'diamond': return polygon([[x + 0.5, y - 0.2], [x + 1.2, y + 0.5], [x + 0.5, y + 1.2], [x - 0.2, y + 0.5]]);
    case 'bars-v': { const t = nb.t ? 0 : 0.38, b = nb.b ? 0 : 0.38; return rect(x + 0.12, y - (nb.t ? 0.01 : 0), 0.76, 1 + (nb.b ? 0.02 : 0), [t, t, b, b]); }
    case 'bars-h': { const l = nb.l ? 0 : 0.38, r = nb.r ? 0 : 0.38; return rect(x - (nb.l ? 0.01 : 0), y + 0.12, 1 + (nb.r ? 0.02 : 0), 0.76, [l, r, r, l]); }
    default: return rect(x, y, 1 + ex, 1 + ey, 0);
  }
}

function eyeOuterParts(shape, x, y) {
  const ring = (o, i) => [o, reverse(i)];
  switch (shape) {
    case 'rounded': return ring(rect(x, y, 7, 7, 2), rect(x + 1, y + 1, 5, 5, 1));
    case 'circle': return ring(rect(x, y, 7, 7, 3.5), rect(x + 1, y + 1, 5, 5, 2.5));
    case 'leaf': return ring(rect(x, y, 7, 7, [3.2, 0, 3.2, 0]), rect(x + 1, y + 1, 5, 5, [2.2, 0, 2.2, 0]));
    case 'chamfer': {
      const oct = (px, py, s, c) => polygon([[px + c, py], [px + s - c, py], [px + s, py + c], [px + s, py + s - c], [px + s - c, py + s], [px + c, py + s], [px, py + s - c], [px, py + c]]);
      return ring(oct(x, y, 7, 1.6), oct(x + 1, y + 1, 5, 0.9));
    }
    default: return ring(rect(x, y, 7, 7, 0), rect(x + 1, y + 1, 5, 5, 0));
  }
}
function eyeInnerPart(shape, x, y) {
  switch (shape) {
    case 'rounded': return rect(x, y, 3, 3, 0.9);
    case 'circle': return rect(x, y, 3, 3, 1.5);
    case 'diamond': return polygon([[x + 1.5, y - 0.35], [x + 3.35, y + 1.5], [x + 1.5, y + 3.35], [x - 0.35, y + 1.5]]);
    case 'leaf': return rect(x, y, 3, 3, [1.4, 0, 1.4, 0]);
    default: return rect(x, y, 3, 3, 0);
  }
}

// Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126, used to size frame text.
const HB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
export const textWidth = (s) => [...s].reduce((a, ch) => { const c = ch.codePointAt(0); return a + (c >= 32 && c <= 126 ? HB[c - 32] : 600); }, 0) / 1000;

// ---------- scene ----------
/**
 * @param {boolean[][]} matrix  dark-module grid
 * @param {object} style        normalised style
 * @returns scene {w,h,items:[...]} in module units
 */
export function buildScene(matrix, style) {
  const st = normalizeStyle(style);
  const n = matrix.length, m = st.margin, q = n + 2 * m;
  const fr = st.frame;
  const text = fr.text.trim();
  const items = [];

  // ----- frame layout: where the QR box sits, overall size
  let W = q, H = q, qx = 0, qy = 0;
  let frameKind = fr.type === 'none' || !text ? 'none' : fr.type;
  const pad = 1.5, bw = 1.2, labelH = 8;
  if (frameKind === 'box-bottom') { W = q + 2 * pad; H = pad + q + pad + labelH; qx = pad; qy = pad; }
  else if (frameKind === 'box-top') { W = q + 2 * pad; H = labelH + pad + q + pad; qx = pad; qy = labelH + pad; }
  else if (frameKind === 'pill-bottom') { H = q + 1.5 + 7; }
  else if (frameKind === 'bubble-bottom') { H = q + 1.2 + 1.8 + 7.5; }
  else if (frameKind === 'bubble-top') { H = q + 1.2 + 1.8 + 7.5; qy = 1.2 + 1.8 + 7.5; }
  const qrBox = { x: qx + m, y: qy + m, w: n, h: n };

  const fgPaint = { ...st.fg, box: qrBox };
  const eyeOuterPaint = st.eyeOuterColor ? { type: 'solid', c1: st.eyeOuterColor } : fgPaint;
  const eyeInnerPaint = st.eyeInnerColor ? { type: 'solid', c1: st.eyeInnerColor } : (st.eyeOuterColor ? { type: 'solid', c1: st.eyeOuterColor } : fgPaint);

  const bgBox = { x: 0, y: 0, w: W, h: H };
  const bgPaint = st.bg.type === 'transparent' ? null : { ...st.bg, box: bgBox };
  const boxFrame = frameKind === 'box-bottom' || frameKind === 'box-top';
  const r0 = 2.5;

  // ----- background + frame body
  const label = (cx, cy, availW, size) => {
    const base = Math.min(size, availW / Math.max(textWidth(text), 0.1));
    items.push({ t: 'text', x: cx, y: cy + base * 0.36, size: base, text, fill: { type: 'solid', c1: fr.textColor } });
  };
  if (boxFrame) {
    const top = frameKind === 'box-top';
    const cardY = top ? labelH : bw, cardH = H - labelH - bw;
    const cardR = top ? [0, 0, r0 - bw, r0 - bw] : [r0 - bw, r0 - bw, 0, 0];
    const card = rect(bw, cardY, W - 2 * bw, cardH, cardR);
    if (bgPaint) items.push({ t: 'path', d: toD(card), fill: { ...st.bg, box: { x: bw, y: cardY, w: W - 2 * bw, h: cardH } } });
    items.push({ t: 'path', d: toD(rect(0, 0, W, H, r0)) + toD(reverse(card)), fill: { type: 'solid', c1: fr.color } });
    label(W / 2, top ? labelH / 2 : H - labelH / 2, W - 4, 3.6);
  } else if (bgPaint) {
    items.push({ t: 'path', d: toD(rect(0, 0, W, H, 0)), fill: bgPaint });
  }
  if (frameKind === 'pill-bottom' || frameKind === 'bubble-bottom' || frameKind === 'bubble-top') {
    const bubble = frameKind !== 'pill-bottom';
    const ph = bubble ? 7.5 : 7;
    const pw = Math.min(q, Math.max(q * 0.62, textWidth(text) * 3.4 + 7));
    const px = (W - pw) / 2;
    const py = frameKind === 'bubble-top' ? 1.2 : q + (bubble ? 1.2 + 1.8 : 1.5);
    let d = toD(rect(px, py, pw, ph, bubble ? 2 : ph / 2));
    if (bubble) {
      const cx = W / 2;
      d += frameKind === 'bubble-top'
        ? toD(polygon([[cx - 1.6, py + ph - 0.1], [cx + 1.6, py + ph - 0.1], [cx, py + ph + 1.8]]))
        : toD(polygon([[cx - 1.6, py + 0.1], [cx, py - 1.8], [cx + 1.6, py + 0.1]]));
    }
    items.push({ t: 'path', d, fill: { type: 'solid', c1: fr.color } });
    label(W / 2, py + ph / 2, pw - 4, 3.6);
  }

  // ----- dark modules
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && matrix[r][c];
  const inEye = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const lg = st.logo;
  let hidden = () => false;
  if (lg && lg.hideDots) {
    const half = (n * lg.size / 100) / 2 + lg.margin, mid = n / 2;
    hidden = lg.shape === 'circle'
      ? (r, c) => Math.hypot(c + 0.5 - mid, r + 0.5 - mid) < half + 0.4
      : (r, c) => Math.abs(c + 0.5 - mid) < half + 0.5 && Math.abs(r + 0.5 - mid) < half + 0.5;
  }
  const parts = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!matrix[r][c] || inEye(r, c) || hidden(r, c)) continue;
    const nb = { t: dark(r - 1, c), b: dark(r + 1, c), l: dark(r, c - 1), r: dark(r, c + 1) };
    parts.push({ d: toD(modulePath(st.dots, qrBox.x + c, qrBox.y + r, nb)), cx: qrBox.x + c + 0.5, cy: qrBox.y + r + 0.5 });
  }
  if (parts.length) items.push({ t: 'path', d: parts.map(p => p.d).join(''), parts, fill: fgPaint });

  // ----- finder patterns ("eyes")
  const eyes = [[0, 0], [0, n - 7], [n - 7, 0]].map(([r, c]) => [qrBox.x + c, qrBox.y + r]);
  const outerParts = eyes.map(([x, y]) => ({ d: eyeOuterParts(st.eyeOuter, x, y).map(toD).join(''), cx: x + 3.5, cy: y + 3.5 }));
  const innerParts = eyes.map(([x, y]) => ({ d: toD(eyeInnerPart(st.eyeInner, x + 2, y + 2)), cx: x + 3.5, cy: y + 3.5 }));
  items.push({ t: 'path', d: outerParts.map(p => p.d).join(''), parts: outerParts, fill: eyeOuterPaint });
  items.push({ t: 'path', d: innerParts.map(p => p.d).join(''), parts: innerParts, fill: eyeInnerPaint });

  // ----- logo
  if (lg) {
    const L = n * lg.size / 100, cx = qrBox.x + n / 2, cy = qrBox.y + n / 2;
    const pad2 = lg.hideDots ? Math.min(lg.margin, 1) * 0.6 : 0;
    if (lg.hideDots) {
      const s = L + pad2 * 2;
      const o = lg.shape === 'circle' ? rect(cx - s / 2, cy - s / 2, s, s, s / 2) : rect(cx - s / 2, cy - s / 2, s, s, s * 0.12);
      items.push({ t: 'path', d: toD(o), fill: { type: 'solid', c1: lg.bg } });
    }
    items.push({ t: 'image', x: cx - L / 2, y: cy - L / 2, w: L, h: L, src: lg.src, round: lg.shape === 'circle', bg: lg.bg });
  }

  return { w: W, h: H, n, margin: m, qrBox, items, style: st, transparent: !bgPaint };
}

// ---------- SVG ----------
export const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

export function sceneToSVG(scene, { px = 512, title = 'QR code' } = {}) {
  const defs = [];
  let gid = 0;
  const fillRef = p => {
    if (p.type === 'solid') return p.c1;
    const id = 'g' + gid++;
    const g = gradGeom(p);
    if (p.type === 'linear') {
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.cx - g.co * g.L)}" y1="${f(g.cy - g.si * g.L)}" x2="${f(g.cx + g.co * g.L)}" y2="${f(g.cy + g.si * g.L)}"><stop offset="0" stop-color="${p.c1}"/><stop offset="1" stop-color="${p.c2}"/></linearGradient>`);
    } else {
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(g.cx)}" cy="${f(g.cy)}" r="${f(g.R)}"><stop offset="0" stop-color="${p.c1}"/><stop offset="1" stop-color="${p.c2}"/></radialGradient>`);
    }
    return `url(#${id})`;
  };
  const body = scene.items.map((it, i) => {
    if (it.t === 'path') return `<path d="${it.d}" fill="${fillRef(it.fill)}"/>`;
    if (it.t === 'text') return `<text x="${f(it.x)}" y="${f(it.y)}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${f(it.size)}" text-anchor="middle" fill="${it.fill.c1}">${xmlEsc(it.text)}</text>`;
    if (it.t === 'image') {
      const clip = it.round ? ` clip-path="url(#c${i})"` : '';
      if (it.round) defs.push(`<clipPath id="c${i}"><circle cx="${f(it.x + it.w / 2)}" cy="${f(it.y + it.h / 2)}" r="${f(it.w / 2)}"/></clipPath>`);
      return `<image x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" href="${it.src}" preserveAspectRatio="xMidYMid meet"${clip}/>`;
    }
    return '';
  }).join('');
  const h = (px * scene.h) / scene.w;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(scene.w)} ${f(scene.h)}" width="${f(px)}" height="${f(h)}" role="img" aria-label="${xmlEsc(title)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`;
}

// ---------- path parsing for PDF/EPS ----------
function* pathOps(d) {
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    yield [m[1], nums];
  }
}

function* flatItems(scene) {
  for (const it of scene.items) {
    if (it.t === 'path' && it.parts && it.fill.type !== 'solid') {
      for (const p of it.parts) yield { t: 'path', d: p.d, color: paintColorAt(it.fill, p.cx, p.cy) };
    } else if (it.t === 'path') {
      yield { t: 'path', d: it.d, color: it.fill.c1 ?? '#000000' };
    } else yield it;
  }
}

const pdfNum = n => { const r = Math.round(n * 1000) / 1000; return String(r === 0 ? 0 : r); };
const rgb01 = hex => hexToRgb(hex).map(v => pdfNum(v / 255)).join(' ');
const latin1 = s => String(s).replace(/[^\x20-\x7e]/g, c => (c.charCodeAt(0) >= 160 && c.charCodeAt(0) <= 255 ? c : '?'));
const toHex = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0'); return s; };

/** Flatten RGBA over `bg`, returning RGB bytes. */
function rgbOver(px, bg) {
  const [br, bgc, bb] = hexToRgb(bg);
  const out = new Uint8Array((px.rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < px.rgba.length; i += 4, j += 3) {
    const a = px.rgba[i + 3] / 255;
    out[j] = px.rgba[i] * a + br * (1 - a);
    out[j + 1] = px.rgba[i + 1] * a + bgc * (1 - a);
    out[j + 2] = px.rgba[i + 2] * a + bb * (1 - a);
  }
  return out;
}

/**
 * Vector PDF. `sizeMm` is the printed width of the whole artwork.
 * `logoPixels` = {w,h,rgba:Uint8Array} when the scene has a logo.
 */
export function sceneToPDF(scene, { sizeMm = 50, logoPixels = null } = {}) {
  const pw = (sizeMm * 72) / 25.4, ph = (pw * scene.h) / scene.w, s = pw / scene.w;
  let c = `${pdfNum(s)} 0 0 ${pdfNum(-s)} 0 ${pdfNum(ph)} cm\n`;
  let image = null;
  for (const it of flatItems(scene)) {
    if (it.t === 'path') {
      c += `${rgb01(it.color)} rg\n`;
      for (const [op, a] of pathOps(it.d)) {
        if (op === 'M') c += `${a.map(pdfNum).join(' ')} m\n`;
        else if (op === 'L') c += `${a.map(pdfNum).join(' ')} l\n`;
        else if (op === 'C') c += `${a.map(pdfNum).join(' ')} c\n`;
        else c += 'h\n';
      }
      c += 'f\n';
    } else if (it.t === 'text') {
      const t = latin1(it.text).replace(/[\\()]/g, '\\$&');
      const wUnits = textWidth(latin1(it.text)) * it.size;
      c += `${rgb01(it.fill.c1)} rg\nBT /F1 ${pdfNum(it.size)} Tf 1 0 0 -1 ${pdfNum(it.x - wUnits / 2)} ${pdfNum(it.y)} Tm (${t}) Tj ET\n`;
    } else if (it.t === 'image' && logoPixels) {
      image = { ...logoPixels, rgb: rgbOver(logoPixels, it.bg) };
      c += `q ${pdfNum(it.w)} 0 0 ${pdfNum(-it.h)} ${pdfNum(it.x)} ${pdfNum(it.y + it.h)} cm /Im1 Do Q\n`;
    }
  }
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNum(pw)} ${pdfNum(ph)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >>${image ? ' /XObject << /Im1 6 0 R >>' : ''} >> >>`);
  objs.push(`<< /Length ${c.length} >>\nstream\n${c}endstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  if (image) {
    const hex = toHex(image.rgb) + '>';
    objs.push(`<< /Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${hex.length} >>\nstream\n${hex}\nendstream`);
  }
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (QR code) /Producer (QR Studio) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** Vector EPS (Level 2). */
export function sceneToEPS(scene, { sizeMm = 50, logoPixels = null } = {}) {
  const pw = (sizeMm * 72) / 25.4, ph = (pw * scene.h) / scene.w, s = pw / scene.w;
  let o = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(pw)} ${Math.ceil(ph)}\n%%HiResBoundingBox: 0 0 ${pdfNum(pw)} ${pdfNum(ph)}\n%%Title: QR code\n%%Creator: QR Studio\n%%LanguageLevel: 2\n%%EndComments\ngsave\n`;
  o += `0 ${pdfNum(ph)} translate ${pdfNum(s)} ${pdfNum(-s)} scale\n/Helvetica-Bold findfont 1 scalefont setfont\n`;
  for (const it of flatItems(scene)) {
    if (it.t === 'path') {
      o += `${rgb01(it.color)} setrgbcolor newpath\n`;
      for (const [op, a] of pathOps(it.d)) {
        if (op === 'M') o += `${a.map(pdfNum).join(' ')} moveto\n`;
        else if (op === 'L') o += `${a.map(pdfNum).join(' ')} lineto\n`;
        else if (op === 'C') o += `${a.map(pdfNum).join(' ')} curveto\n`;
        else o += 'closepath\n';
      }
      o += 'fill\n';
    } else if (it.t === 'text') {
      const t = latin1(it.text).replace(/[\\()]/g, '\\$&');
      const wUnits = textWidth(latin1(it.text)) * it.size;
      o += `${rgb01(it.fill.c1)} setrgbcolor gsave ${pdfNum(it.x - wUnits / 2)} ${pdfNum(it.y)} translate ${pdfNum(it.size)} ${pdfNum(-it.size)} scale 0 0 moveto (${t}) show grestore\n`;
    } else if (it.t === 'image' && logoPixels) {
      const rgb = rgbOver(logoPixels, it.bg);
      o += `gsave ${pdfNum(it.x)} ${pdfNum(it.y + it.h)} translate ${pdfNum(it.w)} ${pdfNum(-it.h)} scale\n/pix ${logoPixels.w * 3} string def\n${logoPixels.w} ${logoPixels.h} 8 [${logoPixels.w} 0 0 -${logoPixels.h} 0 ${logoPixels.h}]\n{currentfile pix readhexstring pop} false 3 colorimage\n${toHex(rgb).replace(/(.{96})/g, '$1\n')}\ngrestore\n`;
    }
  }
  return o + 'grestore\nshowpage\n%%EOF\n';
}

// ---------- scan-readiness advice ----------
export function scanAdvice(style, n = 25) {
  const st = normalizeStyle(style);
  const out = [];
  const bgc = st.bg.type === 'transparent' ? '#ffffff' : st.bg.c1;
  const lowest = Math.min(contrast(st.fg.c1, bgc), st.fg.type === 'solid' ? 99 : contrast(st.fg.c2, st.bg.type === 'transparent' ? '#ffffff' : (st.bg.type === 'solid' ? st.bg.c1 : st.bg.c2)));
  if (lowest < 3) out.push({ level: 'bad', text: 'Contrast between the code and its background is too low — scanners may fail. Use a darker foreground or lighter background.' });
  else if (lowest < 4.5) out.push({ level: 'warn', text: 'Contrast is a little low. Test with a few phones before printing.' });
  const fgLum = luminance(st.fg.c1), bgLum = luminance(bgc);
  if (fgLum > bgLum + 0.05) out.push({ level: 'warn', text: 'The code is lighter than its background (inverted). Many scanners cannot read inverted codes.' });
  if (st.margin < 2) out.push({ level: 'warn', text: 'The quiet zone is very small. Keep at least 2–4 modules of margin around the code.' });
  if (st.bg.type === 'transparent') out.push({ level: 'info', text: 'Transparent background: place the code on a plain, light surface.' });
  if (st.logo) {
    const cover = (st.logo.size / 100) ** 2;
    const cap = { L: 0.07, M: 0.15, Q: 0.25, H: 0.30 }[st.ecc];
    if (st.logo.hideDots && cover * 1.5 > cap) out.push({ level: 'warn', text: `Your logo hides a lot of the code. Raise error correction to ${st.ecc === 'Q' ? 'H' : 'Q or H'} or shrink the logo.` });
  }
  if (n > 57) out.push({ level: 'info', text: 'This code is dense. Print it larger, or use a shorter link (a dynamic code keeps the code simple).' });
  return out;
}

// ---------- tiny previews for the shape pickers ----------
export function shapePreviewSVG(kind, shape) {
  let vb, d = '';
  if (kind === 'dots') {
    vb = '-0.4 -0.4 5.2 5.2';
    const m = ['11011', '11101', '01111', '10110', '11011'];
    const on = (r, c) => m[r]?.[c] === '1';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (on(r, c)) d += toD(modulePath(shape, c, r, { t: on(r - 1, c), b: on(r + 1, c), l: on(r, c - 1), r: on(r, c + 1) }));
    }
  } else {
    vb = '-0.5 -0.5 8 8';
    d = kind === 'eyeOuter'
      ? eyeOuterParts(shape, 0, 0).map(toD).join('') + toD(eyeInnerPart('square', 2, 2))
      : eyeOuterParts('square', 0, 0).map(toD).join('') + toD(eyeInnerPart(shape, 2, 2));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
}
