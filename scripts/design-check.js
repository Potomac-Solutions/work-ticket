#!/usr/bin/env node
// Design checks, in a real browser, against a running server:
//
//   npm run demo                       (in one terminal)
//   node scripts/design-check.js       (in another; or pass a base URL)
//
// For every page, signed out and as each demo sign-in:
//   - nothing scrolls sideways at 320, 375, 768, 1280 or 1920 wide
//   - one <h1>, headings that don't skip a level, a <main>, a skip link
//   - every input has a label; every image has alt text
//   - text contrast of at least 4.5:1 (3:1 for large text)
// and for the landing page, what it weighs. Add `--shots <dir>` to save a screenshot of each page
// at 375 and 1280. Exits 1 if anything fails. The no-JavaScript walk is in test/work-ticket.test.js.
import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : '';
const base = (args.find((arg) => /^https?:/.test(arg)) ?? 'http://localhost:3000').replace(/\/$/, '');
const WIDTHS = [320, 375, 768, 1280, 1920];

const ROLES = [
  { name: 'guest', routes: ['/', '/account/sign-in', '/account/sign-up', '/account/forgot'] },
  { name: 'customer', signIn: ['/account/sign-in', 'riley@example.com', 'backbone-guest-demo'], routes: ['/account'] },
  { name: 'owner', signIn: ['/admin', 'owner@example.com', 'backbone-owner-demo'], routes: ['/shop', '/shop/new/processing', '/admin', '/admin/jobs', '/admin/customers', '/admin/reports', '/admin/settings', '/admin/outbox', '/staff/people'] },
];

/** Runs in the page: structure, labels and contrast. Returns a list of problems. */
function audit() {
  const problems = [];
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  };
  // Open shadow roots too: the components' markup is in them.
  const all = (root, selector, found = []) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.matches(selector)) found.push(el);
      if (el.shadowRoot) all(el.shadowRoot, selector, found);
    }
    return found;
  };
  const h1 = all(document, 'h1').filter(visible);
  if (h1.length !== 1) problems.push(`${h1.length} <h1> elements`);
  let last = 0;
  for (const h of all(document, 'h1,h2,h3,h4').filter(visible)) {
    const level = Number(h.tagName[1]);
    if (last && level > last + 1) problems.push(`heading skips from h${last} to h${level}: "${h.textContent.trim().slice(0, 40)}"`);
    last = level;
  }
  if (!document.querySelector('main')) problems.push('no <main>');
  if (!document.querySelector('a.skip')) problems.push('no skip link');
  for (const input of all(document, 'input:not([type=hidden]),select,textarea').filter(visible)) {
    const labelled = input.closest('label') || input.getAttribute('aria-label') || input.getAttribute('aria-labelledby') || (input.id && input.getRootNode().querySelector(`label[for="${input.id}"]`));
    if (!labelled) problems.push(`unlabelled ${input.tagName.toLowerCase()}[name=${input.name}]`);
  }
  for (const img of all(document, 'img')) if (!img.hasAttribute('alt')) problems.push(`image without alt: ${img.src}`);

  // Contrast: each text node's colour against the nearest solid background behind it.
  const parse = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const parentOf = (el) => el.parentElement ?? el.getRootNode().host ?? null;
  const backdrop = (el) => {
    const layers = [];
    for (let at = el; at; at = parentOf(at)) {
      const style = getComputedStyle(at);
      if (style.backgroundImage !== 'none' && !layers.length) return null; // a gradient or picture: judged by eye
      const colour = parse(style.backgroundColor);
      if (colour && colour.a > 0) {
        layers.push(colour);
        if (colour.a === 1) break;
      }
    }
    return layers.reverse().reduce((under, top) => over(top, under), { r: 255, g: 255, b: 255, a: 1 });
  };
  const seen = new Set();
  const walk = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !node.textContent.trim() || !visible(el) || el.closest('svg,script,style,[aria-hidden=true]') || el.matches(':disabled') || el.closest(':disabled')) continue;
      const style = getComputedStyle(el);
      if (style.textDecorationLine.includes('line-through')) continue; // struck out on purpose: sold out
      const fg = parse(style.color);
      const bg = backdrop(el);
      if (!fg || !bg) continue;
      const colour = over(fg, bg);
      const [hi, lo] = [lum(colour), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        const key = `${style.color} on ${Object.values(bg).slice(0, 3).map(Math.round)}`;
        if (!seen.has(key)) problems.push(`contrast ${ratio.toFixed(2)}: "${node.textContent.trim().slice(0, 30)}" (${key})`);
        seen.add(key);
      }
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document.body);
  return problems;
}

const system = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => existsSync(path));
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME ?? system }));
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
let pages = 0;

for (const scheme of ['light', 'dark']) {
  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    if (role.signIn) {
      await page.goto(base + role.signIn[0]);
      await page.fill('input[name=email]', role.signIn[1]);
      await page.fill('input[name=password]', role.signIn[2]);
      await page.click('main button[type=submit]');
      await page.waitForLoadState('networkidle');
    }
    if (role.bag) {
      await page.goto(base + '/');
      const add = page.locator('menu-item button:not([disabled])').first();
      if (await add.count()) await add.click().then(() => page.waitForLoadState('networkidle'));
    }
    for (const route of role.routes) {
      const where = `${role.name} ${route} (${scheme})`;
      pages++;
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(base + route);
        await page.waitForLoadState('networkidle');
        const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (extra > 1) failures.push(`${where}: scrolls sideways by ${extra}px at ${width}`);
        if (shots && scheme === 'light' && (width === 375 || width === 1280)) await page.screenshot({ path: `${shots}/${role.name}${route.replace(/\//g, '-').replace(/-$/, '-home')}-${width}.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      for (const problem of await page.evaluate(audit)) failures.push(`${where}: ${problem}`);
    }
    await context.close();
  }
}

// What the landing page weighs, cold.
const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
const page = await context.newPage();
const weights = [];
page.on('response', async (response) => {
  const body = await response.body().catch(() => null);
  if (body) weights.push([new URL(response.url()).pathname, body.length]);
});
await page.goto(base + '/');
await page.waitForLoadState('networkidle');
const total = weights.reduce((sum, [, bytes]) => sum + bytes, 0);
const fonts = weights.filter(([path]) => path.endsWith('.woff2'));
for (const [path, bytes] of fonts) if (bytes > 60_000) failures.push(`font over 60 KB: ${path} (${bytes})`);
await browser.close();

console.log(`${pages} pages checked at ${WIDTHS.join(', ')} wide, light and dark.`);
console.log(`Landing page: ${weights.length} requests, ${(total / 1024).toFixed(0)} KB uncompressed (${fonts.length} fonts, ${(fonts.reduce((sum, [, bytes]) => sum + bytes, 0) / 1024).toFixed(0)} KB).`);
if (failures.length) {
  console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:`);
  for (const failure of [...new Set(failures)]) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('No problems.');
