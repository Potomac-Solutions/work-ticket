// Work Ticket: drop off and track, on one small Node server.
//
// - The shop takes a job in at the counter and prints its tag (a number, and a code that opens
//   the customer's page). The customer follows the job's stages live, gets a text when it's
//   ready, and can pay the balance online.
// - Every form is a plain post to a route here, so it all works without JavaScript.
// - The deciding is the kit's (src/jobs.js): stages, notify, pay.
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { signedCookie } from '@potomac-solutions/kit/auth';
import { createStaff } from '@potomac-solutions/kit/staff';
import { staffPages } from '@potomac-solutions/kit/staff/pages';
import { createNotices } from '@potomac-solutions/kit/notice';
import { loadQr } from '@journey-to-code/symbology';
import { createJobs } from './src/jobs.js';
import { layout, escape } from './src/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'work-ticket.db'), cache = true, secret = process.env.SESSION_SECRET, now , staffCost } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'work-ticket-development-only';
  }
  const book = await createJobs({ db, now });
  const guests = signedCookie({ secret, name: 'guest' });
  book.identify((request) => guests.session(request));
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const qr = await loadQr();
  const { shop } = book;
  const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: shop.timeZone });

  // The people who run the shop: an owner and the staff they invite (the kit's staff module), in the
  // shop's own log; their pages and routes are the kit's too.
  const production = process.env.NODE_ENV === 'production';
  const staff = createStaff({ store: book.store, secure: production, ...(staffCost ? { cost: staffCost } : {}) });
  // A message in an address shows only if the server signed it (kit/notice), so a link can't put
  // its own words in a page's alert.
  const notices = createNotices({ secret });
  const pages = staffPages({ staff, notices, proxies: Number(process.env.TRUST_PROXIES ?? 0), home: '/shop', business: shop.name, secure: production, render: (res, title, body) => page(res, zubra.page(), title, body) });
  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body) => send(res, 200, p.finish(layout({ title, shop, body })));
  const note = (url) => {
    const problem = notices.read(url).problem;
    const done = notices.read(url).done;
    return `${problem ? `<p class="notice" role="alert">${escape(problem)}</p>` : ''}${done ? `<p class="ok" role="status">${escape(done)}</p>` : ''}`;
  };
  const withProblem = (path, answer) => `${path}?problem=${encodeURIComponent(answer.error)}`;
  /** Where this server is reached, for links in texts and on tags. */
  const origin = (req) => `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8000) return null;
    }
    return new URLSearchParams(body);
  }
  const answersOf = (job) =>
    job.kind.questions
      .map((question) => [question.label, Array.isArray(job.answers[question.id]) ? job.answers[question.id].join(', ') || 'None' : job.answers[question.id]])
      .map(([label, answer]) => `<dt>${escape(label)}</dt><dd>${escape(answer)}</dd>`)
      .join('');

  function home(url) {
    return `<section><h1>Track your job</h1><p class="lede">${escape(shop.hours)}. Your tag has a code that opens your job; or give the tag number and your phone.</p></section>
${note(url)}
<form class="panel" method="post" action="/track"><h2>Find your job</h2>
  <label>Tag number<input name="tag" inputmode="numeric" autocomplete="off" required></label>
  <label>Last four digits of your phone<input name="phone" inputmode="numeric" autocomplete="off" maxlength="4" required></label>
  <button type="submit">Find it</button></form>
<section><h2>What we do</h2><ul class="fleets">${book.kinds.map((kind) => `<li class="fleet"><h2>${escape(kind.name)}</h2><p>${escape(kind.blurb)}</p><p class="price">From ${money(kind.cents)} · ${escape(kind.turnaround)}</p></li>`).join('')}</ul></section>`;
  }

  function jobPage(p, url, job) {
    return `<section><p class="lede">Tag ${job.tag} · dropped off ${day(job.received)}</p><h1>${escape(job.kind.name)}</h1><p class="lede">For ${escape(job.name)}. ${escape(job.kind.turnaround)}, start to finish.</p></section>
