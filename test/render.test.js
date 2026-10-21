import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { renderQR, rasterPixels, rasterAvailable } from '../src/qr.js';
import { DEFAULT_STYLE } from '../public/js/qr-render.js';

const decode = (text, style, w = 700) => {
  const { data, width, height } = rasterPixels(text, style, w);
  // composite onto white, jsQR ignores alpha
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; for (let k = 0; k < 3; k++) data[i + k] = data[i + k] * a + 255 * (1 - a); data[i + 3] = 255; }
  return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data;
};
const mk = (o) => ({ ...structuredClone(DEFAULT_STYLE), ...o });

test('raster available', () => assert.ok(rasterAvailable()));

for (const dots of ['square', 'rounded', 'dots', 'tiles', 'classy', 'classy-rounded', 'diamond', 'bars-v', 'bars-h']) {
  test(`dots:${dots} decodes`, () => {
    const t = 'https://example.com/hello?x=1';
    assert.equal(decode(t, mk({ dots }), dots === 'diamond' ? 500 : 700), t);
  });
}
for (const eyeOuter of ['square', 'rounded', 'circle', 'leaf', 'chamfer']) for (const eyeInner of ['square', 'rounded', 'circle', 'diamond', 'leaf']) {
  test(`eyes ${eyeOuter}/${eyeInner} decode`, () => {
    const t = 'Eyes ' + eyeOuter + eyeInner;
    assert.equal(decode(t, mk({ eyeOuter, eyeInner })), t);
  });
}
test('gradients + colored eyes decode', () => {
  const t = 'https://example.com/gradient';
  const s = mk({ fg: { type: 'linear', c1: '#111827', c2: '#1d4ed8', angle: 30 }, bg: { type: 'radial', c1: '#ffffff', c2: '#e0f2fe' }, eyeOuterColor: '#7c2d12', eyeInnerColor: '#0f766e' });
  assert.equal(decode(t, s), t);
});
for (const type of ['box-bottom', 'box-top', 'pill-bottom', 'bubble-bottom', 'bubble-top']) {
  test(`frame ${type} decodes`, () => {
    const t = 'https://example.com/frame';
    assert.equal(decode(t, mk({ frame: { type, text: 'SCAN ME', color: '#111111', textColor: '#ffffff' } })), t);
  });
}
test('transparent bg decodes', () => {
  assert.equal(decode('transparent', mk({ bg: { type: 'transparent', c1: '#fff', c2: '#fff', angle: 0 } })), 'transparent');
});
test('logo with H ecc decodes', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
  const t = 'https://example.com/logo-test-with-a-longer-link';
  assert.equal(decode(t, mk({ ecc: 'H', logo: { src: png, size: 20, margin: 1, shape: 'circle', hideDots: true, bg: '#ffffff' } })), t);
});
test('utf-8 payload', () => assert.equal(decode('Zażółć gęślą 🎉', mk({})), 'Zażółć gęślą 🎉'));
test('pdf/eps/svg/png/jpg render', () => {
  for (const format of ['svg', 'pdf', 'eps', 'png', 'jpg']) {
    const r = renderQR('hello', mk({ frame: { type: 'box-bottom', text: 'Scan me (now)', color: '#000000', textColor: '#ffffff' } }), { format, size: 300 });
    assert.ok(r.body.length > 200, format);
  }
  const pdf = renderQR('hello', mk({}), { format: 'pdf' }).body.toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
});
