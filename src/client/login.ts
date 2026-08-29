import '@fontsource/bitter/latin-ext-800.css';
import '@fontsource/special-elite/latin-ext-400.css';
import './login.css';
import { getSession, login, register } from './auth-api';

const existing = await getSession().catch(() => ({ authenticated: false as const }));
if (existing.authenticated) window.location.replace('/');

const form = document.querySelector<HTMLFormElement>('#login-form')!;
const username = document.querySelector<HTMLInputElement>('#username')!;
const password = document.querySelector<HTMLInputElement>('#password')!;
const status = document.querySelector<HTMLElement>('#login-status')!;
const submit = document.querySelector<HTMLButtonElement>('.login-submit')!;
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
let mode: 'login' | 'register' = 'login';

for (const tab of tabs) tab.addEventListener('click', () => {
  mode = tab.dataset.mode === 'register' ? 'register' : 'login';
  for (const candidate of tabs) candidate.setAttribute('aria-selected', String(candidate === tab));
  submit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
  password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  status.textContent = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  status.textContent = '';
  try {
    await (mode === 'login' ? login(username.value, password.value) : register(username.value, password.value));
    window.location.replace('/');
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Unable to sign in.';
    submit.disabled = false;
  }
});
