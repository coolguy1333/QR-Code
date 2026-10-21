import { h, mount, toast, confirmDialog, promptDialog } from '../ui.js';
import { api, state } from '../app.js';
import { copyLine } from './shared.js';

export default async function render(root) {
  const box = h('div', { class: 'stack' });
  async function load() {
    const r = await api('GET', '/api/domains');
    const own = r.items.filter(d => !d.global), global = r.items.filter(d => d.global);
    mount(box, 
      global.length ? h('div', { class: 'card' }, h('h2', {}, 'Provided by this site'), h('p', { class: 'muted' }, 'You can pick these when you create a dynamic code.'), h('div', { class: 'chips' }, global.map(d => h('span', { class: 'badge accent' }, d.host)))) : null,
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', {}, 'Your domains'), r.allowed ? h('button', { class: 'btn primary sm', onclick: add }, '+ Add domain') : null),
        !r.allowed ? h('p', { class: 'muted' }, 'The administrator has turned off personal domains.') : null,
        h('p', { class: 'muted' }, 'Use your own short domain like go.yourbrand.com so scans show your brand. It takes three steps:'),
        h('ol', { class: 'muted' }, h('li', {}, 'Add the domain here.'), h('li', {}, 'Create the DNS TXT record shown below, then press Verify.'), h('li', {}, `Ask the site operator to serve that hostname from this site, or point its DNS to the same server as ${new URL(state.config.baseUrl).host}.`)),
        own.length ? own.map(d => h('div', { class: 'card flat', style: { marginTop: '10px' } },
          h('div', { class: 'row between' }, h('b', {}, d.host), d.verified ? h('span', { class: 'badge good' }, 'Verified') : h('span', { class: 'badge warn' }, 'Not verified')),
          !d.verified ? h('div', { class: 'stack', style: { marginTop: '10px' } }, h('div', {}, h('small', { class: 'muted' }, 'TXT record name'), copyLine(d.txtName)), h('div', {}, h('small', { class: 'muted' }, 'TXT record value'), copyLine(d.token))) : null,
          h('div', { class: 'row', style: { marginTop: '10px' } },
            !d.verified ? h('button', { class: 'btn primary sm', onclick: async () => { try { await api('POST', `/api/domains/${d.id}/verify`); toast('Domain verified', 'good'); load(); } catch (e) { toast(e.message, 'bad'); } } }, 'Verify') : null,
            h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmDialog(`Remove ${d.host}? Codes using it keep working on the default domain.`, { ok: 'Remove', danger: true })) { await api('DELETE', `/api/domains/${d.id}`); load(); } } }, 'Remove')))) : h('p', { class: 'muted' }, 'You have not added a domain yet.')));
  }
  async function add() {
    const host = await promptDialog({ title: 'Add a domain', label: 'Domain', ok: 'Add', hint: 'For example go.example.com' });
    if (!host?.trim()) return;
    try { await api('POST', '/api/domains', { host }); load(); } catch (e) { toast(e.message, 'bad'); }
  }
  mount(root, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Custom short domains'), h('p', {}, 'Brand your dynamic QR links.'))), box);
  await load();
}
