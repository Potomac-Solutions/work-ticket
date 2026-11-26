// The admin, customer accounts and reports, over plain HTTP (no browser needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const COST = { N: 2 ** 10, r: 8, p: 1 };
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
const STAFF = { email: 'hand@example.com', name: 'Shop Hand', password: 'shop hand password' };
const dir = mkdtempSync(join(tmpdir(), 'work-ticket-admin-'));
let server;
let base;

before(async () => {
  server = await createApp({ staffCost: COST, db: join(dir, 'shop.db'), cache: false, secret: 'test-only-secret-that-is-long-enough-1234' });
  await server.staff.accept(await server.staff.setup(), OWNER);
  const owner = server.staff.list().find((one) => one.email === OWNER.email);
  await server.staff.accept((await server.staff.invite(owner, { email: STAFF.email, name: STAFF.name, roles: ['staff'] })).token, STAFF);
  await new Promise((done) => server.listen(0, done));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

function browser() {
  const jar = new Map();
  const remember = (response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
      else jar.delete(pair.slice(0, at));
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const where = (response) => decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
  return {
    async get(path) {
      const response = remember(await fetch(`${base}${path}`, { headers: { cookie: cookie() }, redirect: 'manual' }));
      return { status: response.status, type: response.headers.get('content-type'), location: where(response), text: await response.text() };
    },
    async post(path, form) {
      const response = remember(await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), redirect: 'manual' }));
      const answer = { status: response.status, location: where(response), text: await response.text() };
      if (!answer.location.startsWith('/pay/test')) return answer;
      // The test payment page, standing in for Helcim's: "Pay", then the way back.
      const ref = new URL(answer.location, base).searchParams.get('ref');
      const back = new URL((await this.post('/pay/test', { ref, answer: 'pay' })).location);
      return this.get(back.pathname + back.search);
    },
  };
}
async function signInStaff(who) {
  const b = browser();
  await b.get('/');
  assert.equal((await b.post('/staff/sign-in', { email: who.email, password: who.password })).location, '/admin');
  return b;
}
/** The shop takes a job in: its key and tag. */
async function takeIn(hand, { name = 'Pat Quill', phone = '301-555-0101', email = '' } = {}) {
  const taken = await hand.post('/shop/new/processing', { name, phone, email, cuts: 'All ground', extras: 'Jerky', deposit: '0' });
  const key = /^\/shop\/tag\/(j[a-z0-9]+)$/.exec(taken.location)?.[1];
  assert.ok(key, taken.location);
  return { key, tag: server.book.job(key).tag };
}

test('the landing page leads with the shop, then finding a job; no admin link for a guest', async () => {
  const page = (await browser().get('/')).text;
  assert.match(page, /class="hero"[\s\S]*Track your job[\s\S]*id="track"[\s\S]*What we do[\s\S]*How it works/);
  assert.ok(!page.includes('>Admin</a>'));
});

test('a job taken in under an account’s email joins it; a job opened while signed in does too', async () => {
  const phone = browser();
  await phone.get('/');
  assert.equal((await phone.post('/account/sign-up', { name: 'Pat Quill', email: 'pat@example.com', password: 'pat quill password' })).location, '/account?done=Welcome. Your account is ready.');
  const hand = await signInStaff(STAFF);
  const byEmail = await takeIn(hand, { email: 'PAT@example.com' });
  assert.match((await phone.get('/account')).text, new RegExp(`In the shop[\\s\\S]*/t/${byEmail.key}`));
  const other = await takeIn(hand, { name: 'Pat Quill', phone: '301-555-0101' });
  assert.ok(!(await phone.get('/account')).text.includes(other.key), 'a job without the email isn’t theirs yet');
  assert.equal((await phone.post('/track', { tag: String(other.tag), phone: '0101' })).location, `/t/${other.key}`);
  await phone.get(`/t/${other.key}`);
  assert.match((await phone.get('/account')).text, new RegExp(`/t/${other.key}`), 'opened signed in: it joins');

  // Another device, signed in, may read and pay for both.
  const laptop = browser();
  await laptop.get('/');
  assert.match((await laptop.post(`/t/${byEmail.key}/pay`, { card: '4242 4242 4242 4242' })).location, /Open your job/);
  await laptop.post('/account/sign-in', { email: 'pat@example.com', password: 'pat quill password' });
  assert.match((await laptop.post(`/t/${byEmail.key}/pay`, { card: '4242 4242 4242 4242' })).location, /Paid/);
  assert.equal(server.book.job(byEmail.key).balance, 0);
});

test('a forgotten password: the same page either way, and the emailed link works once', async () => {
  const b = browser();
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Lee Forgets', email: 'lee@example.com', password: 'lee first password' });
  const nobody = (await b.post('/account/forgot', { email: 'nobody@example.com' })).text.match(/<main[\s\S]*<\/main>/)[0];
  const lee = (await b.post('/account/forgot', { email: 'lee@example.com' })).text.match(/<main[\s\S]*<\/main>/)[0];
  assert.equal(nobody, lee);
  const token = /\/account\/reset\?token=([\w-]{43})/.exec(server.book.notices()[0].body)[1];
  assert.equal((await b.post('/account/reset', { token, password: 'lee second password' })).location, '/account?done=Your new password is saved.');
  assert.match((await b.post('/account/reset', { token, password: 'lee third password' })).text, /expired/);
});

