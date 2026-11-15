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
import { staffPages, clientAddress } from '@potomac-solutions/kit/staff/pages';
import { createCustomers } from '@potomac-solutions/kit/customers';
import * as accountPages from './src/account.js';
import { createAdmin } from './src/admin.js';
import { createNotices } from '@potomac-solutions/kit/notice';
import { loadQr } from '@journey-to-code/symbology';
import { createJobs } from './src/jobs.js';
import { layout, escape } from './src/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'work-ticket.db'), cache = true, secret = process.env.SESSION_SECRET, now = Date.now, staffCost } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'work-ticket-development-only';
  }
  const book = await createJobs({ db, now });
  const guests = signedCookie({ secret, name: 'guest' });
  const production = process.env.NODE_ENV === 'production';
  // Customers who make an account (kit/customers), in the shop's own log.
  const customers = createCustomers({ store: book.store, secure: production, now, ...(staffCost ? { cost: staffCost } : {}) });
  // A page follows the jobs its browser opened and, signed in, its account's.
  book.identify((request) => {
    const guest = guests.session(request);
    return guest ? { ...guest, customer: customers.session(request)?.customer } : null;
  });
  // A job taken in under an account's email joins that account.
  book.accountsBy((email) => customers.list().find((one) => one.email === email && !one.disabled)?.customer);
  const proxies = Number(process.env.TRUST_PROXIES ?? 0);
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const qr = await loadQr();
  const { shop } = book;
  const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: shop.timeZone });

  // The people who run the shop: an owner and the staff they invite (the kit's staff module), in the
  // shop's own log; their pages and routes are the kit's too.
  const staff = createStaff({ store: book.store, secure: production, ...(staffCost ? { cost: staffCost } : {}) });
  // A message in an address shows only if the server signed it (kit/notice), so a link can't put
  // its own words in a page's alert.
  const notices = createNotices({ secret });
  const pages = staffPages({ staff, notices, proxies, home: '/admin', business: shop.name, secure: production, render: (res, title, body) => page(res, zubra.page(), title, body) });
  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body, { status = 200, ...options } = {}) => send(res, status, p.finish(layout({ title, shop, body, ...options })));
  const admin = createAdmin({ book, customers, now });
  const downloadCsv = (res, name, text) => (res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }), res.end(text));
  const withDone = (path, words) => `${path}?done=${encodeURIComponent(words)}`;
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

  function home(url, account) {
    const mine = account ? book.jobsOf(account.customer).filter((job) => job.status !== 'picked-up') : [];
    return `<section class="hero"><h1>${escape(shop.short)}</h1><p class="lede">Taxidermy and deer processing in ${escape(shop.town)}. Drop it off, follow every stage from your phone, get a text when it’s ready, and pay online if you like. ${escape(shop.hours)}.</p><div class="actions"><a class="go" href="#track">Track your job</a>${account ? '<a class="button light" href="/account">Your jobs</a>' : '<a class="button light" href="/account/sign-up">Make an account</a>'}</div></section>
${note(url)}
${mine.length ? `<section class="panel"><h2>Your jobs in the shop</h2><ul>${mine.map((job) => `<li><a href="/t/${job.key}">Tag ${job.tag}</a> · ${escape(job.kind.name)} · ${escape(book.stageName(job.status))}</li>`).join('')}</ul></section>` : ''}
<form class="panel" id="track" method="post" action="/track"><h2>Find your job</h2><p class="muted">Your tag has a code that opens your job; or give the tag number and your phone.</p>
  <label>Tag number<input name="tag" inputmode="numeric" autocomplete="off" required></label>
  <label>Last four digits of your phone<input name="phone" inputmode="numeric" autocomplete="off" maxlength="4" required></label>
  <button type="submit">Find it</button></form>
<section><h2>What we do</h2><ul class="fleets">${book.kinds.map((kind) => `<li class="fleet"><h2>${escape(kind.name)}</h2><p>${escape(kind.blurb)}</p><p class="price">From ${money(kind.cents)} · ${escape(kind.turnaround)}</p></li>`).join('')}</ul></section>
<section class="two"><div class="panel"><h2>How it works</h2><ol><li>Drop it off at the counter; we take a deposit and give you a tag.</li><li>Scan the tag to follow each stage. We text you when it’s ready.</li><li>Pay the balance online or at pickup.</li></ol></div><div class="panel"><h2>Visit</h2><dl class="facts"><dt>Where</dt><dd>${escape(shop.town)}</dd><dt>Hours</dt><dd>${escape(shop.hours)}</dd><dt>Phone</dt><dd>${escape(shop.phone)}</dd></dl></div></section>`;
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
      const account = customers.session(req);
      const guest = { ...guests.ensure(req, res), customer: account?.customer };
      const who = staff.session(req);
      const onShift = staff.can(who, 'staff');
      const owner = staff.can(who, 'owner');
      const nav = { customer: account, staff: onShift };
      const show = (p, title, body, options = {}) => page(res, p, title, body, { nav, ...options });
      if (url.pathname.startsWith('/account') || url.pathname.startsWith('/admin')) res.setHeader('cache-control', 'no-store');

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
        // A customer's account.
        if (url.pathname.startsWith('/account/')) {
          const p = zubra.page();
          const problem = (words) => `<p class="notice" role="alert">${escape(words)}</p>`;
          if (url.pathname === '/account/sign-up') {
            const made = await customers.signUp({ email: form.get('email'), name: form.get('name'), password: form.get('password') });
            if (made.error) return show(p, 'Make an account', accountPages.signUp({ problem: problem(made.error), form }), { status: 422 });
            await book.claim(guest, made.customer);
            res.setHeader('set-cookie', made.cookie);
            return back(res, withDone('/account', 'Welcome. Your account is ready.'));
          }
          if (url.pathname === '/account/sign-in') {
            const signed = await customers.signIn(form.get('email'), form.get('password'), { client: clientAddress(req, { proxies }) });
            if (signed.error) return show(p, 'Sign in', accountPages.signIn({ problem: problem(signed.error === 'locked' ? 'Too many tries. Wait 15 minutes, or reset your password.' : 'That email and password don’t match.'), email: String(form.get('email') ?? '') }), { status: 401 });
            await book.claim(guest, signed.customer);
            res.setHeader('set-cookie', signed.cookie);
            return back(res, '/account');
          }
          if (url.pathname === '/account/sign-out') {
            res.setHeader('set-cookie', (await customers.signOut(req)).cookie);
            return back(res, '/');
          }
          if (url.pathname === '/account/forgot') {
            const email = String(form.get('email') ?? '').trim().toLowerCase();
            const raw = await customers.resetToken(email);
            const one = raw && customers.list().find((c) => c.email === email);
            if (one) {
              const link = `${origin(req)}/account/reset?token=${raw}`;
              await book.email(one.email, `Reset your ${shop.short} password`, `Hi ${one.name},\n\nThis link sets a new password. It works once, for an hour:\n${link}\n\nIf it wasn’t you, ignore this email.`);
              if (!production) console.log(`Password reset for ${one.email}: ${link}`);
            }
            return show(p, 'Reset your password', accountPages.forgot({ sent: true }));
          }
          if (url.pathname === '/account/reset') {
            const raw = String(form.get('token') ?? '');
            const reset = await customers.reset(raw, form.get('password'));
            if (reset.error) return show(p, 'Choose a new password', accountPages.reset({ token: raw, problem: problem(reset.error), works: customers.peek(raw) }), { status: 422 });
            res.setHeader('set-cookie', reset.cookie);
            return back(res, withDone('/account', 'Your new password is saved.'));
          }
          if (url.pathname === '/account/profile') {
            if (!account) return back(res, '/account/sign-in');
            const renamed = await customers.rename(account.customer, form.get('name'));
            return back(res, renamed.ok ? withDone('/account', 'Saved.') : withProblem('/account', renamed));
          }
          return send(res, 404, 'Not found');
        }
        // The admin's changes. Staff move jobs; owners change customers and settings.
        if (url.pathname.startsWith('/admin/')) {
          if (!onShift) return back(res, '/admin');
          const moving = url.pathname.match(/^\/admin\/jobs\/(j[a-z0-9]+)\/advance$/);
          if (moving) {
            const done = await book.advance(moving[1], { to: String(form.get('to') ?? ''), link: origin(req), paidAtCounter: form.get('paidAtCounter') === 'yes' });
            if (!done.ok) return back(res, withProblem(`/admin/jobs/${moving[1]}`, done));
            await book.audit(who, `moved tag ${done.job.tag} to ${book.stageName(done.to).toLowerCase()}`, moving[1]);
            return back(res, withDone(`/admin/jobs/${moving[1]}`, `Now ${book.stageName(done.to).toLowerCase()}.${done.notified ? ' The customer has been sent a text.' : ''}`));
          }
          if (!owner) return back(res, '/admin');
          const customerAction = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)\/(disabled|reset)$/);
          const one = customerAction && customers.get(customerAction[1]);
          if (one && customerAction[2] === 'disabled') {
            const off = form.get('disabled') === 'yes';
            await customers.setDisabled(one.customer, off);
            await book.audit(who, `${off ? 'turned off' : 'turned back on'} ${one.name}’s account`, one.customer);
            return back(res, withDone(`/admin/customers/${one.customer}`, off ? 'Turned off and signed out everywhere.' : 'Turned back on.'));
          }
          if (one) {
            const raw = await customers.resetToken(one.email);
            if (!raw) return back(res, withProblem(`/admin/customers/${one.customer}`, { error: 'That account is turned off.' }));
            await book.email(one.email, `Reset your ${shop.short} password`, `Hi ${one.name},\n\nThis link sets a new password. It works once, for an hour:\n${origin(req)}/account/reset?token=${raw}`);
            await book.audit(who, `emailed ${one.name} a reset link`, one.customer);
            return back(res, withDone(`/admin/customers/${one.customer}`, 'Sent. It’s in the outbox.'));
          }
          const kindSetting = url.pathname.match(/^\/admin\/settings\/kind\/([a-z]+)$/);
          if (kindSetting || url.pathname === '/admin/settings/shop') {
            const saved = kindSetting ? await book.setKind(kindSetting[1], form) : await book.setShop(form);
            if (saved.error) return back(res, withProblem('/admin/settings', saved));
            await book.audit(who, kindSetting ? `changed ${saved.kind.name.toLowerCase()} to ${money(saved.kind.cents)}, ${money(saved.kind.deposit)} deposit` : 'changed the hours or phone');
            return back(res, withDone('/admin/settings', 'Saved. New jobs use it now.'));
          }
          return send(res, 404, 'Not found');
        }
        // Sign-in, links, people and passwords.
        if (await pages.handle(req, res, url, form)) return;
        if (url.pathname.startsWith('/shop/') && !onShift) return back(res, '/shop');
        const taking = url.pathname.match(/^\/shop\/new\/([a-z]+)$/);
        const kind = taking && book.kind(taking[1]);
        if (kind) {
          const done = await book.intake(kind, form);
          if (done.ok) await book.audit(who, `took in tag ${done.tag}, ${kind.name.toLowerCase()}`, done.key);
          return back(res, done.ok ? `/shop/tag/${done.key}` : withProblem(`/shop/new/${kind.id}`, done));
        }
        if (url.pathname === '/shop/advance') {
          const done = await book.advance(String(form.get('key') ?? ''), { to: String(form.get('to') ?? ''), link: origin(req), paidAtCounter: form.get('paidAtCounter') === 'yes' });
          if (!done.ok) return back(res, withProblem('/shop', done));
          await book.audit(who, `moved tag ${done.job.tag} to ${book.stageName(done.to).toLowerCase()}`, done.job.key);
          const said = `Tag ${done.job.tag}: ${book.stageName(done.to).toLowerCase()}.${done.notified ? ' The customer has been sent a text.' : ''}`;
          return back(res, `/shop?done=${encodeURIComponent(said)}`);
        }
        return send(res, 404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      if (await pages.handle(req, res, url, null)) return;
      const p = zubra.page();
      if (url.pathname === '/') return show(p, 'Track your job', home(url, account), { here: '/' });

      // A customer's pages.
      if (url.pathname === '/account') return account ? show(p, 'Your account', accountPages.account({ book, customer: account, said: note(url) }), { here: '/account' }) : back(res, '/account/sign-in');
      if (url.pathname === '/account/sign-in') return account ? back(res, '/account') : show(p, 'Sign in', accountPages.signIn({ problem: note(url) }), { here: '/account/sign-in' });
      if (url.pathname === '/account/sign-up') return account ? back(res, '/account') : show(p, 'Make an account', accountPages.signUp());
      if (url.pathname === '/account/forgot') return show(p, 'Reset your password', accountPages.forgot());
      if (url.pathname === '/account/reset') {
        const raw = url.searchParams.get('token') ?? '';
        return show(p, 'Choose a new password', accountPages.reset({ token: raw, works: customers.peek(raw) }));
      }

      // The admin: staff only; reports, settings and the outbox for owners.
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        if (!onShift) return show(p, 'Sign in', pages.signIn(url));
        const bar = pages.bar(who);
        const said = note(url);
        const wide = { wide: true, here: '/admin' };
        if (url.pathname === '/admin') return show(p, 'Overview', admin.dashboard({ who, owner, bar }), wide);
        if (url.pathname === '/admin/jobs') return show(p, 'Jobs', admin.jobs({ url, owner, bar }), wide);
        if (url.pathname === '/admin/jobs.csv') return downloadCsv(res, 'jobs.csv', admin.jobsCsv(url));
        const oneJob = url.pathname.match(/^\/admin\/jobs\/(j[a-z0-9]+)$/);
        const job = oneJob && book.job(oneJob[1]);
        if (job) return show(p, `Tag ${job.tag}`, admin.job({ job, owner, bar, said }), wide);
        if (url.pathname === '/admin/customers') return show(p, 'Customers', admin.customers({ url, owner, bar }), wide);
        if (url.pathname === '/admin/customers.csv') return downloadCsv(res, 'customers.csv', admin.customersCsv());
        const oneCustomer = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)$/);
        const one = oneCustomer && customers.get(oneCustomer[1]);
        if (one) return show(p, one.name, admin.customer({ one, owner, bar, said }), wide);
        if (['/admin/reports', '/admin/reports.csv', '/admin/settings', '/admin/outbox'].includes(url.pathname) && !owner) return show(p, 'Owners only', '<section><h1>Owners only</h1><p class="lede">Ask an owner to see this page.</p><p><a href="/admin">Back to the overview</a></p></section>', { status: 403 });
        if (url.pathname === '/admin/reports') return show(p, 'Reports', admin.reports({ url, owner, bar }), wide);
        if (url.pathname === '/admin/reports.csv') return downloadCsv(res, 'taken-in.csv', admin.reportCsv(url));
        if (url.pathname === '/admin/settings') return show(p, 'Settings', admin.settings({ owner, bar, said }), wide);
        if (url.pathname === '/admin/outbox') return show(p, 'Outbox', admin.outbox({ owner, bar }), wide);
        return send(res, 404, 'Not found');
      }
      const tracking = url.pathname.match(/^\/t\/(j[a-z0-9]+)(\/pay)?$/);
      if (tracking) {
        const job = await book.open(guest, tracking[1]);
        if (!job) return send(res, 404, 'No such job');
        if (tracking[2]) return job.balance > 0 ? show(p, 'Pay the balance', payPage(p, url, job)) : back(res, `/t/${job.key}`);
        return show(p, `Tag ${job.tag}`, jobPage(p, url, job));
      }
      if (url.pathname === '/shop' || url.pathname.startsWith('/shop/')) {
        if (!onShift) return show(p, 'Sign in', pages.signIn(url));
        if (url.pathname === '/shop') return show(p, 'The shop', pages.bar(who) + board(url));
        const taking = url.pathname.match(/^\/shop\/new\/([a-z]+)$/);
        const kind = taking && book.kind(taking[1]);
        if (kind) return show(p, `New: ${kind.name}`, intakeForm(url, kind));
        const tagging = url.pathname.match(/^\/shop\/tag\/(j[a-z0-9]+)$/);
        const job = tagging && book.job(tagging[1]);
        if (job) return show(p, `Tag ${job.tag}`, tag(job, req));
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });
  return Object.assign(server, { book, staff, customers });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  if (server.staff.needsOwner()) console.log(`Set up the first owner (works once, for a day): http://localhost:${port}/staff/accept?token=${await server.staff.setup()}`);
  server.listen(port, '0.0.0.0', () => console.log(`Work Ticket on http://localhost:${port}`));
}
