// Paying the balance on Helcim: HelcimPay.js, a frame on a page of the studio's own, once
// Helcim's token is on the server (the kit's test page until then). Helcim is faked here (its
// calls and its hash check are the kit's, tested there); the page, the post back and the
// check are real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { served } from './http-client.js';

const dir = mkdtempSync(join(tmpdir(), 'work-ticket-pay-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const COST = { N: 2 ** 10, r: 8, p: 1 };
const SECRET = 'test-only-secret-that-is-long-enough-1234';
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };

test('the balance on Helcim: its frame on our page, and paid only when Helcim’s signed answer checks out', async () => {
  const initialized = [];
  const helcim = async (url, init = {}) => {
    if (new URL(url).pathname === '/v2/helcim-pay/initialize') {
      initialized.push(JSON.parse(String(init.body)));
      return Response.json({ checkoutToken: 'chk_1', secretToken: 'sec_1' });
    }
    return new Response('{}', { status: 404 });
  };
  const server = await createApp({ staffCost: COST, db: join(dir, 'helcim.db'), cache: false, secret: SECRET, payEnv: { PAY_HELCIM_TOKEN: 'api_token' }, payFetch: helcim });
  await server.staff.accept(await server.staff.setup(), OWNER);
  const shop = await served(server);
  try {
    assert.equal(server.payments.name, 'helcim');
    await shop.post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
    const made = await shop.post('/shop/new/shoulder', { name: 'Sam Teets', phone: '304-555-0111', pose: 'Semi-sneak' });
    const key = /^\/shop\/tag\/(j[a-z0-9]+)$/.exec(made.location)[1];
    const customer = await served(server);
    await customer.call(`/t/${key}`);
    const balance = server.book.job(key).balance;
    assert.match((await customer.call(`/t/${key}/pay`)).text, /You’ll pay on Helcim’s secure page next/);

    const page = await customer.post(`/t/${key}/pay`, { checkout: key, name: 'Sam', email: 's@example.com' });
    assert.equal(page.status, 200, 'the frame page, not a redirect');
    assert.match(page.headers.get('content-security-policy'), /script-src 'nonce-[\w+/=]+' https:\/\/secure\.helcim\.app; .*frame-src https:\/\/secure\.helcim\.app/);
    assert.match(page.text, /<script nonce="[\w+/=]+" src="https:\/\/secure\.helcim\.app\/helcim-pay\/services\/start\.js"><\/script>/);
    assert.match(page.text, /name="job" value="j[a-z0-9]+"/);
    assert.deepEqual(initialized[0], { paymentType: 'purchase', amount: balance / 100, currency: 'USD' });

    // What Helcim's frame tells the page, posted back: forged first, then signed with the secret.
    const data = { status: 'APPROVED', amount: (balance / 100).toFixed(2), currency: 'USD', transactionId: 'T1' };
    const forged = await customer.post('/pay/told', { job: key, ref: 'chk_1', told: JSON.stringify({ data, hash: 'nope' }) });
    assert.match(forged.location, /^\/t\/j[a-z0-9]+\/pay\?problem=/);
    assert.equal(server.book.job(key).balance, balance, 'nothing believed without Helcim’s hash');
    const hash = createHash('sha256').update(JSON.stringify(data) + 'sec_1').digest('hex');
    const told = await customer.post('/pay/told', { job: key, ref: 'chk_1', told: JSON.stringify({ data, hash }) });
    assert.equal(told.location, `/t/${key}?done=Paid. Thank you.`);
    assert.equal(server.book.job(key).balance, 0);
    assert.equal((await customer.post('/pay/told', { job: key, ref: 'chk_1', told: JSON.stringify({ data, hash }) })).location, `/t/${key}?done=Paid. Thank you.`, 'sent twice: paid once');
    assert.equal(server.book.job(key).paid, server.book.job(key).cents - server.book.job(key).deposit);
  } finally {
    await shop.close();
  }
});
