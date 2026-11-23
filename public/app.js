// The staff pages' small extras. Everything works without this file; with it there is a theme
// switch that's remembered, and a few keys for hands that are busy.
//
//   s  the shop     j  jobs     n  take a job in     /  search     ?  the list of keys
//   1 to 9, in the shop: move that job on a stage
const root = document.documentElement;

// Theme: follow the system until someone chooses; then remember it on this device.
const toggle = document.querySelector('[data-theme-toggle]');
const dark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const label = () => toggle && (toggle.textContent = dark() ? 'Light theme' : 'Dark theme');
toggle?.addEventListener('click', () => {
  root.dataset.theme = dark() ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  label();
});
label();

const typing = (el) => el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
  const go = { s: '/shop', j: '/admin/jobs', n: '/shop#new' }[event.key];
  if (go) return void (location.href = go);
  if (event.key === '/') {
    const search = document.querySelector('input[name=q]');
    if (search) (event.preventDefault(), search.focus());
    return;
  }
  if (event.key === '?') {
    const keys = document.querySelector('details.keys');
    if (keys) (keys.open = !keys.open, keys.scrollIntoView({ block: 'nearest' }));
    return;
  }
  if (/^[1-9]$/.test(event.key)) document.querySelector(`[data-key="${event.key}"]`)?.click();
});
