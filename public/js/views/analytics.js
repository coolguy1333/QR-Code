import { h, lineChart, hourChart, barList, fmtNum, countryName, flag } from '../ui.js';

export function tile(n, label, sub) {
  return h('div', { class: 'stat' }, h('div', { class: 'n' }, typeof n === 'number' ? fmtNum(n) : n), h('div', { class: 'l' }, label), sub ? h('small', {}, sub) : null);
}

/** Full analytics block for a statsFor() result. */
export function statsPanel(s, { topCodes = false, linkCodes = true } = {}) {
  const topCountry = s.countries.find(c => c.k !== 'Unknown');
  const avg = s.days ? (s.total / s.days) : 0;
  return h('div', { class: 'stack' },
    h('div', { class: 'grid cols-4 keep2' },
      tile(s.total, `Scans · last ${s.days} days`), tile(s.unique, 'Unique visitors'),
      tile(avg < 10 ? avg.toFixed(1) : Math.round(avg), 'Scans per day'),
      tile(topCountry ? `${flag(topCountry.k)} ${countryName(topCountry.k)}` : '—', 'Top country')),
    h('div', { class: 'card' }, h('div', { class: 'card-title' }, h('h3', {}, 'Scans over time'), h('small', {}, h('span', { style: { color: 'var(--accent)' } }, '━ scans'), '  ', h('span', { style: { color: 'var(--good)' } }, '╌ unique'))), lineChart(s.series)),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', {}, 'Time of day'), hourChart(s.hours), h('small', { class: 'muted' }, 'Hours in your local time.')),
      h('div', { class: 'card' }, h('h3', {}, 'Devices'), barList(s.devices))),
    h('div', { class: 'grid cols-3' },
      h('div', { class: 'card' }, h('h3', {}, 'Countries'), barList(s.countries, { label: c => `${flag(c.k)} ${countryName(c.k)}` })),
      h('div', { class: 'card' }, h('h3', {}, 'Cities'), barList(s.cities, { empty: 'City data needs a geo-aware proxy (e.g. Cloudflare).' })),
      h('div', { class: 'card' }, h('h3', {}, 'Referrers'), barList(s.referrers))),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', {}, 'Operating systems'), barList(s.os)),
      h('div', { class: 'card' }, h('h3', {}, 'Browsers'), barList(s.browsers))),
    topCodes ? h('div', { class: 'card' }, h('h3', {}, 'Top codes'), barList(s.topCodes, { label: c => linkCodes ? h('a', { href: `#/codes/${c.id}` }, c.name) : c.name })) : null);
}

export const RANGES = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']];
