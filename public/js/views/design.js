import { h, mount, toast, promptDialog } from '../ui.js';
import { DEFAULT_STYLE, SHAPES, normalizeStyle, shapePreviewSVG } from '../qr-render.js';
import { fileToDataUrl } from '../export.js';
import { field, seg, BUILTIN_STYLES } from './shared.js';

const SWATCHES = ['#000000', '#1f2937', '#1d4ed8', '#4f46e5', '#7c3aed', '#be185d', '#dc2626', '#ea580c', '#15803d', '#0f766e'];
const FRAME_TEXTS = ['SCAN ME', 'Scan to visit', 'Follow us', 'View menu', 'Join Wi-Fi', 'Save contact', 'Pay here'];

function paintEditor(label, paint, { transparent = false, onChange }) {
  const box = h('div', { class: 'paint' });
  const draw = () => {
    mount(box, 
      h('div', { class: 'row between' }, h('b', {}, label), h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': `${label} type`, onchange: e => { paint.type = e.target.value; draw(); onChange(); } },
        [['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient'], ...(transparent ? [['transparent', 'Transparent']] : [])].map(([v, l]) => h('option', { value: v, selected: paint.type === v }, l)))),
      paint.type === 'transparent' ? h('p', { class: 'muted', style: { margin: 0 } }, 'No background is drawn. Place the code on a plain light surface.') : h('div', { class: 'row' },
        h('label', {}, paint.type === 'solid' ? 'Color' : 'From', ' ', h('input', { type: 'color', value: paint.c1, 'aria-label': `${label} color`, oninput: e => { paint.c1 = e.target.value; onChange(); } })),
        paint.type !== 'solid' ? h('label', {}, 'To ', h('input', { type: 'color', value: paint.c2, 'aria-label': `${label} second color`, oninput: e => { paint.c2 = e.target.value; onChange(); } })) : null,
        paint.type === 'linear' ? h('label', { class: 'grow' }, 'Angle ', h('input', { type: 'range', min: 0, max: 360, value: paint.angle, 'aria-label': 'Gradient angle', oninput: e => { paint.angle = Number(e.target.value); onChange(); } })) : null),
      label === 'Foreground' && paint.type === 'solid' ? h('div', { class: 'swatches' }, SWATCHES.map(c => h('button', { type: 'button', class: 'swatch', style: { background: c }, title: c, 'aria-label': `Use ${c}`, onclick: () => { paint.c1 = c; draw(); onChange(); } }))) : null,
    );
  };
  draw();
  return box;
}

function shapeGrid(kind, current, onPick) {
  const wrap = h('div', { class: 'shapes', role: 'group' });
  for (const [v, l] of SHAPES[kind]) {
    wrap.append(h('button', { type: 'button', class: 'shape', 'aria-pressed': String(current() === v), 'data-v': v, title: l, onclick: () => { onPick(v); [...wrap.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); } },
      h('span', { html: shapePreviewSVG(kind, v) }), l));
  }
  return wrap;
}

/**
 * @param style  mutable style object (kept normalised by the caller)
 * @param templates saved templates [{id,name,style}]
 */
