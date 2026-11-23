// Work Ticket's walk: the shop's tablet takes jobs in and moves them along; each customer's
// phone follows their own job.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { loadQr } from '@journey-to-code/symbology';
import { createApp } from '../server.js';

// A redirect's location as words: the signature on its message (kit/notice) checked and taken off.
const plain = (location) => {
  location = String(location ?? '');
  if (/[?&](problem|done)=/.test(location) && !location.startsWith('?')) assert.match(location, /&sig=[\w-]{22}/, `unsigned message: ${location}`);
  return decodeURIComponent(location.replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
};

// The owner every test shop starts with, set up from the shop's setup link; cheap hashing for tests.
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
const COST = { N: 2 ** 10, r: 8, p: 1 };
async function withOwner(server) {
  const made = await server.staff.accept(await server.staff.setup(), OWNER);
  if (!made.ok) throw new Error(made.error);
  return server;
}

const dir = mkdtempSync(join(tmpdir(), 'work-ticket-'));
const errors = [];
let browser;
let app;

before(async () => {
  const server = await withOwner(await createApp({ staffCost: COST, db: join(dir, 'app.db'), cache: false, secret: 'test' }));
  await new Promise((done) => server.listen(0, done));
  app = { server, base: `http://localhost:${server.address().port}` };
  const system = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => existsSync(path));
  browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME ?? system }));
});
after(async () => {
  await browser?.close();
  app.server.closeAllConnections?.();
  await new Promise((done) => app.server.close(done));
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(errors, [], 'no page errors in any browser');
});

/** A browser: the shop's tablet or a customer's phone. */
async function device(name, { javaScriptEnabled = true, shift = false } = {}) {
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && !/403/.test(message.text()) && errors.push(`${name}: ${message.text()}`));
  await page.goto(app.base);
  const post = async (path, form, headers = {}) => {
    const response = await context.request.post(`${app.base}${path}`, { form, headers, maxRedirects: 0 });
    return { status: response.status(), location: plain(response.headers().location ?? '') };
  };
  const get = async (path) => (await context.request.get(`${app.base}${path}`)).text();
  if (shift) await post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
  return { context, page, post, get };
}

/** The shop takes a job in by plain post; its key and tag. */
async function takeIn(shop, kind = 'processing', fields = {}) {
  const form = { name: 'Dale Friend', phone: '(301) 555-0199', cuts: 'All ground', ...fields };
  const done = await shop.post(`/shop/new/${kind}`, form);
  const key = /^\/shop\/tag\/(j[a-z0-9]+)$/.exec(done.location)?.[1];
  assert.ok(key, JSON.stringify(done));
  return { key, job: app.server.book.job(key) };
}
/** Press the job's button on the board: it says which stage it moves to. */
const advance = (shop, key, extra = {}) => {
  const job = app.server.book.job(key);
  const next = job ? job.kind.stages[job.kind.stages.indexOf(job.status) + 1] ?? '' : '';
  return shop.post('/shop/advance', { key, to: next, ...extra });
};

test('without JavaScript: the shop takes a job in, and its tag opens the customer’s page', async () => {
  const shop = await device('shop', { javaScriptEnabled: false, shift: true });
  await shop.page.goto(`${app.base}/shop`);
  await shop.page.click('a[href="/shop/new/processing"]');
  await shop.page.fill('[name=name]', 'Dale Friend');
  await shop.page.fill('[name=phone]', '301-555-0199');
  await shop.page.selectOption('[name=cuts]', 'Half steaks and roasts, half ground');
  await shop.page.check('input[value="Summer sausage"]');
  await shop.page.check('input[value="Jerky"]');
  await shop.page.click('form.panel button[type=submit]');
  await shop.page.waitForURL(/\/shop\/tag\/j[a-z0-9]+$/);
  const key = shop.page.url().split('/').pop();
  const tag = await shop.page.locator('.tag').innerText();
  assert.match(tag, /Tag (\d{4})[\s\S]*Dale Friend · Deer processing[\s\S]*Half steaks and roasts, half ground[\s\S]*Summer sausage, Jerky/);
  // The tag's code is the customer's link, on this server.
  const qr = await loadQr();
  const expected = qr.svg(qr.encode(`${app.base}/t/${key}`), { title: `Job ${/Tag (\d+)/.exec(tag)[1]}` });
  assert.equal(await shop.page.locator('.tag .code').innerHTML(), expected.replace(/<rect([^>]*)\/>/, '<rect$1></rect>').replace(/<path([^>]*)\/>/, '<path$1></path>'));
  // The price adds the extras: $110 + $40 + $35.
  assert.equal(app.server.book.job(key).cents, 18500);

  const customer = await device('customer', { javaScriptEnabled: false });
  await customer.page.goto(`${app.base}/t/${key}`);
  const page = await customer.page.locator('main').innerText();
  assert.match(page, /Deer processing[\s\S]*Received[\s\S]*Cutting[\s\S]*Wrapping[\s\S]*Ready for pickup[\s\S]*Picked up/);
  assert.match(page, /Balance due: \$185\.00/);
  assert.equal(await customer.page.getAttribute('job-progress li[aria-current=step]', 'class'), 'done now');
  await shop.context.close();
  await customer.context.close();
});

