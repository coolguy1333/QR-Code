import { h, mount, toast } from '../ui.js';
import { api, state, refreshMe } from '../app.js';
import { field } from './shared.js';

export default async function render(root, { opts, query }) {
  const register = opts.mode === 'register';
  if (state.user) { location.replace('#/'); return; }
  if (register && state.config.registration === 'closed') {
    mount(root, h('div', { class: 'card auth' }, h('h1', {}, 'Registration is closed'), h('p', { class: 'muted' }, 'Ask an administrator of this site to create an account for you.'), h('a', { class: 'btn', href: '#/login' }, 'Sign in')));
    return;
  }
  const first = state.config.firstRun;
  const email = h('input', { class: 'input', type: 'email', required: true, autocomplete: 'email', name: 'email' });
  const name = h('input', { class: 'input', type: 'text', autocomplete: 'name', name: 'name', maxlength: 80 });
  const pw = h('input', { class: 'input', type: 'password', required: true, autocomplete: register ? 'new-password' : 'current-password', name: 'password', minlength: register ? 8 : null });
  const err = h('div', { class: 'alert bad', hidden: true, role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, register ? 'Create account' : 'Sign in');
  const form = h('form', { onsubmit: async e => {
    e.preventDefault();
    err.hidden = true; btn.disabled = true;
    try {
      const r = await api('POST', register ? '/api/auth/register' : '/api/auth/login', { email: email.value, password: pw.value, name: name.value });
      if (r.pending) { mount(root, h('div', { class: 'card auth' }, h('h1', {}, 'Almost there'), h('p', {}, r.message), h('a', { class: 'btn', href: '#/' }, 'Back to the generator'))); return; }
      await refreshMe();
      toast(register ? `Welcome, ${r.user.name}!` : 'Signed in', 'good');
      const next = query.next && query.next.startsWith('/') ? query.next : '/';
      location.hash = `#${next}`;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  } },
  register ? field('Your name', name) : null,
  field('Email', email),
  field('Password', pw, register ? 'At least 8 characters.' : null),
  err, btn);
  mount(root, h('div', { class: 'card auth' },
    h('h1', {}, register ? (first ? 'Set up your site' : 'Create your free account') : 'Welcome back'),
    first && register ? h('div', { class: 'alert info' }, 'You are the first person here, so this account becomes the site administrator.') : null,
    register && state.config.registration === 'approval' && !first ? h('div', { class: 'alert info' }, 'New accounts are approved by an administrator before they can sign in.') : null,
    form,
    !register && state.config.registration === 'closed' ? null : h('p', { class: 'muted', style: { marginTop: '16px', marginBottom: 0 } }, register ? 'Already registered? ' : 'New here? ',
      h('a', { href: register ? '#/login' : '#/register' }, register ? 'Sign in' : 'Create a free account'))));
  email.focus();
}