${note(url)}
${p.render('job-progress', { job: job.key, steps: job.kind.stages, names: Object.fromEntries(job.kind.stages.map((stage) => [stage, book.stageName(stage)])), statusNow: job.status, paidNow: job.paid ?? 0, cents: job.cents, deposit: job.deposit, pay: `/t/${job.key}/pay` })}
<section class="panel"><h2>The job</h2><dl class="facts">${answersOf(job)}<dt>Price</dt><dd>${money(job.cents)}</dd><dt>Deposit</dt><dd>${money(job.deposit)}</dd></dl></section>`;
  }

  function payPage(p, url, job) {
    const cart = { lines: [{ item: job.key, qty: 1, name: `Balance, ${job.kind.name.toLowerCase()} (tag ${job.tag})`, total: job.balance }], cents: job.balance, ready: job.balance > 0 };
    return `<section><a href="/t/${job.key}">Back to your job</a><h1>Pay the balance</h1><p class="lede">Tag ${job.tag}. Pay now and pickup is quicker.</p></section>
${p.render('checkout-form', { cart, place: `/t/${job.key}/pay`, checkout: job.key, problem: notices.read(url).problem, testMode: true, name: job.name, email: job.email ?? '', phone: job.phone ?? '' })}`;
  }

  function board(url) {
    const { open, done, notices } = book.board();
    const card = (job) => {
      const next = job.kind.stages[job.kind.stages.indexOf(job.status) + 1];
      const owed = next === 'picked-up' && job.balance > 0;
      return `<li class="job"><p><strong>Tag ${job.tag}</strong> · ${escape(job.kind.name)}</p><p>${escape(job.name)} · ${escape(job.phone)}</p><p class="stage">${escape(book.stageName(job.status))}${job.balance ? ` · ${money(job.balance)} due` : ' · paid'}</p>
<form method="post" action="/shop/advance"><input type="hidden" name="key" value="${job.key}"><input type="hidden" name="to" value="${next}">${owed ? `<label class="check"><input type="checkbox" name="paidAtCounter" value="yes"> ${money(job.balance)} taken at the counter</label>` : ''}<button type="submit">${escape(book.stageName(next))}</button></form>
<a href="/shop/tag/${job.key}">Tag</a></li>`;
    };
    return `<section><h1>The shop</h1><p class="lede">Move each job along; customers see it on their phones, and get a text when it’s ready.</p></section>
${note(url)}
<section class="panel"><h2>Take a job in</h2><p>${book.kinds.map((kind) => `<a class="button light" href="/shop/new/${kind.id}">${escape(kind.name)}</a>`).join(' ')}</p></section>
<section><h2>In the shop</h2>${open.length ? `<ul class="jobs">${open.map(card).join('')}</ul>` : '<p>Nothing in the shop.</p>'}</section>
${notices.length ? `<section class="panel"><h2>Texts sent (test mode: kept here, not sent)</h2><ul>${notices.map((notice) => `<li><small>${escape(notice.channel)} to ${escape(notice.to)}</small><br>${escape(notice.body)}</li>`).join('')}</ul></section>` : ''}
${done.length ? `<section class="panel"><h2>Picked up</h2><ul>${done.map((job) => `<li>Tag ${job.tag} · ${escape(job.kind.name)} · ${escape(job.name)}</li>`).join('')}</ul></section>` : ''}`;
  }

  function intakeForm(url, kind) {
    const question = (q) =>
      q.many
        ? `<fieldset class="choices"><legend>${escape(q.label)}</legend>${q.choices.map(([label, cents]) => `<label class="check"><input type="checkbox" name="${q.id}" value="${escape(label)}"> ${escape(label)} (+${money(cents)})</label>`).join('')}</fieldset>`
        : `<label>${escape(q.label)}<select name="${q.id}" required><option value="">Choose…</option>${q.choices.map((choice) => `<option>${escape(choice)}</option>`).join('')}</select></label>`;
    return `<section><a href="/shop">Back to the shop</a><h1>${escape(kind.name)}</h1><p class="lede">${money(kind.cents)} before extras. ${escape(kind.turnaround)}.</p></section>
${note(url)}
<form class="panel" method="post" action="/shop/new/${kind.id}">
  <label>Customer’s name<input name="name" autocomplete="off" required></label>
  <label>Phone, for the ready text<input name="phone" type="tel" autocomplete="off" required></label>
  <label>Email (optional)<input name="email" type="email" autocomplete="off"></label>
  ${kind.questions.map(question).join('')}
  <label>Notes<textarea name="notes" rows="2"></textarea></label>
  <label>Deposit taken today, in dollars<input name="deposit" inputmode="decimal" value="${(kind.deposit / 100).toFixed(2)}"></label>
  <button type="submit">Take it in and print the tag</button>
</form>`;
  }

  function tag(job, req) {
    const link = `${origin(req)}/t/${job.key}`;
    return `<section class="tag"><p class="lede">${escape(shop.name)} · ${escape(shop.phone)}</p><h1>Tag ${job.tag}</h1>
