import { h, mount, copyText, toast } from '../ui.js';
import { decodeImageData, decodeWithDetector, loadJsQR } from '../export.js';

export default async function render(root) {
  let stream = null, raf = 0, running = false;
  const video = h('video', { class: 'scanner', playsinline: true, muted: true, hidden: true });
  const canvas = document.createElement('canvas');
  const result = h('div');
  const status = h('p', { class: 'muted' }, 'Point your camera at a QR code, or upload an image that contains one.');
  const startBtn = h('button', { class: 'btn primary', type: 'button', onclick: start }, '📷 Start camera');
  const stopBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: stop }, 'Stop camera');
  const drop = h('label', { class: 'dropzone', tabindex: 0 }, h('div', {}, 'Or choose / drop an image with a QR code'),
    h('input', { type: 'file', accept: 'image/*', class: 'sr', onchange: e => e.target.files[0] && fromFile(e.target.files[0]) }));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) fromFile(f); });

  function show(text) {
    stop();
    const isUrl = /^https?:\/\/\S+$/i.test(text);
    const kind = /^WIFI:/i.test(text) ? 'Wi-Fi network' : /^BEGIN:VCARD/i.test(text) ? 'Contact card' : /^BEGIN:VCALENDAR/i.test(text) ? 'Calendar event' : /^(mailto|tel|sms|smsto|geo):/i.test(text) ? 'Action link' : isUrl ? 'Website link' : 'Text';
    mount(result, h('div', { class: 'card', style: { marginTop: '16px' } },
      h('div', { class: 'card-title' }, h('h2', {}, 'Result'), h('span', { class: 'badge accent' }, kind)),
      h('pre', { class: 'result-box' }, text),
      isUrl ? h('div', { class: 'alert warn' }, 'Only open links you trust. Check the address above first.') : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(text) }, 'Copy'),
        isUrl ? h('a', { class: 'btn', href: text, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'Open link ↗') : null,
        h('a', { class: 'btn', href: `#/?type=${isUrl ? 'url' : 'text'}` }, 'Make my own'))));
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function fromFile(file) {
    status.textContent = 'Reading image…';
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
      let r = await decodeWithDetector(c);
      if (!r) r = await decodeImageData(c);
      if (r) { status.textContent = 'Found a QR code.'; show(r.text); } else status.textContent = 'No QR code found in that image. Try a sharper, closer picture.';
    } catch { status.textContent = 'That file could not be read as an image.'; }
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) { toast('Camera access is not available in this browser. Upload an image instead.', 'bad'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch { status.textContent = 'Camera permission was denied. Allow camera access, or upload an image instead.'; return; }
    video.srcObject = stream; video.hidden = false; startBtn.hidden = true; stopBtn.hidden = false;
    await video.play().catch(() => {});
    status.textContent = 'Looking for a QR code…';
    await loadJsQR().catch(() => {});
    running = true;
    const tick = async () => {
      if (!running) return;
      if (video.readyState >= 2 && video.videoWidth) {
        let r;
        if ('BarcodeDetector' in window) r = await decodeWithDetector(video);
        if (r === undefined || r === null) {
          const w = Math.min(640, video.videoWidth), k = w / video.videoWidth;
          canvas.width = w; canvas.height = Math.round(video.videoHeight * k);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          r = window.jsQR ? (() => { const d = ctx.getImageData(0, 0, canvas.width, canvas.height); const q = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' }); return q ? { text: q.data } : null; })() : null;
        }
        if (r?.text) { show(r.text); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false; cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    video.srcObject = null; video.hidden = true; startBtn.hidden = false; stopBtn.hidden = true;
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'QR code scanner'), h('p', {}, 'Read a QR code with your camera or from an image. Everything happens in your browser — nothing is uploaded.'))),
    h('div', { class: 'card', style: { maxWidth: '640px' } }, status, video, h('div', { class: 'row' }, startBtn, stopBtn), h('div', { style: { height: '12px' } }), drop), result);
  return stop;
}
