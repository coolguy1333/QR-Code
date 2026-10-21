// Turns text into a boolean module grid using the qrcode-generator engine.
// The engine is injected so the same code runs in browser and Node.

export function makeMatrix(qrcode, text, ecc = 'M') {
  qrcode.stringToBytes = (s) => Array.from(new TextEncoder().encode(s));
  const qr = qrcode(0, ecc);
  qr.addData(String(text), 'Byte');
  try {
    qr.make();
  } catch {
    throw new Error('Too much data for a QR code. Shorten the content or lower error correction.');
  }
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}
