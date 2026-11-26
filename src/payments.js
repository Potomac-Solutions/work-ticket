// Paying on a payment platform's own page (2026-11-26): the card is typed on Stripe's, Square's,
// PayPal's or Helcim's page, never here. PAY_PROVIDER names the platform, and each reads its own
// settings (PAY_SQUARE_TOKEN and so on, in the README). Until they're all there, the kit's test
// page stands in, plainly marked as a test, so the trip there and back is the real one.
//
// This file is the same in each Potomac demo app; `intended` is the one this app shows off.
import { randomBytes } from 'node:crypto';
import { testProvider } from '@potomac-solutions/kit/pay';
import { choosePlatform, framePage, frameSources, PLATFORM_NAMES, testPage } from '@potomac-solutions/kit/pay/providers';

const MAX_WEBHOOK = 256 * 1024;

export function createPayments({ env = process.env, intended = '', fetch } = {}) {
  const test = testProvider({ page: '/pay/test' });
  const chosen = choosePlatform({ ...env, PAY_PROVIDER: env.PAY_PROVIDER || intended }, { test, ...(fetch ? { fetch } : {}) });
  const asked = chosen.asked || intended;
  const where = PLATFORM_NAMES[chosen.name] ?? chosen.name;
  return {
    provider: chosen.provider,
    test,
    /** What's in use ('test' until the intended platform is set up), and what was intended. */
    name: chosen.name,
    asked,
    sandbox: chosen.sandbox,
    /** For the kit's checkout-form: `platform` and `test-mode`. */
    form: { platform: chosen.name, testMode: chosen.sandbox },
    /** A line for the page, saying where the customer pays. */
    line:
      chosen.name === 'test'
        ? `You’ll pay on a test payment page: no money moves.${PLATFORM_NAMES[asked] && asked !== 'test' ? ` Once ${PLATFORM_NAMES[asked]} is set up, it’s ${PLATFORM_NAMES[asked]}’s own page.` : ''}`
        : `You’ll pay on ${where}’s secure page${chosen.sandbox ? ', in its test mode: no money moves' : ''}. We never see your card number.`,

    /**
     * Send the customer on to what `start` answered: a redirect for a page, or the frame's page
     * (Helcim), which posts to `told` when it's done. `cancel` is where "go back" goes.
     */
    send(res, started, { told = '/pay/told', cancel = '/', fields = {} } = {}) {
      if (started.url) return res.writeHead(303, { location: started.url, 'cache-control': 'no-store' }).end();
      const nonce = randomBytes(16).toString('base64');
      const html = framePage(started.frame, { ref: started.ref, settle: told, cancel, fields, title: 'Pay', nonce });
      const { script, frame } = frameSources(started.frame);
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'self'; script-src 'nonce-${nonce}' ${script.join(' ')}; style-src 'self' 'nonce-${nonce}'; frame-src ${frame.join(' ') || "'none'"}; form-action 'self'`,
      });
      return res.end(html);
    },

    /**
     * The test page: GET shows it, POST "Pay" marks it paid and goes back. Answers true when
     * it handled the request. Only while the test page is what's in use.
     */
    async testRoute(req, res, url, readForm) {
      if (url.pathname !== '/pay/test' || chosen.name !== 'test') return false;
      const ref = url.searchParams.get('ref') ?? '';
      if (req.method === 'POST') {
        const form = await readForm(req);
        const done = String(form?.get('ref') ?? '');
        const shown = test.pageFor(done);
        if (!shown) return res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'), true;
        if (form.get('answer') === 'pay') test.approve(done);
        return res.writeHead(303, { location: shown.back }).end(), true;
      }
      const shown = test.pageFor(ref);
      if (!shown) return res.writeHead(404, { 'content-type': 'text/plain' }).end('That payment page has expired. Go back and try again.'), true;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
      return res.end(testPage(shown, { ref, action: '/pay/test', instead: asked })), true;
    },

    /** A webhook's request as the kit reads it: the raw body, the headers and the address. */
    async webhook(req, publicUrl) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_WEBHOOK) return null;
      }
      return { headers: Object.fromEntries(Object.entries(req.headers).map(([name, value]) => [name.toLowerCase(), String(value)])), body, url: `${publicUrl}${req.url}` };
    },
  };
}