<p><strong>${escape(job.name)}</strong> · ${escape(job.kind.name)} · dropped off ${day(job.received)}</p>
<dl class="facts">${answersOf(job)}</dl>
<div class="code">${qr.svg(qr.encode(link), { title: `Job ${job.tag}` })}</div>
<p>Scan to follow this job, or go to ${escape(origin(req))} with tag ${job.tag} and your phone.</p>
<p><a href="/shop">Back to the shop</a> · <a href="/t/${job.key}">The customer’s page</a></p></section>`;
  }

  const server = createServer(async (req, res) => {
    try {
      if (await book.sync.handle(req, res)) return;
      if (zubra.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
      const guest = guests.ensure(req, res);
      const who = staff.session(req);
      const onShift = staff.can(who, 'staff');

      if (req.method === 'POST') {
        // Every form is ours: another site's post is refused (the cookies are SameSite=Lax too).
        if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'Forbidden');
        const form = await readForm(req);
        if (!form) return send(res, 413, 'Too large');
        if (url.pathname === '/track') {
          const done = await book.find(guest, form);
          return back(res, done.ok ? `/t/${done.key}` : withProblem('/', done));
        }
        const paying = url.pathname.match(/^\/t\/(j[a-z0-9]+)\/pay$/);
        if (paying) {
          const done = await book.payBalance(guest, paying[1], form);
          return back(res, done.ok ? `/t/${paying[1]}?done=${encodeURIComponent('Paid. Thank you.')}` : withProblem(`/t/${paying[1]}/pay`, done));
        }
        // Sign-in, links, people and passwords.
        if (await pages.handle(req, res, url, form)) return;
        if (url.pathname.startsWith('/shop/') && !onShift) return back(res, '/shop');
        const taking = url.pathname.match(/^\/shop\/new\/([a-z]+)$/);
        const kind = taking && book.kind(taking[1]);
        if (kind) {
          const done = await book.intake(kind, form);
          return back(res, done.ok ? `/shop/tag/${done.key}` : withProblem(`/shop/new/${kind.id}`, done));
        }
        if (url.pathname === '/shop/advance') {
          const done = await book.advance(String(form.get('key') ?? ''), { to: String(form.get('to') ?? ''), link: origin(req), paidAtCounter: form.get('paidAtCounter') === 'yes' });
          if (!done.ok) return back(res, withProblem('/shop', done));
          const said = `Tag ${done.job.tag}: ${book.stageName(done.to).toLowerCase()}.${done.notified ? ' The customer has been sent a text.' : ''}`;
          return back(res, `/shop?done=${encodeURIComponent(said)}`);
        }
        return send(res, 404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      if (await pages.handle(req, res, url, null)) return;
      const p = zubra.page();
      if (url.pathname === '/') return page(res, p, 'Track your job', home(url));
      const tracking = url.pathname.match(/^\/t\/(j[a-z0-9]+)(\/pay)?$/);
      if (tracking) {
        const job = await book.open(guest, tracking[1]);
        if (!job) return send(res, 404, 'No such job');
        if (tracking[2]) return job.balance > 0 ? page(res, p, 'Pay the balance', payPage(p, url, job)) : back(res, `/t/${job.key}`);
        return page(res, p, `Tag ${job.tag}`, jobPage(p, url, job));
      }
      if (url.pathname === '/shop' || url.pathname.startsWith('/shop/')) {
        if (!onShift) return page(res, p, 'Sign in', pages.signIn(url));
        if (url.pathname === '/shop') return page(res, p, 'The shop', pages.bar(who) + board(url));
        const taking = url.pathname.match(/^\/shop\/new\/([a-z]+)$/);
        const kind = taking && book.kind(taking[1]);
        if (kind) return page(res, p, `New: ${kind.name}`, intakeForm(url, kind));
        const tagging = url.pathname.match(/^\/shop\/tag\/(j[a-z0-9]+)$/);
        const job = tagging && book.job(tagging[1]);
        if (job) return page(res, p, `Tag ${job.tag}`, tag(job, req));
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });
  return Object.assign(server, { book, staff });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  if (server.staff.needsOwner()) console.log(`Set up the first owner (works once, for a day): http://localhost:${port}/staff/accept?token=${await server.staff.setup()}`);
  server.listen(port, '0.0.0.0', () => console.log(`Work Ticket on http://localhost:${port}`));
}
