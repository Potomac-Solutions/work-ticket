// The public demo (DEMO=1): the sign-ins are shown, and nobody can change them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { DEMO, nightly } from '../src/demo.js';

const COST = { N: 2 ** 10, r: 8, p: 1 };
const dir = mkdtempSync(join(tmpdir(), 'work-ticket-demo-'));
let server;
let base;
let owner;
let hand;
let guest;

before(async () => {
  server = await createApp({ staffCost: COST, db: join(dir, 'shop.db'), cache: false, secret: 'test-secret-of-at-least-thirty-two-characters', demo: true });
  await server.staff.accept(await server.staff.setup(), DEMO.owner);
  owner = server.staff.list().find((one) => one.email === DEMO.owner.email);
  await server.staff.accept((await server.staff.invite(owner, { email: DEMO.staff.email, name: DEMO.staff.name, roles: ['staff'] })).token, DEMO.staff);
  hand = server.staff.list().find((one) => one.email === DEMO.staff.email);
  guest = (await server.customers.signUp(DEMO.customer)).customer;
  await new Promise((done) => server.listen(0, done));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

test('the sign-in pages show the demo sign-ins', async () => {
  const staffPage = await (await fetch(`${base}/admin`)).text();
  for (const shown of [DEMO.owner.email, DEMO.owner.password, DEMO.staff.email, DEMO.staff.password, 'cleared overnight']) assert.ok(staffPage.includes(shown), shown);
  const guestPage = await (await fetch(`${base}/account/sign-in`)).text();
  for (const shown of [DEMO.customer.email, DEMO.customer.password]) assert.ok(guestPage.includes(shown), shown);
});

test('nobody can change a demo staff account', async () => {
  const who = server.staff.list().find((one) => one.account === owner.account);
  assert.match((await server.staff.changePassword(who, DEMO.owner.password, 'a brand new password')).error, /demo accounts/);
  assert.match((await server.staff.setDisabled(owner, hand.account, true)).error, /demo accounts/);
  assert.match((await server.staff.setRoles(owner, hand.account, ['owner'])).error, /demo accounts/);
  assert.match((await server.staff.resetLink(owner, hand.account)).error, /demo accounts/);
  assert.equal(await server.staff.endSessions(owner.account), 0);
  assert.ok((await server.staff.signIn(DEMO.owner.email, DEMO.owner.password)).ok, 'the password still works');
});

test('other staff can still be changed', async () => {
  await server.staff.accept((await server.staff.invite(owner, { email: 'new@example.com', name: 'New Hand', roles: ['staff'] })).token, { email: 'new@example.com', name: 'New Hand', password: 'new hand password' });
  const added = server.staff.list().find((one) => one.email === 'new@example.com');
  assert.ok((await server.staff.setDisabled(owner, added.account, true)).ok);
});

test('nobody can change the demo customer', async () => {
  assert.equal(await server.customers.resetToken(DEMO.customer.email), null, 'no reset link, as for an unknown email');
  assert.match((await server.customers.rename(guest, 'Someone Else')).error, /demo accounts/);
  assert.match((await server.customers.setDisabled(guest, true)).error, /demo accounts/);
  assert.ok((await server.customers.signIn(DEMO.customer.email, DEMO.customer.password)).ok);
  const other = (await server.customers.signUp({ email: 'other@example.com', name: 'Other Guest', password: 'other guest password' })).customer;
  assert.ok((await server.customers.setDisabled(other, true)).ok, 'other customers can still be turned off');
});

test('the demo exits once a day at the reset hour, never in its first hour', () => {
  let exits = 0;
  let at = Date.parse('2026-11-23T08:30:00Z'); // 3:30 am in New York
  const reset = nightly({ now: () => at, exit: () => { exits += 1; }, log: () => {} });
  reset.stop();
  at += 45 * 60_000; // 4:15 am, but only 45 minutes in
  assert.equal(reset.check(), false);
  at += 60 * 60_000; // 5:15 am
  assert.equal(reset.check(), false);
  at += 23 * 60 * 60_000; // 4:15 am the next day
  assert.equal(reset.check(), true);
  assert.equal(exits, 1);
});

test('without DEMO, the sign-in page shows no demo sign-ins', async () => {
  const plain = await createApp({ staffCost: COST, db: join(dir, 'plain.db'), cache: false, secret: 'test-secret-of-at-least-thirty-two-characters' });
  await new Promise((done) => plain.listen(0, done));
  const page = await (await fetch(`http://localhost:${plain.address().port}/account/sign-in`)).text();
  plain.closeAllConnections?.();
  await new Promise((done) => plain.close(done));
  assert.ok(!page.includes(DEMO.customer.password));
});
