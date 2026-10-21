import qrcode from '/static/vendor/qrcode.mjs';
import { makeMatrix } from './qr-matrix.js';
import { buildScene, sceneToSVG, normalizeStyle } from './qr-render.js';

export function sceneFor(text, style) {
  const st = normalizeStyle(style);
  return buildScene(makeMatrix(qrcode, text, st.ecc), st);
}
export const svgFor = (text, style, px = 320) => sceneToSVG(sceneFor(text, style), { px });