test('intake checks what it needs: a name, a phone for the text, each answer, a sensible deposit', async () => {
  const shop = await device('intake', { javaScriptEnabled: false, shift: true });
  const good = { name: 'June Harsh', phone: '304-555-0123', pose: 'Upright', deposit: '300' };
  const tries = [
    [{ ...good, name: '' }, 'Give the customer’s name.'],
    [{ ...good, phone: '555-0123' }, 'Give a phone number with its area code, for the ready text.'],
    [{ ...good, pose: 'Flying' }, 'Choose pose.'],
    [{ ...good, deposit: '900' }, 'The deposit is between $0 and $650.00.'],
  ];
  for (const [form, said] of tries) assert.equal((await shop.post('/shop/new/shoulder', form)).location, `/shop/new/shoulder?problem=${said}`);
  const { job } = await takeIn(shop, 'shoulder', good);
  assert.equal(job.deposit, 30000);
  assert.equal(job.balance, 35000);
  // An extra the kind doesn't have is ignored, not charged.
  const { job: odd } = await takeIn(shop, 'processing', { extras: 'Gold leaf' });
  assert.deepEqual(odd.answers.extras, []);
  assert.equal(odd.cents, 11000);
  await shop.context.close();
});

test('each job moves one stage at a time; ready sends the text, and the customer follows it live', async () => {
  const shop = await device('mover', { javaScriptEnabled: false, shift: true });
  const { key, job } = await takeIn(shop, 'european', { finish: 'Whitened', deposit: '50', email: 'kai@example.com' });
  const customer = await device('watcher');
  await customer.page.goto(`${app.base}/t/${key}`);
  await customer.page.waitForFunction(() => customElements.get('job-progress'));
  await customer.page.waitForTimeout(400); // the live stream open

  assert.equal((await advance(shop, key)).location, `/shop?done=Tag ${job.tag}: cleaning.`);
  await customer.page.locator('job-progress li[aria-current=step]', { hasText: 'Cleaning' }).waitFor({ timeout: 5000 });
  assert.equal((await advance(shop, key)).location, `/shop?done=Tag ${job.tag}: whitening.`);
  const before = app.server.book.board().notices.length;
  assert.equal((await advance(shop, key)).location, `/shop?done=Tag ${job.tag}: ready for pickup. The customer has been sent a text.`);
  await customer.page.locator('job-progress .ready').waitFor({ timeout: 5000 });

  // The text and the email: the first name, what, the tag, the balance and the link.
  const sent = app.server.book.board().notices.slice(0, app.server.book.board().notices.length - before);
  assert.deepEqual(sent.map((notice) => notice.channel).sort(), ['email', 'sms']);
  for (const notice of sent) assert.equal(notice.body, `Dale, your european mount (tag ${job.tag}) is ready for pickup at Backbone Mountain. Balance due: $100.00, at pickup or online. ${app.base}/t/${key}`);
  assert.equal(sent.find((notice) => notice.channel === 'sms').to, '(301) 555-0199');

  // Picking up needs the balance taken; then it's done, once.
  assert.equal((await advance(shop, key)).location, '/shop?problem=$100.00 is still due. Take it at the counter first.');
  assert.equal((await advance(shop, key, { paidAtCounter: 'yes' })).location, `/shop?done=Tag ${job.tag}: picked up.`);
  await customer.page.locator('job-progress li[aria-current=step]', { hasText: 'Picked up' }).waitFor({ timeout: 5000 });
  await customer.page.locator('job-progress', { hasText: 'Paid in full.' }).waitFor({ timeout: 5000 });
  assert.equal((await advance(shop, key)).location, '/shop?problem=That job has already been picked up.');
  assert.equal((await advance(shop, 'j0000000000000')).location, '/shop?problem=That isn’t one of our jobs.');
  await shop.context.close();
  await customer.context.close();
});

