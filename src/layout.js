// The page around the components: the head, the bar across the top, the foot, and the connection
// to the log. The styles are files in public/ (base.css for every page, site.css for the landing
// page, customer.css for a job, paying and the account); the words come from src/shop.js.
import { asset, photo, FONT_CSS } from './assets.js';
import { site } from './shop.js';

export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Small drawings, as inline SVG: they take the shop's colours. Photographs are files in public/photos/. */
export const art = {
  mark: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="12" fill="#1a1f12"/><path d="M32 50V30M32 30c-2-8-10-8-12-16M32 30c2-8 10-8 12-16M24 22l-7-2M40 22l7-2M21 15l-3-5M43 15l3-5" fill="none" stroke="#f0a13a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.800 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h4l1.500 5-2.200 1.600a12 12 0 0 0 5.100 5.100L16 12.500l5 1.500v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/></svg>',
};

const wordmark = (shop) => `<a class="wordmark" href="/">${art.mark}<span><b>${escape(shop.short)}</b><small>${escape(site.trade)}</small></span></a>`;
const tel = (shop) => `tel:+1${shop.phone.replace(/\D/g, '')}`;

/** What a search engine or a shared link should know about the shop. Off for a made-up shop. */
function listing(shop, canonical) {
  if (!shop.listed) return '<meta name="robots" content="noindex, nofollow">';
  const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: shop.name, description: site.description, telephone: shop.phone, address: { '@type': 'PostalAddress', addressLocality: shop.town.split(',')[0], addressRegion: (shop.town.split(',')[1] ?? '').trim() }, ...(canonical ? { url: canonical } : {}) };
  return `${canonical ? `<link rel="canonical" href="${escape(canonical)}">` : ''}<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/**
 * `nav`: who is looking: `customer` (signed in), `staff` (on the staff). `here` marks the current
 * link. `landing` is the landing page: full-width sections and its own stylesheet. `toast` is a
 * signed "done" message to float.
 */
export function layout({ title, shop, body, nav = {}, here = '', landing = false, toast = '', description = site.description, canonical = '' }) {
  const link = (href, words, cls = '') => `<a href="${href}"${cls ? ` class="${cls}"` : ''}${here === href ? ' aria-current="page"' : ''}>${words}</a>`;
  const links = [link('/#services', 'What we do', 'wide'), link('/#story', 'The shop', 'wide'), link('/#visit', 'Visit', 'wide'), nav.customer ? link('/account', 'Account') : link('/account/sign-in', 'Sign in'), ...(nav.staff ? [link('/admin', 'Admin')] : [])].join('');
  const fullTitle = landing ? `${shop.name} · ${shop.town}` : `${title} · ${shop.name}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${listing(shop, canonical)}
  <title>${escape(fullTitle)}</title>
  <meta name="description" content="${escape(description)}">
  <meta property="og:title" content="${escape(fullTitle)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:type" content="website">
  <meta name="theme-color" content="#1a1f12">
  <link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
  <link rel="preload" href="${asset('zilla-slab-latin-700-normal.woff2')}" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${asset('work-sans-latin-400-normal.woff2')}" as="font" type="font/woff2" crossorigin>${landing && photo('hero') ? `
  <link rel="preload" href="${photo('hero')}" as="image" fetchpriority="high">
  <meta property="og:image" content="${escape(canonical ? new URL(photo('hero'), canonical).href : photo('hero'))}">` : ''}
  <style>${FONT_CSS}</style>
  <link rel="stylesheet" href="${asset('base.css')}">
  <link rel="stylesheet" href="${asset(landing ? 'site.css' : 'customer.css')}">
</head>
<body>
  <a class="skip" href="#main">Skip to the page</a>
  <header class="site-head"><div class="wrap bar">${wordmark(shop)}<nav aria-label="Site">${links}<a class="bag" href="/#track"><span class="long">${escape(site.track)}</span><span class="short">Track</span></a></nav></div></header>
  <main id="main"${landing ? ' class="landing"' : ''}>
    ${body}
  </main>
  ${toast ? `<p class="toast" role="status">${escape(toast)}</p>` : ''}
  <footer class="site-foot"><div class="wrap">
    <div class="cols">
      <div>${wordmark(shop)}<p>${escape(site.foot.line)}</p><p>${escape(shop.town)}</p><p><a class="go" href="/#track">${escape(site.track)}</a></p></div>
      <div><h2>Hours</h2><p>${escape(shop.hours)}</p></div>
      <div><h2>Customers</h2><ul><li><a href="/#track">Find your job</a></li><li><a href="/#services">Prices</a></li><li><a href="/account">Your account</a></li><li><a href="${tel(shop)}">${escape(shop.phone)}</a></li></ul></div>
      <div><h2>Staff</h2><ul><li><a href="/admin">Staff sign in</a></li><li><a href="/shop">The shop</a></li></ul></div>
    </div>
    <div class="fine"><p>${escape(shop.concept)}</p><p><a href="${escape(site.foot.builtHref)}">${escape(site.foot.built)}</a></p></div>
  </div></footer>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
