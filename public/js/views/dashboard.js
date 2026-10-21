import { h, mount } from '../ui.js';
import { api, qs, tzOffset, state } from '../app.js';
import { select, loadMeta } from './shared.js';
import { statsPanel, RANGES, tile } from './analytics.js';

export default async function render(root) {
  const meta = await loadMeta();
  const F = { days: 30, campaign: '', folder: '' };
  const box = h('div');
  async function load() {
    mount(box, h('div', { class: 'spinner' }));
    try {
      const s = await api('GET', `/api/stats${qs({ ...F, tz: tzOffset() })}`);
      mount(box, 
        h('div', { class: 'grid cols-3', style: { marginBottom: '16px' } }, tile(s.counts.codes, 'QR codes'), tile(s.counts.dynamic, 'Dynamic codes'), tile(s.counts.scans, 'Scans, all time')),
        s.counts.dynamic === 0 ? h('div', { class: 'alert info' }, 'Scan analytics are collected for dynamic codes. ', h('a', { href: '#/' }, 'Create one'), ' to start tracking.') : null,
        statsPanel(s, { topCodes: true }));
    } catch (e) { mount(box, h('div', { class: 'alert bad' }, e.message)); }
  }
  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Analytics'), h('p', {}, `All your dynamic codes, ${state.user.name}.`)),
      h('div', { class: 'row' },
        select(RANGES, F.days, v => { F.days = Number(v); load(); }),
        select([['', 'All campaigns'], ...meta.campaigns.map(c => [c.id, c.name])], F.campaign, v => { F.campaign = v; load(); }),
        select([['', 'All folders'], ...meta.folders.map(c => [c.id, c.name])], F.folder, v => { F.folder = v; load(); }))),
    box);
  await load();
}
