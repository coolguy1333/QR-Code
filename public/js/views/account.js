import { h, mount, toast, confirmDialog, fmtBytes, fmtNum, ago, fmtDate } from '../ui.js';
import { api, state, refreshMe } from '../app.js';
import { field } from './shared.js';
import { saveBlob } from '../export.js';

export default async function render(root) {
  await refreshMe();
  const u = state.user, lim = state.limits;
  const sessionsBox = h('div');

  const form = (fields, submit, label, danger = false) => {
    const err = h('div', { class: 'alert bad', hidden: true });
    const btn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'submit' }, label);
    return h('form', { onsubmit: async e => { e.preventDefault(); err.hidden = true; btn.disabled = true; try { await submit(); } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { btn.disabled = false; } } }, fields, err, btn);
  };

  const name = h('input', { class: 'input', value: u.name, maxlength: 80, required: true });
  const newEmail = h('input', { class: 'input', type: 'email', value: u.email, required: true });
  const emailPw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const curPw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const nextPw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
  const delPw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });

  async function loadSessions() {
    const { items } = await api('GET', '/api/me/sessions');
    mount(sessionsBox, h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, items.map(s => h('tr', {}, h('td', {}, s.current ? h('b', {}, 'This device') : 'Signed-in device', h('br'), h('small', { class: 'muted' }, (s.ua || '').slice(0, 70))), h('td', {}, ago(s.created_at)),
      h('td', { class: 'num' }, s.current ? null : h('button', { class: 'btn sm', onclick: async () => { await api('DELETE', `/api/me/sessions/${s.id}`); loadSessions(); } }, 'Sign out'))))))));
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Account'), h('p', {}, `${u.email} · ${u.role === 'admin' ? 'Administrator' : 'Member'} since ${fmtDate(u.createdAt)}`))),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, 'Profile'), form(field('Name', name), async () => { await api('PATCH', '/api/me', { name: name.value }); await refreshMe(); toast('Saved', 'good'); }, 'Save')),
        h('div', { class: 'card' }, h('h2', {}, 'Email address'), form([field('Email', newEmail), field('Current password', emailPw)], async () => { await api('POST', '/api/me/email', { email: newEmail.value, password: emailPw.value }); emailPw.value = ''; await refreshMe(); toast('Email updated', 'good'); }, 'Change email')),
        h('div', { class: 'card' }, h('h2', {}, 'Password'), form([field('Current password', curPw), field('New password', nextPw, 'At least 8 characters. Other devices will be signed out.')], async () => { await api('POST', '/api/me/password', { current: curPw.value, next: nextPw.value }); curPw.value = ''; nextPw.value = ''; toast('Password changed', 'good'); loadSessions(); }, 'Change password'))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, 'Usage'),
          h('dl', { class: 'kv' }, h('dt', {}, 'QR codes'), h('dd', {}, `${fmtNum(lim.codeCount)} / ${lim.maxCodes ? fmtNum(lim.maxCodes) : 'unlimited'}`), h('dt', {}, 'File storage'), h('dd', {}, `${fmtBytes(lim.storageUsed)} / ${lim.storageMax ? fmtBytes(lim.storageMax) : 'unlimited'}`))),
        h('div', { class: 'card' }, h('h2', {}, 'Signed-in devices'), sessionsBox),
        h('div', { class: 'card' }, h('h2', {}, 'Your data'), h('p', { class: 'muted' }, 'Download everything you have created as a JSON file.'),
          h('button', { class: 'btn', onclick: async () => { try { const r = await api('GET', '/api/me/export', undefined, { raw: true }); saveBlob(await r.blob(), 'qr-studio-export.json'); } catch (e) { toast(e.message, 'bad'); } } }, 'Download my data')),
        h('div', { class: 'card' }, h('h2', { style: { color: 'var(--bad)' } }, 'Delete account'), h('p', { class: 'muted' }, 'Permanently deletes your account, all QR codes (dynamic codes stop working), files and analytics.'),
          form(field('Confirm with your password', delPw), async () => {
            if (!(await confirmDialog('Delete your account and everything in it? This cannot be undone.', { ok: 'Delete everything', danger: true }))) return;
            await api('DELETE', '/api/me', { password: delPw.value }); state.user = null; await refreshMe(); toast('Account deleted'); location.hash = '#/';
          }, 'Delete my account', true)))));
  await loadSessions();
}