test('two shop tablets pressing the same button move a job one stage, not two', async () => {
  const a = await device('tablet a', { javaScriptEnabled: false, shift: true });
  const b = await device('tablet b', { javaScriptEnabled: false, shift: true });
  const { key } = await takeIn(a);
  const pressed = await Promise.all([a.post('/shop/advance', { key, to: 'cutting' }), b.post('/shop/advance', { key, to: 'cutting' })]);
  assert.equal(app.server.book.job(key).status, 'cutting');
  assert.deepEqual(pressed.map((answer) => answer.location.replace(/\d{4}/, 'N')).sort(), ['/shop?done=Tag N: cutting.', '/shop?problem=Tag N is already at cutting.']);
  await a.context.close();
  await b.context.close();
});

test('the customer pays the balance online, once; a declined card says so', async () => {
  const shop = await device('payer shop', { javaScriptEnabled: false, shift: true });
  const { key, job } = await takeIn(shop, 'shoulder', { name: 'Sam Teets', phone: '304-555-0111', pose: 'Semi-sneak' });
  for (let i = 0; i < 4; i++) await advance(shop, key);
  assert.equal(app.server.book.job(key).status, 'ready');
  const customer = await device('payer', { javaScriptEnabled: false });
  await customer.page.goto(`${app.base}/t/${key}`);
  await customer.page.click('job-progress a');
  await customer.page.waitForURL(`${app.base}/t/${key}/pay`);
  assert.match(await customer.page.locator('checkout-form').innerText(), /Balance, shoulder mount \(tag \d+\)[\s\S]*\$350\.00/);
  assert.equal((await customer.post(`/t/${key}/pay`, { checkout: key, name: 'Sam', email: 's@example.com', card: '4000 0000 0000 0002' })).location, `/t/${key}/pay?problem=That card was declined. Try another.`);
  assert.equal((await customer.post(`/t/${key}/pay`, { checkout: key, name: 'Sam', email: 's@example.com', card: '4242 4242 4242 4242' })).location, `/t/${key}?done=Paid. Thank you.`);
  assert.equal(app.server.book.job(key).balance, 0);
  assert.equal((await customer.post(`/t/${key}/pay`, { checkout: key, card: '4242' })).location, `/t/${key}/pay?problem=Nothing left to pay.`);
  // Paid online: picking up needs nothing more.
  assert.equal((await advance(shop, key)).location, `/shop?done=Tag ${job.tag}: picked up.`);
  // Someone who never opened the job can't pay it.
  const stranger = await device('stranger', { javaScriptEnabled: false });
  const { key: other } = await takeIn(shop);
  assert.equal((await stranger.post(`/t/${other}/pay`, { checkout: other, card: '4242' })).location, `/t/${other}/pay?problem=Open your job from its link first.`);
  await Promise.all([shop.context.close(), customer.context.close(), stranger.context.close()]);
});

test('a customer who lost the link finds the job by tag and phone; a wrong pair finds nothing', async () => {
  const shop = await device('finder shop', { javaScriptEnabled: false, shift: true });
  const { key, job } = await takeIn(shop, 'processing', { phone: '240-555-0177' });
  const customer = await device('finder', { javaScriptEnabled: false });
  assert.equal((await customer.post('/track', { tag: String(job.tag), phone: '0177' })).location, `/t/${key}`);
  assert.equal((await customer.post('/track', { tag: String(job.tag), phone: '0178' })).location, '/?problem=No job with that tag number and phone. Check the tag, or call the shop.');
  assert.equal((await customer.post('/track', { tag: String(job.tag), phone: '' })).location, '/?problem=No job with that tag number and phone. Check the tag, or call the shop.');
  assert.equal((await customer.context.request.get(`${app.base}/t/j0000000000000`)).status(), 404);
  await shop.context.close();
  await customer.context.close();
});