test('the admin is for staff; reports, settings and the outbox for owners', async () => {
  const guest = browser();
  await guest.get('/');
  for (const path of ['/admin', '/admin/jobs', '/admin/reports', '/admin/jobs.csv']) {
    const page = await guest.get(path);
    assert.ok(!/Overview|text\/csv/.test(`${page.text}${page.type}`), path);
  }
  assert.equal((await guest.post('/admin/settings/kind/processing', { cents: '1', deposit: '0', blurb: 'x', turnaround: 'x' })).location, '/admin');
  const hand = await signInStaff(STAFF);
  assert.match((await hand.get('/admin')).text, /Overview[\s\S]*Ready for pickup/);
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await hand.get(path)).status, 403, path);
  await hand.post('/admin/settings/kind/processing', { cents: '1', deposit: '0', blurb: 'x', turnaround: 'x' });
  assert.equal(server.book.kind('processing').cents, 11000);
  const owner = await signInStaff(OWNER);
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await owner.get(path)).status, 200, path);
});

test('staff find a job and move it along from its page; ready texts the customer; pickup needs the balance', async () => {
  const hand = await signInStaff(STAFF);
  const { key, tag } = await takeIn(hand, { name: 'Sam Finder', phone: '301-555-0177' });
  const found = (await hand.get(`/admin/jobs?q=${tag}`)).text;
  assert.match(found, new RegExp(`/admin/jobs/${key}`));
  for (const to of ['cutting', 'wrapping', 'ready']) assert.match((await hand.post(`/admin/jobs/${key}/advance`, { to })).location, /^\/admin\/jobs\/j[a-z0-9]+\?done=Now/);
  assert.match((await hand.post(`/admin/jobs/${key}/advance`, { to: 'ready' })).location, /already picked up|already at/);
  assert.match(server.book.notices().find((one) => one.to === '301-555-0177').body, /Sam, your deer processing \(tag \d+\) is ready/);
  assert.match((await hand.post(`/admin/jobs/${key}/advance`, { to: 'picked-up' })).location, /still due/);
  assert.match((await hand.post(`/admin/jobs/${key}/advance`, { to: 'picked-up', paidAtCounter: 'yes' })).location, /Now picked up/);
  assert.match((await hand.get('/admin')).text, new RegExp(`Shop Hand</strong> moved tag ${tag} to picked up`));
});

test('an owner changes a price: new jobs use it, jobs already in keep theirs', async () => {
  const owner = await signInStaff(OWNER);
  const before = await takeIn(owner);
  assert.match((await owner.post('/admin/settings/kind/processing', { cents: '120', deposit: '200', blurb: 'Cut and wrapped.', turnaround: 'A week' })).location, /deposit/);
  assert.equal((await owner.post('/admin/settings/kind/processing', { cents: '125', deposit: '20', blurb: 'Cut and wrapped.', turnaround: 'A week' })).location, '/admin/settings?done=Saved. New jobs use it now.');
  assert.match((await browser().get('/')).text, /Cut and wrapped\.[\s\S]*From \$125\.00 · A week/);
  const after = await takeIn(owner);
  assert.equal(server.book.job(after.key).cents, 12500 + 3500);
  assert.equal(server.book.job(before.key).cents, 11000 + 3500);
  await owner.post('/admin/settings/kind/processing', { cents: '110', deposit: '0', blurb: 'Skinned, cut, wrapped and frozen, labelled by cut.', turnaround: 'About a week' });
});

test('reports and CSV: what was taken in adds up, and a name can’t become a formula', async () => {
  const owner = await signInStaff(OWNER);
  await takeIn(owner, { name: '=HYPERLINK("http://evil.example")' });
  const total = server.book.allJobs().reduce((sum, job) => sum + job.cents, 0);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: total % 100 ? 2 : 0 }).format(total / 100);
  assert.ok((await owner.get('/admin/reports?range=30d')).text.includes(`Taken in</span><strong>${money}</strong>`), money);
  const rows = (await owner.get('/admin/reports.csv?range=30d')).text.trim().split('\r\n');
  assert.equal(rows[0], 'Day,Jobs,Taken in (USD)');
  assert.equal(Math.round(rows.slice(1).reduce((sum, row) => sum + Number(row.split(',')[2]), 0) * 100), total);
  assert.match((await owner.get('/admin/jobs.csv?where=all')).text, /"'=HYPERLINK\(""http:\/\/evil\.example""\)"/);
});

test('an owner turns a customer off; staff can’t turn them back on', async () => {
  const b = browser();
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Off Switch', email: 'off@example.com', password: 'off switch password' });
  const id = server.customers.list().find((c) => c.email === 'off@example.com').customer;
  const owner = await signInStaff(OWNER);
  assert.match((await owner.post(`/admin/customers/${id}/disabled`, { disabled: 'yes' })).location, /Turned off/);
  assert.equal((await b.get('/account')).location, '/account/sign-in');
  const hand = await signInStaff(STAFF);
  await hand.post(`/admin/customers/${id}/disabled`, { disabled: 'no' });
  assert.equal(server.customers.get(id).disabled, true);
});
