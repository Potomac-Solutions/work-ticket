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
import { landing } from './src/site.js';
import { shell } from './src/shell.js';
import { cards } from './src/tables.js';
import { serveAsset } from './src/assets.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'work-ticket.db'), cache = true, secret = process.env.SESSION_SECRET, now = Date.now, staffCost, publicUrl = process.env.PUBLIC_URL ?? '' } = {}) {
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
  const pages = staffPages({ staff, notices, proxies, home: '/admin', business: shop.name, secure: production, // A signed-in member of staff sees the kit's pages (people, their password) inside the staff shell;
    // signing in and accepting an invite are a narrow card on the shop's own page.
    render: (res, title, body) => (staff.can(res.who, 'staff') ? staffPage(res, zubra.page(), title, body, { here: title === 'People' ? '/staff/people' : '' }) : page(res, zubra.page(), title, `<div class="auth">${body}</div>`)) });
  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body, { status = 200, ...options } = {}) => send(res, status, p.finish(layout({ title, shop, body, ...options })));
  const staffPage = (res, p, title, body, { status = 200, ...options } = {}) => send(res, status, p.finish(shell({ title, shop, body: cards(body), who: res.who, owner: staff.can(res.who, 'owner'), waiting: book.board().open.filter((job) => job.status === 'ready').length, ...options })));
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
    return landing({ shop, kinds: book.kinds, money, mine, said: note(url), account, stageName: book.stageName });
  }

  function jobPage(p, url, job) {
    return `<div class="status">
<section class="page-head"><p class="kicker">Tag ${job.tag} · dropped off ${day(job.received)}</p><h1>${escape(job.kind.name)}</h1><p class="lede">For ${escape(job.name)}. ${escape(job.kind.turnaround)}, start to finish.</p></section>
${note(url)}
${p.render('job-progress', { job: job.key, steps: job.kind.stages, names: Object.fromEntries(job.kind.stages.map((stage) => [stage, book.stageName(stage)])), statusNow: job.status, paidNow: job.paid ?? 0, cents: job.cents, deposit: job.deposit, pay: `/t/${job.key}/pay` })}
<section class="receipt" aria-label="The job"><h2>The job</h2><dl class="facts">${answersOf(job)}<dt>Price</dt><dd>${money(job.cents)}</dd><dt>Deposit</dt><dd>${money(job.deposit)}</dd></dl><p class="fine">Questions? Call ${escape(shop.phone)} with tag ${job.tag}.</p></section>
<p class="after">${hasAccount(job) ? '<a class="button light" href="/account">All your jobs</a>' : '<a class="button light" href="/account/sign-up">Keep your jobs in an account</a>'}</p>
</div>`;
  }
  const hasAccount = (job) => Boolean(job.customer);

  function payPage(p, url, job) {
    const cart = { lines: [{ item: job.key, qty: 1, name: `Balance, ${job.kind.name.toLowerCase()} (tag ${job.tag})`, total: job.balance }], cents: job.balance, ready: job.balance > 0 };
    return `<div class="checkout">
<section class="page-head"><a class="back" href="/t/${job.key}">Back to your job</a><h1>Pay the balance</h1></section>
<div class="summary"><p>Tag ${job.tag}<strong>${escape(job.kind.name)}</strong></p><p>Pay now and pickup is quicker.</p></div>
${p.render('checkout-form', { cart, place: `/t/${job.key}/pay`, checkout: job.key, problem: notices.read(url).problem, testMode: true, name: job.name, email: job.email ?? '', phone: job.phone ?? '' })}
</div>`;
  }

  function board(url) {
    const { open, done, notices: texts } = book.board();
    let n = 0;
    const card = (job) => {
      const next = job.kind.stages[job.kind.stages.indexOf(job.status) + 1];
      const owed = next === 'picked-up' && job.balance > 0;
      const days = Math.floor((now() - job.received) / 86_400_000);
      const late = job.status !== 'ready' && days > job.kind.turnaroundDays;
      const key = ++n <= 9 ? n : 0;
      return `<li class="ticket job${late ? ' late' : ''}"><div class="top"><span class="at">Tag ${job.tag}</span><span class="badge ${late ? 'off' : job.status === 'ready' ? 'handled' : ''}">${late ? `${days - job.kind.turnaroundDays} days late` : days === 0 ? 'today' : `day ${days}`}</span></div><p class="who">${escape(job.kind.name)}</p><p>${escape(job.name)} · ${escape(job.phone)}</p><p class="stage">${escape(book.stageName(job.status))}${job.balance ? ` · ${money(job.balance)} due` : ' · paid'}</p>
<form method="post" action="/shop/advance"><input type="hidden" name="key" value="${job.key}"><input type="hidden" name="to" value="${next}">${owed ? `<label class="check"><input type="checkbox" name="paidAtCounter" value="yes"> ${money(job.balance)} taken at the counter</label>` : ''}<button type="submit"${key ? ` data-key="${key}"` : ''}>${escape(book.stageName(next))}${key ? `<kbd aria-hidden="true">${key}</kbd>` : ''}</button></form>
<a href="/shop/tag/${job.key}">Tag</a></li>`;
    };
    const ready = open.filter((job) => job.status === 'ready');
    const fresh = open.filter((job) => job.status === 'received');
    const bench = open.filter((job) => job.status !== 'ready' && job.status !== 'received');
    const lane = (cls, title, list, none) => `<section class="lane ${cls}" aria-label="${title}"><h2>${title} <b>${list.length}</b></h2>${list.length ? `<ul class="orders jobs">${list.map(card).join('')}</ul>` : `<p class="none">${none}</p>`}</section>`;
    return `<section class="page-head board-head"><div><h1>The shop</h1><p class="lede">${open.length ? `${open.length} job${open.length === 1 ? '' : 's'} in the shop, ${ready.length} ready for pickup.` : 'Nothing in the shop.'} Customers see each move on their phones, and get a text when it’s ready.</p></div></section>
${note(url)}
<section class="panel" id="new"><h2>Take a job in</h2><div class="filters">${book.kinds.map((kind) => `<a class="button light" href="/shop/new/${kind.id}">${escape(kind.name)}</a>`).join('')}</div></section>
<div class="lanes">${lane('ready', 'Ready for pickup', ready, 'Nothing waiting to be picked up.')}${lane('bench', 'On the bench', bench, 'Nothing on the bench.')}${lane('placed', 'Just in', fresh, 'Nothing new today.')}</div>
${texts.length ? `<section class="panel"><h2>Texts sent</h2><p class="hint">Test mode: kept here, not sent.</p><div>${texts.map((notice) => `<article class="message"><p><small class="muted">${escape(notice.channel)} to ${escape(notice.to)}</small></p><p>${escape(notice.body)}</p></article>`).join('')}</div></section>` : ''}
${done.length ? `<section class="panel"><h2>Picked up</h2><ul class="activity">${done.map((job) => `<li><span>Tag ${job.tag} · ${escape(job.kind.name)} · ${escape(job.name)}</span></li>`).join('')}</ul></section>` : ''}`;
  }

  function intakeForm(url, kind) {
    const question = (q) =>
      q.many
        ? `<fieldset class="choices"><legend>${escape(q.label)}</legend>${q.choices.map(([label, cents]) => `<label class="check"><input type="checkbox" name="${q.id}" value="${escape(label)}"> ${escape(label)} (+${money(cents)})</label>`).join('')}</fieldset>`
        : `<label>${escape(q.label)}<select name="${q.id}" required><option value="">Choose…</option>${q.choices.map((choice) => `<option>${escape(choice)}</option>`).join('')}</select></label>`;
    return `<section class="page-head"><a class="back" href="/shop">The shop</a><h1>${escape(kind.name)}</h1><p class="lede">${money(kind.cents)} before extras. ${escape(kind.turnaround)}.</p></section>
${note(url)}
<form class="panel intake" method="post" action="/shop/new/${kind.id}">
  <div class="two"><label>Customer’s name<input name="name" autocomplete="off" required></label>
  <label>Phone, for the ready text<input name="phone" type="tel" inputmode="tel" autocomplete="off" required></label></div>
  <label>Email<span class="hint">Optional. A job under an account’s email joins that account.</span><input name="email" type="email" inputmode="email" autocapitalize="none" autocomplete="off"></label>
  ${kind.questions.map(question).join('')}
  <label>Notes<textarea name="notes" rows="2"></textarea></label>
  <label>Deposit taken today, in dollars<input name="deposit" inputmode="decimal" value="${(kind.deposit / 100).toFixed(2)}"></label>
  <button type="submit" class="go lg">Take it in and print the tag</button>
</form>`;
  }

  function tag(job, req) {
    const link = `${origin(req)}/t/${job.key}`;
    return `<section class="tag panel"><p class="lede">${escape(shop.name)} · ${escape(shop.phone)}</p><h1>Tag ${job.tag}</h1>
<p><strong>${escape(job.name)}</strong> · ${escape(job.kind.name)} · dropped off ${day(job.received)}</p>
<dl class="facts">${answersOf(job)}</dl>
<div class="code">${qr.svg(qr.encode(link), { title: `Job ${job.tag}` })}</div>
<p>Scan to follow this job, or go to ${escape(origin(req))} with tag ${job.tag} and your phone.</p>
<p class="tools"><a class="button light" href="/shop">Back to the shop</a> <a class="button light" href="/t/${job.key}">The customer’s page</a></p></section>`;
  }

  const server = createServer(async (req, res) => {
    try {
      if (await book.sync.handle(req, res)) return;
      if (zubra.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      if (serveAsset(req, res, url)) return;
      // A made-up shop asks not to be listed; a real one (shop.listed) lists its public page only.
      if (url.pathname === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(shop.listed ? `User-agent: *\nDisallow: /admin\nDisallow: /shop\nDisallow: /staff\nDisallow: /account\nDisallow: /t/\n${publicUrl ? `Sitemap: ${publicUrl}/sitemap.xml\n` : ''}` : 'User-agent: *\nDisallow: /\n');
      if (url.pathname === '/sitemap.xml' && shop.listed && publicUrl) return res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' }).end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(publicUrl)}/</loc></url></urlset>`);
      if (url.pathname === '/favicon.ico') return res.writeHead(302, { location: '/assets/favicon.svg' }).end();
      const account = customers.session(req);
      const guest = { ...guests.ensure(req, res), customer: account?.customer };
      const who = staff.session(req);
      const onShift = staff.can(who, 'staff');
      const owner = staff.can(who, 'owner');
      res.who = who;
      const nav = { customer: account, staff: onShift };
      const signInPage = () => show(zubra.page(), 'Sign in', `<div class="auth">${pages.signIn(url)}</div>`);
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
      if (url.pathname === '/') return show(p, 'Track your job', home(url, account), { here: '/', landing: true, canonical: publicUrl ? `${publicUrl}/` : '' });

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
        if (!onShift) return signInPage();
        const said = note(url);
        const at = (here) => ({ here });
        if (url.pathname === '/admin') return staffPage(res, p, 'Overview', admin.dashboard({ who, owner }), at('/admin'));
        if (url.pathname === '/admin/jobs') return staffPage(res, p, 'Jobs', admin.jobs({ url, owner }), at('/admin/jobs'));
        if (url.pathname === '/admin/jobs.csv') return downloadCsv(res, 'jobs.csv', admin.jobsCsv(url));
        const oneJob = url.pathname.match(/^\/admin\/jobs\/(j[a-z0-9]+)$/);
        const job = oneJob && book.job(oneJob[1]);
        if (job) return staffPage(res, p, `Tag ${job.tag}`, admin.job({ job, owner, said }), at('/admin/jobs'));
        if (url.pathname === '/admin/customers') return staffPage(res, p, 'Customers', admin.customers({ url, owner }), at('/admin/customers'));
        if (url.pathname === '/admin/customers.csv') return downloadCsv(res, 'customers.csv', admin.customersCsv());
        const oneCustomer = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)$/);
        const one = oneCustomer && customers.get(oneCustomer[1]);
        if (one) return staffPage(res, p, one.name, admin.customer({ one, owner, said }), at('/admin/customers'));
        if (['/admin/reports', '/admin/reports.csv', '/admin/settings', '/admin/outbox'].includes(url.pathname) && !owner) return staffPage(res, p, 'Owners only', '<section class="page-head"><h1>Owners only</h1><p class="lede">Reports, settings and the outbox are for owners. Ask one to show you this page.</p></section><p><a class="button light" href="/admin">Back to the overview</a></p>', { status: 403 });
        if (url.pathname === '/admin/reports') return staffPage(res, p, 'Reports', admin.reports({ url, owner }), at('/admin/reports'));
        if (url.pathname === '/admin/reports.csv') return downloadCsv(res, 'taken-in.csv', admin.reportCsv(url));
        if (url.pathname === '/admin/settings') return staffPage(res, p, 'Settings', admin.settings({ owner, said }), at('/admin/settings'));
        if (url.pathname === '/admin/outbox') return staffPage(res, p, 'Outbox', admin.outbox({ owner }), at('/admin/outbox'));
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
        if (!onShift) return signInPage();
        if (url.pathname === '/shop') return staffPage(res, p, 'The shop', board(url), { here: '/shop' });
        const taking = url.pathname.match(/^\/shop\/new\/([a-z]+)$/);
        const kind = taking && book.kind(taking[1]);
        if (kind) return staffPage(res, p, `New: ${kind.name}`, intakeForm(url, kind), { here: '/shop' });
        const tagging = url.pathname.match(/^\/shop\/tag\/(j[a-z0-9]+)$/);
        const job = tagging && book.job(tagging[1]);
        if (job) return staffPage(res, p, `Tag ${job.tag}`, tag(job, req), { here: '/shop' });
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