test('only a shop shift takes jobs in or moves them; a page reads only the jobs it opened', async () => {
  const shop = await device('scope shop', { javaScriptEnabled: false, shift: true });
  const { key: mine } = await takeIn(shop, 'processing', { name: 'Owner One' });
  const { key: theirs } = await takeIn(shop, 'processing', { name: 'Owner Two' });
  const outsider = await device('outsider', { javaScriptEnabled: false });
  assert.match(await outsider.get('/shop'), /<button type=\"submit\">Sign in<\/button>/);
  assert.equal((await outsider.post('/shop/new/processing', { name: 'X Y', phone: '3015550100', cuts: 'All ground' })).location, '/shop');
  assert.equal((await outsider.post('/shop/advance', { key: mine })).location, '/shop');
  assert.equal(app.server.book.job(mine).status, 'received');
  assert.equal((await outsider.post('/staff/sign-in', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);

  await outsider.page.goto(`${app.base}/t/${mine}`);
  const pull = async (scope = '') => {
    const all = [];
    for (let since = 0, i = 0; i < 100; i++) {
      const page = await (await outsider.context.request.get(`${app.base}/_zb/sync/pull?since=${encodeURIComponent(since)}${scope}`)).json();
      all.push(...(page.changes ?? []));
      if (!page.changes?.length || page.cursor === since) break;
      since = page.cursor;
    }
    return all;
  };
  const seen = await pull();
  assert.ok(seen.length > 0);
  assert.deepEqual([...new Set(seen.map((change) => `${change.collection}/${change.key}`))], [`jobs/${mine}`], 'only the job this browser opened');
  assert.ok(!seen.some((change) => change.key === theirs));
  assert.deepEqual(await pull(`&scope=${encodeURIComponent(JSON.stringify({ jobs: true, notices: true, access: true }))}`).then((all) => [...new Set(all.map((change) => change.key))]), [mine]);
  const push = await outsider.context.request.post(`${app.base}/_zb/sync/push`, {
    headers: { 'sec-fetch-site': 'same-origin' },
    data: { changes: [{ collection: 'jobs', key: mine, field: 'status', value: 'ready', clock: `${String(Date.now()).padStart(15, '0')}-00000-x` }] },
  });
  assert.equal(push.status(), 403);
  await shop.context.close();
  await outsider.context.close();
});

test('the shop’s board is live: a job taken in and one moved show without a reload, to staff only', async () => {
  const floor = await device('shop floor', { shift: true });
  await floor.page.goto(`${app.base}/shop`);
  await floor.page.waitForFunction(() => customElements.get('board-watch'));
  await floor.page.waitForTimeout(400);
  // The page is the same document throughout: a reload would lose this.
  await floor.page.evaluate(() => (window.sameDocument = true));
  const fresh = async () => Number(await floor.page.locator('.lane.placed h2 b').innerText());
  const before = await fresh();

  const counter = await device('front counter', { javaScriptEnabled: false, shift: true });
  const { key } = await takeIn(counter, 'processing', { name: 'Opal Livengood' });
  await floor.page.locator('.lane.placed .ticket', { hasText: 'Opal Livengood' }).waitFor({ timeout: 5000 });
  assert.equal(await fresh(), before + 1, 'the lane counts it');
  // The count in the sidebar follows too: it says what a fresh page would.
  const sideNow = /data-live="waiting-side">(?:<b[^>]*>(\d+)<\/b>)?/.exec(await floor.get('/shop'))?.[1] ?? '';
  await floor.page.waitForFunction((want) => (document.querySelector('[data-live="waiting-side"]')?.textContent ?? '') === want, sideNow, { timeout: 5000 });
  await floor.page.locator('board-watch [role=status]', { hasText: 'A new job came in.' }).waitFor({ timeout: 2000 });

  // The counter moves it on: the floor follows.
  await advance(counter, key);
  await floor.page.locator('.lane.bench .ticket', { hasText: 'Opal Livengood' }).waitFor({ timeout: 5000 });
  assert.equal(await floor.page.evaluate(() => window.sameDocument), true, 'never reloaded');

  // The swapped-in card still works: its button moves the job on.
  const was = app.server.book.job(key).status;
  await floor.page.locator('.lane.bench .ticket', { hasText: 'Opal Livengood' }).locator('button').click();
  await floor.page.waitForURL(/done=/);
  assert.notEqual(app.server.book.job(key).status, was);
  // Picked up: the job leaves the lanes and joins the list at the foot of the board, live.
  await floor.page.goto(`${app.base}/shop`);
  await floor.page.waitForFunction(() => customElements.get('board-watch'));
  await floor.page.waitForTimeout(400);
  for (let i = 0; i < 8 && app.server.book.job(key).status !== 'picked-up'; i++) await advance(counter, key, { paidAtCounter: 'yes' });
  assert.equal(app.server.book.job(key).status, 'picked-up');
  await floor.page.locator('[data-live=done]', { hasText: 'Opal Livengood' }).waitFor({ timeout: 5000 });

  // Staff are sent the board; a customer's page never is.
  const pull = async (who) => (await who.context.request.get(`${app.base}/_zb/sync/pull?since=0`)).text();
  const nosy = await device('nosy');
  assert.match(await pull(counter), /boards/, 'staff pull the board');
  assert.doesNotMatch(await pull(nosy), /boards/, 'a customer does not');
  await Promise.all([floor, counter, nosy].map((one) => one.context.close()));
});
