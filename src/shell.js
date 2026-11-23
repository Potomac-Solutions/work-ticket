// The page around the staff's side: the shop floor and the admin. A sidebar at a desk; on a
// phone a bar on top, tabs along the bottom, and the sidebar as a sheet that opens from "Menu"
// (a link to #nav, so it works without JavaScript). Styles: public/base.css, then public/app.css.
import { CHART_CSS } from '@potomac-solutions/kit/charts';
import { asset, FONT_CSS } from './assets.js';
import { escape, art } from './layout.js';

/**
 * `who` is the signed-in member of staff, `owner` whether they are one. `here` marks the current
 * link. `waiting` is how many jobs are ready and not picked up, shown beside "The shop".
 */
export function shell({ title, shop, body, who, owner = false, here = '', refresh = 0, waiting = 0 }) {
  const wordmark = `<a class="wordmark" href="/admin">${art.mark}<span><b>${escape(shop.short)}</b><small>Staff</small></span></a>`;
  const link = (href, words, extra = '') => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${words}${extra}</a>`;
  const count = waiting ? `<b aria-label="${waiting} ready for pickup">${waiting}</b>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">${refresh ? `
  <meta http-equiv="refresh" content="${refresh}">` : ''}
  <title>${escape(title)} · ${escape(shop.name)} staff</title>
  <meta name="theme-color" content="#1a1f12">
  <link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
  <script>document.documentElement.classList.add('js');try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}</script>
  <style>${FONT_CSS}${CHART_CSS}</style>
  <link rel="stylesheet" href="${asset('base.css')}">
  <link rel="stylesheet" href="${asset('app.css')}">
</head>
<body class="staff">
  <a class="skip" href="#main">Skip to the page</a>
  <div class="shell">
    <header class="topbar">${wordmark}<a class="menu" href="#nav">Menu</a></header>
    <aside class="side" id="nav">
      <a class="close" href="#main">Close</a>
      ${wordmark}
      <nav aria-label="Staff">
        <small>Today</small>${link('/shop', 'The shop', count)}
        <small>Books</small>${link('/admin', 'Overview')}${link('/admin/jobs', 'Jobs')}${link('/admin/customers', 'Customers')}${
          owner ? `
        <small>Owner</small>${link('/admin/reports', 'Reports')}${link('/admin/settings', 'Settings')}${link('/staff/people', 'Staff')}${link('/admin/outbox', 'Outbox')}` : ''
        }
      </nav>
      <details class="keys"><summary>Keys</summary><dl><dt><kbd>s</kbd></dt><dd>The shop</dd><dt><kbd>j</kbd></dt><dd>Jobs</dd><dt><kbd>n</kbd></dt><dd>Take a job in</dd><dt><kbd>/</kbd></dt><dd>Search</dd><dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Move a job on</dd><dt><kbd>?</kbd></dt><dd>This list</dd></dl></details>
      <div class="me">
        <p><strong>${escape(who.name)}</strong><span>${owner ? 'Owner' : 'Staff'}</span></p>
        <a href="/staff/password">Your password</a>
        <a href="/">The shop’s page</a>
        <div class="row"><button type="button" data-theme-toggle data-js-only>Dark theme</button><form method="post" action="/staff/sign-out"><button type="submit">Sign out</button></form></div>
      </div>
    </aside>
    <main id="main">
      ${body}
    </main>
    <nav class="tabs" aria-label="Quick">${link('/shop', 'Shop', count)}${link('/admin/jobs', 'Jobs')}${link('/admin/customers', 'Customers')}${link('/admin', 'Overview')}</nav>
  </div>
  <script type="module" src="${asset('app.js')}"></script>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