export function designPanel({ style, onChange, templates = [], canSaveTemplate = false, onTemplateSaved }) {
  const root = h('div');
  let tab = 'colors';
  const emit = () => onChange(style);

  const replaceStyle = next => { for (const k of Object.keys(style)) delete style[k]; Object.assign(style, normalizeStyle(next)); build(); emit(); };
  const applyLook = p => {
    const keep = { ecc: style.ecc, margin: style.margin, logo: style.logo, frame: style.frame };
    replaceStyle({ ...structuredClone(DEFAULT_STYLE), ...keep, ...structuredClone(p) });
  };

  const tabs = {
    colors() {
      const custom = !!(style.eyeOuterColor || style.eyeInnerColor);
      const eyeBox = h('div', { class: 'row', hidden: !custom },
        h('label', {}, 'Eye frame ', h('input', { type: 'color', value: style.eyeOuterColor || style.fg.c1, 'aria-label': 'Eye frame color', oninput: e => { style.eyeOuterColor = e.target.value; emit(); } })),
        h('label', {}, 'Eye center ', h('input', { type: 'color', value: style.eyeInnerColor || style.eyeOuterColor || style.fg.c1, 'aria-label': 'Eye center color', oninput: e => { style.eyeInnerColor = e.target.value; emit(); } })));
      return h('div', {},
        paintEditor('Foreground', style.fg, { onChange: emit }),
        paintEditor('Background', style.bg, { transparent: true, onChange: emit }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: custom, onchange: e => { eyeBox.hidden = !e.target.checked; if (!e.target.checked) { style.eyeOuterColor = ''; style.eyeInnerColor = ''; emit(); } else { style.eyeOuterColor = style.fg.c1; style.eyeInnerColor = style.fg.c1; emit(); } } }), 'Use different colors for the three corner “eyes”'),
        eyeBox);
    },
    shapes() {
      return h('div', {},
        h('div', { class: 'group-label' }, 'Data pattern'), shapeGrid('dots', () => style.dots, v => { style.dots = v; emit(); }),
        h('div', { class: 'group-label' }, 'Corner eye · frame'), shapeGrid('eyeOuter', () => style.eyeOuter, v => { style.eyeOuter = v; emit(); }),
        h('div', { class: 'group-label' }, 'Corner eye · center'), shapeGrid('eyeInner', () => style.eyeInner, v => { style.eyeInner = v; emit(); }));
    },
    logo() {
      const lg = style.logo;
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'sr', id: 'logo-file', onchange: async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const src = await fileToDataUrl(f, 256);
          style.logo = { src, size: 20, margin: 1, shape: 'square', hideDots: true, bg: '#ffffff' };
          if (style.ecc === 'L' || style.ecc === 'M') { style.ecc = 'Q'; toast('Error correction raised to Q so the logo cannot break scanning.'); }
          build(); emit();
        } catch (err) { toast(err.message, 'bad'); }
      } });
      const drop = h('label', { class: 'dropzone', for: 'logo-file', tabindex: 0 }, lg ? h('img', { class: 'thumb', src: lg.src, alt: 'Logo' }) : null, h('div', {}, lg ? 'Replace image' : 'Click to add a logo or image to the center'), h('small', {}, 'PNG, JPG, WebP or GIF'));
      if (!lg) return h('div', {}, input, drop);
      return h('div', {}, input, drop,
        h('div', { style: { height: '12px' } }),
        field(`Size · ${lg.size}% of the code`, h('input', { type: 'range', min: 5, max: 30, value: lg.size, oninput: e => { lg.size = Number(e.target.value); e.target.closest('label').querySelector('.lbl').textContent = `Size · ${lg.size}% of the code`; emit(); } })),
        field('Clear space around logo', h('input', { type: 'range', min: 0, max: 4, step: 1, value: lg.margin, oninput: e => { lg.margin = Number(e.target.value); emit(); } })),
        h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', { class: 'lbl' }, 'Logo shape'), seg([['square', 'Square'], ['circle', 'Circle']], lg.shape, v => { lg.shape = v; emit(); })),
          h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Backing'), h('input', { type: 'color', value: lg.bg, onchange: e => { lg.bg = e.target.value; emit(); }, oninput: e => { lg.bg = e.target.value; emit(); } }))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: lg.hideDots, onchange: e => { lg.hideDots = e.target.checked; emit(); } }), 'Remove dots behind the logo (recommended)'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: () => { style.logo = null; build(); emit(); } }, 'Remove logo'));
    },
    frame() {
      const fr = style.frame;
      return h('div', {},
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Frame style' }, SHAPES.frame.map(([v, l]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(fr.type === v), onclick: () => { fr.type = v; build(); emit(); } }, l))),
        fr.type !== 'none' ? h('div', { style: { marginTop: '14px' } },
          field('Call-to-action text', h('input', { class: 'input', value: fr.text, maxlength: 30, oninput: e => { fr.text = e.target.value; emit(); } })),
          h('div', { class: 'chips', style: { marginBottom: '12px' } }, FRAME_TEXTS.map(t => h('button', { type: 'button', class: 'chip', onclick: () => { fr.text = t; build(); emit(); } }, t))),
          h('div', { class: 'row' },
            h('label', {}, 'Frame color ', h('input', { type: 'color', value: fr.color, oninput: e => { fr.color = e.target.value; emit(); } })),
            h('label', {}, 'Text color ', h('input', { type: 'color', value: fr.textColor, oninput: e => { fr.textColor = e.target.value; emit(); } })))) : null);
    },
    options() {
      return h('div', {},
        field('Error correction', seg([['L', 'L · 7%'], ['M', 'M · 15%'], ['Q', 'Q · 25%'], ['H', 'H · 30%']], style.ecc, v => { style.ecc = v; emit(); }),
          'Higher levels survive scratches and logos better but make the code denser.'),
        field(`Quiet zone (margin) · ${style.margin} modules`, h('input', { type: 'range', min: 0, max: 10, value: style.margin, oninput: e => { style.margin = Number(e.target.value); e.target.closest('label').querySelector('.lbl').textContent = `Quiet zone (margin) · ${style.margin} modules`; emit(); } }),
          'The empty border scanners need. 4 modules is the standard.'));
    },
  };

  function build() {
    const tplSel = templates.length ? h('select', { class: 'input', style: { width: 'auto' }, 'aria-label': 'Saved template', onchange: e => { const t = templates.find(x => String(x.id) === e.target.value); if (t) replaceStyle(t.style); e.target.value = ''; } },
      h('option', { value: '' }, 'My templates…'), templates.map(t => h('option', { value: t.id }, t.name))) : null;
    mount(root, 
      h('div', { class: 'chips', style: { marginBottom: '12px' }, role: 'group', 'aria-label': 'Quick styles' },
        BUILTIN_STYLES.map(b => h('button', { type: 'button', class: 'chip', onclick: () => applyLook(b.style) }, b.name)), tplSel,
        canSaveTemplate ? h('button', { type: 'button', class: 'chip', onclick: async () => {
          const name = await promptDialog({ title: 'Save as template', label: 'Template name', ok: 'Save' });
          if (name?.trim()) onTemplateSaved?.(name.trim(), structuredClone(style));
        } }, '+ Save as template') : null),
      h('div', { class: 'tabs', role: 'tablist', style: { marginBottom: '14px' } }, [['colors', 'Colors'], ['shapes', 'Shapes'], ['logo', 'Logo'], ['frame', 'Frame'], ['options', 'Options']].map(([k, l]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; build(); } }, l))),
      tabs[tab]());
  }
  build();
  return root;
}
