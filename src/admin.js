// The admin pages: the shop at a glance, every job, customers, reports and settings.
//
// Staff see the overview, jobs and customers. Owners also see reports, settings and the outbox,
// and can turn a customer's account off. Every page is plain HTML and forms.
import { series, totals, breakdown, csv } from '@potomac-solutions/kit/reports';
import { barChart, rankBars } from '@potomac-solutions/kit/charts';
import { escape } from './layout.js';
import { money } from './account.js';

const DAY = 86_400_000;
const PAGE = 25;

export const RANGES = {
  '30d': { label: 'Last 30 days', days: 30, by: 'day' },
  '13w': { label: 'Last 13 weeks', days: 91, by: 'week' },
  '12m': { label: 'Last 12 months', days: 365, by: 'month' },
};

export function createAdmin({ book, customers, now = Date.now }) {
  const { shop } = book;
  const zone = shop.timeZone;
  const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }) : '');
  const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: zone }) : '');
  const short = (start, by) => {
    const date = new Date(`${start}T12:00:00Z`);
    return by === 'month' ? date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const option = (value, words, current) => `<option value="${escape(value)}"${current === value ? ' selected' : ''}>${escape(words)}</option>`;
  const pageOf = (url) => Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pager = (url, base, count, page) => {
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const at = (n) => {
      const next = new URLSearchParams(url.searchParams);
      next.set('page', String(n));
      return `${base}?${next}`;
    };
    return pages > 1 ? `<p class="pager">${page > 1 ? `<a href="${escape(at(page - 1))}">Newer</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${escape(at(page + 1))}">Older</a>` : ''}</p>` : '';
  };
  /** Late: still in the shop, not ready, past its kind's turnaround. */
  const late = (job) => job.status !== 'ready' && job.status !== 'picked-up' && now() - job.received > (job.kind.turnaroundDays ?? 30) * DAY;
  const badge = (job) => {
    if (job.status === 'picked-up') return '<span class="badge past">Picked up</span>';
    if (job.status === 'ready') return '<span class="badge ready">Ready</span>';
    return `<span class="badge ${late(job) ? 'late' : 'booked'}">${escape(book.stageName(job.status))}${late(job) ? ', late' : ''}</span>`;
  };
  const turnaround = (job) => (job.ready && job.received ? (job.ready - job.received) / DAY : null);

  function nav(here, owner) {
    const link = (href, words) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${words}</a>`;
    return `<nav class="admin-nav" aria-label="Admin"><small>Shop</small>${link('/admin', 'Overview')}${link('/admin/jobs', 'Jobs')}${link('/admin/customers', 'Customers')}${link('/shop', 'The board')}${
      owner ? `<small>Owner</small>${link('/admin/reports', 'Reports')}${link('/admin/settings', 'Settings')}${link('/staff/people', 'Staff')}${link('/admin/outbox', 'Outbox')}` : ''
    }</nav>`;
  }
  const frame = (here, owner, bar, body) => `<div class="admin">${nav(here, owner)}<div class="admin-body">${bar}${body}</div></div>`;
  const jobRows = (list) =>
    list.length
      ? `<div class="table-wrap"><table><thead><tr><th scope="col">Tag</th><th scope="col">Job</th><th scope="col">Customer</th><th scope="col">Dropped off</th><th scope="col">Stage</th><th scope="col" class="num">Price</th><th scope="col" class="num">Due</th></tr></thead><tbody>${list
          .map(
            (job) =>
              `<tr><td><a href="/admin/jobs/${job.key}">${job.tag}</a></td><td>${escape(job.kind.name)}</td><td>${escape(job.name)}${job.customer ? ` <a class="muted" href="/admin/customers/${escape(job.customer)}">(account)</a>` : ''}<br><small class="muted">${escape(job.phone)}</small></td><td>${day(job.received)}</td><td>${badge(job)}</td><td class="num">${money(job.cents)}</td><td class="num">${job.balance ? money(job.balance) : '—'}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p>None.</p>';

  function filterJobs(url) {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
    const kind = url.searchParams.get('kind') ?? '';
    const where = url.searchParams.get('where') ?? 'shop';
    return book
      .allJobs()
      .filter(
        (job) =>
          (!kind || job.kind.id === kind) &&
          (where === 'all' || (where === 'shop' ? job.status !== 'picked-up' && job.status !== 'ready' : where === 'ready' ? job.status === 'ready' : where === 'late' ? late(job) : job.status === 'picked-up')) &&
          (!q || [String(job.tag), job.name, job.phone, job.email].some((field) => String(field ?? '').toLowerCase().includes(q))),
      );
  }

  return {
    nav,

    dashboard({ who, owner, bar }) {
      const at = now();
      const all = book.allJobs();
      const inShop = all.filter((job) => job.status !== 'picked-up');
      const ready = inShop.filter((job) => job.status === 'ready');
      const lateJobs = inShop.filter(late);
      const taken30 = all.filter((job) => job.received > at - 30 * DAY);
      const taken60 = all.filter((job) => job.received <= at - 30 * DAY && job.received > at - 60 * DAY);
      const value = totals(taken30, { amount: (job) => job.cents }).amount;
      const before = totals(taken60, { amount: (job) => job.cents }).amount;
      const owed = totals(ready, { amount: (job) => job.balance }).amount;
      const days = series(all, { at: (job) => job.received, amount: (job) => job.cents, by: 'day', zone, from: at - 29 * DAY, to: at });
      const activity = book.activity(8);
      const people = customers.list();
      return frame(
        '/admin',
        owner,
        bar,
        `<section><h1>Overview</h1><p class="lede">${escape(shop.name)}. Good to see you, ${escape(who.name.split(' ')[0])}.</p></section>
<div class="tiles">
  <div class="tile"><span>Taken in, last 30 days</span><strong>${money(value)}</strong><small>${taken30.length} jobs${before ? `; ${value >= before ? '▲' : '▼'} ${Math.abs(Math.round(((value - before) / before) * 100))}% on the 30 days before` : ''}</small></div>
  <div class="tile"><span>In the shop</span><strong>${inShop.length - ready.length}</strong><small>being worked on</small></div>
  <div class="tile"><span>Ready for pickup</span><strong>${ready.length}</strong><small>${money(owed)} still to collect</small></div>
  <div class="tile"><span>Late</span><strong>${lateJobs.length}</strong><small>past their usual turnaround</small></div>
  <div class="tile"><span>Customer accounts</span><strong>${people.length}</strong><small>${people.filter((one) => one.at > at - 30 * DAY).length} new in 30 days</small></div>
</div>
<section class="panel"><h2>Taken in by day, last 30 days</h2>${barChart(days.map((b) => ({ label: short(b.start, 'day'), value: b.amount, tip: `${short(b.start, 'day')}: ${b.count} job${b.count === 1 ? '' : 's'}, ${money(b.amount)}` })), { name: 'Taken in', format: money })}${owner ? '<p><a href="/admin/reports">All reports</a></p>' : ''}</section>
<section class="panel"><h2>Late</h2>${jobRows(lateJobs.slice(0, 8))}</section>
<section class="panel"><h2>Ready, waiting for pickup</h2>${jobRows(ready.slice(0, 8))}<p><a href="/admin/jobs?where=ready">Every ready job</a></p></section>
<section class="panel"><h2>Staff activity</h2>${activity.length ? `<ul>${activity.map((one) => `<li><strong>${escape(one.by)}</strong> ${escape(one.what)} <small class="muted">${dateTime(one.at)}</small></li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}</section>`,
      );
    },

    jobs({ url, owner, bar }) {
      const list = filterJobs(url);
      const page = pageOf(url);
      const where = url.searchParams.get('where') ?? 'shop';
      const query = new URLSearchParams(url.searchParams);
      query.delete('page');
      return frame(
        '/admin/jobs',
        owner,
        bar,
        `<section><h1>Jobs</h1><p class="lede">${list.length} job${list.length === 1 ? '' : 's'}, ${money(totals(list, { amount: (job) => job.cents }).amount)}; ${money(totals(list, { amount: (job) => job.balance }).amount)} still due.</p></section>
<form class="panel filters" method="get" action="/admin/jobs">
  <label>Search<input name="q" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Tag, name, phone or email"></label>
  <label>Where<select name="where">${option('shop', 'Being worked on', where)}${option('ready', 'Ready', where)}${option('late', 'Late', where)}${option('done', 'Picked up', where)}${option('all', 'All', where)}</select></label>
  <label>Kind<select name="kind">${option('', 'Any', url.searchParams.get('kind') ?? '')}${book.kinds.map((kind) => option(kind.id, kind.name, url.searchParams.get('kind'))).join('')}</select></label>
  <button type="submit">Show</button>
  <a class="button light" href="/admin/jobs.csv?${escape(String(query))}">Download CSV</a>
</form>
<section class="panel">${jobRows(list.slice((page - 1) * PAGE, page * PAGE))}${pager(url, '/admin/jobs', list.length, page)}</section>`,
      );
    },

    jobsCsv(url) {
      return csv(filterJobs(url), [
        { key: 'tag', label: 'Tag' },
        { key: 'kind', label: 'Kind', value: (job) => job.kind.name },
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'received', label: 'Dropped off', value: (job) => new Date(job.received).toISOString() },
        { key: 'status', label: 'Stage', value: (job) => book.stageName(job.status) },
        { key: 'ready', label: 'Ready', value: (job) => (job.ready ? new Date(job.ready).toISOString() : '') },
        { key: 'cents', label: 'Price (USD)', value: (job) => job.cents / 100 },
        { key: 'deposit', label: 'Deposit (USD)', value: (job) => job.deposit / 100 },
        { key: 'balance', label: 'Due (USD)', value: (job) => job.balance / 100 },
      ]);
    },

    job({ job, owner, bar, said }) {
      const next = job.kind.stages[job.kind.stages.indexOf(job.status) + 1];
      const owed = next === 'picked-up' && job.balance > 0;
      const answers = job.kind.questions.map((question) => `<dt>${escape(question.label)}</dt><dd>${escape(Array.isArray(job.answers[question.id]) ? job.answers[question.id].join(', ') || 'None' : job.answers[question.id])}</dd>`).join('');
      return frame(
        '/admin/jobs',
        owner,
        bar,
        `<section><a href="/admin/jobs">All jobs</a><h1>Tag ${job.tag}: ${escape(job.kind.name)}</h1><p class="lede">${escape(job.name)} · ${badge(job)} · <a href="/shop/tag/${job.key}">Print the tag</a></p></section>
${said}
<section class="two">
  <div class="panel"><h2>The job</h2><dl>${answers}${job.notes ? `<dt>Notes</dt><dd>${escape(job.notes)}</dd>` : ''}<dt>Price</dt><dd>${money(job.cents)}</dd><dt>Deposit</dt><dd>${money(job.deposit)}</dd><dt>Paid since</dt><dd>${money(job.paid ?? 0)}${job.paidOnline ? ' online' : job.paidAtCounter ? ' at the counter' : ''}</dd><dt>Due</dt><dd>${money(job.balance)}</dd></dl>
  ${next ? `<form method="post" action="/admin/jobs/${job.key}/advance"><input type="hidden" name="to" value="${next}">${owed ? `<label class="check"><input type="checkbox" name="paidAtCounter" value="yes"> ${money(job.balance)} taken at the counter</label>` : ''}<button type="submit">${escape(book.stageName(next))}</button></form>` : ''}</div>
  <div class="panel"><h2>Who</h2><dl><dt>Name</dt><dd>${escape(job.name)}</dd><dt>Phone</dt><dd>${escape(job.phone)}</dd><dt>Email</dt><dd>${escape(job.email || '—')}</dd><dt>Account</dt><dd>${job.customer ? `<a href="/admin/customers/${escape(job.customer)}">${escape(customers.get(job.customer)?.name ?? 'Open')}</a>` : 'None yet'}</dd></dl>
  <h2>Stages</h2><dl>${job.kind.stages.map((stage) => `<dt>${escape(book.stageName(stage))}</dt><dd>${job[stage] ? dateTime(job[stage]) : '—'}</dd>`).join('')}</dl></div>
</section>`,
      );
    },

    customers({ url, owner, bar }) {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
      const jobs = book.allJobs();
      const list = customers.list().filter((one) => !q || one.name.toLowerCase().includes(q) || one.email.includes(q));
      const page = pageOf(url);
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section><h1>Customers</h1><p class="lede">${customers.list().length} with accounts. A job taken in under an account’s email joins it.</p></section>
<form class="panel filters" method="get" action="/admin/customers"><label>Search<input name="q" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Name or email"></label><button type="submit">Show</button><a class="button light" href="/admin/customers.csv">Download CSV</a></form>
<section class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Customer</th><th scope="col">Joined</th><th scope="col" class="num">Jobs</th><th scope="col" class="num">Spent</th></tr></thead><tbody>${list
          .slice((page - 1) * PAGE, page * PAGE)
          .map((one) => {
            const theirs = jobs.filter((job) => job.customer === one.customer);
            return `<tr><td><a href="/admin/customers/${escape(one.customer)}">${escape(one.name)}</a>${one.disabled ? ' <span class="badge off">Off</span>' : ''}<br><small class="muted">${escape(one.email)}</small></td><td>${dateTime(one.at)}</td><td class="num">${theirs.length}</td><td class="num">${money(totals(theirs, { amount: (job) => job.cents }).amount)}</td></tr>`;
          })
          .join('')}</tbody></table></div>${pager(url, '/admin/customers', list.length, page)}</section>`,
      );
    },

    customersCsv() {
      const jobs = book.allJobs();
      return csv(customers.list(), [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'at', label: 'Joined', value: (one) => new Date(one.at).toISOString() },
        { key: 'disabled', label: 'Turned off', value: (one) => (one.disabled ? 'yes' : 'no') },
        { key: 'jobs', label: 'Jobs', value: (one) => jobs.filter((job) => job.customer === one.customer).length },
      ]);
    },

    customer({ one, owner, bar, said }) {
      const jobs = book.jobsOf(one.customer);
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section><a href="/admin/customers">All customers</a><h1>${escape(one.name)}</h1><p class="lede">${escape(one.email)} · joined ${dateTime(one.at)}${one.disabled ? ' · <span class="badge off">Turned off</span>' : ''}</p></section>
${said}
<div class="tiles"><div class="tile"><span>Jobs</span><strong>${jobs.length}</strong></div><div class="tile"><span>Spent</span><strong>${money(totals(jobs, { amount: (job) => job.cents }).amount)}</strong></div><div class="tile"><span>Due now</span><strong>${money(totals(jobs, { amount: (job) => job.balance }).amount)}</strong></div></div>
<section class="panel"><h2>Jobs</h2>${jobRows(jobs)}</section>
${
  owner
    ? `<section class="panel"><h2>Account</h2><p>Turning an account off signs it out everywhere; its jobs stay.</p><div class="filters"><form method="post" action="/admin/customers/${escape(one.customer)}/disabled"><input type="hidden" name="disabled" value="${one.disabled ? 'no' : 'yes'}"><button type="submit" class="${one.disabled ? '' : 'button light'}">${one.disabled ? 'Turn back on' : 'Turn off'}</button></form>${one.disabled ? '' : `<form method="post" action="/admin/customers/${escape(one.customer)}/reset"><button class="button light" type="submit">Email a reset link</button></form>`}</div></section>`
    : ''
}`,
      );
    },

    report(url) {
      const key = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '30d';
      const { days, by, label } = RANGES[key];
      const to = now();
      const from = to - (days - 1) * DAY;
      const jobs = book.allJobs().filter((job) => job.received >= from && job.received <= to);
      return { key, by, label, from, to, jobs, buckets: series(jobs, { at: (job) => job.received, amount: (job) => job.cents, by, zone, from, to }) };
    },

    reports({ url, owner, bar }) {
      const r = this.report(url);
      const sum = totals(r.jobs, { amount: (job) => job.cents });
      const byKind = breakdown(r.jobs, { key: (job) => job.kind.name, amount: (job) => job.cents }).sort((a, b) => b.amount - a.amount);
      const extras = new Map();
      for (const job of r.jobs) for (const question of job.kind.questions.filter((one) => one.many)) for (const label of job.answers[question.id] ?? []) extras.set(label, (extras.get(label) ?? 0) + 1);
      const speeds = book.kinds.map((kind) => {
        const done = book.allJobs().filter((job) => job.kind.id === kind.id && turnaround(job) !== null && job.ready >= r.from);
        return { label: kind.name, value: done.length ? done.reduce((n, job) => n + turnaround(job), 0) / done.length : 0, usual: kind.turnaroundDays, count: done.length };
      });
      const outstanding = book.allJobs().filter((job) => job.status !== 'picked-up');
      return frame(
        '/admin/reports',
        owner,
        bar,
        `<section><h1>Reports</h1><p class="lede">${r.label}, by ${r.by}, in the shop’s time (${escape(zone)}). Counted on the day each job came in.</p></section>
<div class="panel filters" role="group" aria-label="Range">${Object.entries(RANGES).map(([key, one]) => `<a class="button${key === r.key ? '' : ' light'}" href="?range=${key}"${key === r.key ? ' aria-current="true"' : ''}>${one.label}</a>`).join('')}</div>
<div class="tiles">
  <div class="tile"><span>Taken in</span><strong>${money(sum.amount)}</strong></div>
  <div class="tile"><span>Jobs</span><strong>${sum.count}</strong></div>
  <div class="tile"><span>Average job</span><strong>${money(sum.count ? Math.round(sum.amount / sum.count) : 0)}</strong></div>
  <div class="tile"><span>Deposits taken</span><strong>${money(totals(r.jobs, { amount: (job) => job.deposit }).amount)}</strong></div>
  <div class="tile"><span>Still to collect</span><strong>${money(totals(outstanding, { amount: (job) => job.balance }).amount)}</strong><small>on every job in the shop</small></div>
</div>
<section class="panel"><h2>Taken in by ${r.by}</h2>${barChart(r.buckets.map((b) => ({ label: short(b.start, r.by), value: b.amount, tip: `${short(b.start, r.by)}: ${b.count} jobs, ${money(b.amount)}` })), { name: 'Taken in', format: money })}<p><a class="button light" href="/admin/reports.csv?range=${r.key}">Download CSV</a></p></section>
<section class="panel"><h2>Jobs by ${r.by}</h2>${barChart(r.buckets.map((b) => ({ label: short(b.start, r.by), value: b.count })), { name: 'Jobs' })}</section>
<section class="two">
  <div class="panel"><h2>By kind</h2>${byKind.length ? rankBars(byKind.map((row) => ({ label: `${row.key} (${row.count})`, value: row.amount })), { format: money }) : '<p>None.</p>'}<h2>Extras chosen</h2>${extras.size ? rankBars([...extras].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))) : '<p>None.</p>'}</div>
  <div class="panel"><h2>Days from drop-off to ready</h2><p class="muted">Average for jobs that became ready in the range, against the usual.</p>${rankBars(speeds.map((row) => ({ label: row.label, value: Math.round(row.value) })), { format: (n) => `${n} days` })}<ul>${speeds.map((row) => `<li>${escape(row.label)}: usually ${row.usual} days; ${row.count} ready in the range</li>`).join('')}</ul></div>
</section>`,
      );
    },

    reportCsv(url) {
      const r = this.report(url);
      return csv(r.buckets, [
        { key: 'start', label: r.by === 'day' ? 'Day' : r.by === 'week' ? 'Week starting' : 'Month' },
        { key: 'count', label: 'Jobs' },
        { key: 'amount', label: 'Taken in (USD)', value: (b) => b.amount / 100 },
      ]);
    },

    settings({ owner, bar, said }) {
      const dollars = (cents) => (cents / 100).toFixed(2);
      return frame(
        '/admin/settings',
        owner,
        bar,
        `<section><h1>Settings</h1><p class="lede">Prices, deposits and the words customers see. New jobs use a new price; jobs already in keep theirs.</p></section>
${said}
<section class="two">${book.kinds
          .map(
            (kind) => `<form class="panel" method="post" action="/admin/settings/kind/${kind.id}"><h2>${escape(kind.name)}</h2>
<div class="filters"><label>Price ($)<input name="cents" inputmode="decimal" required value="${dollars(kind.cents)}"></label><label>Deposit ($)<input name="deposit" inputmode="decimal" required value="${dollars(kind.deposit)}"></label></div>
<label>Description<input name="blurb" maxlength="200" required value="${escape(kind.blurb)}"></label>
<label>How long it takes<input name="turnaround" maxlength="60" required value="${escape(kind.turnaround)}"></label>
<button type="submit">Save</button></form>`,
          )
          .join('')}</section>
<form class="panel" method="post" action="/admin/settings/shop"><h2>The shop</h2>
<label>Hours<input name="hours" maxlength="160" required value="${escape(shop.hours)}"></label>
<label>Phone<input name="phone" type="tel" maxlength="40" required value="${escape(shop.phone)}"></label>
<button type="submit">Save the shop</button></form>`,
      );
    },

    outbox({ owner, bar }) {
      const list = book.notices();
      return frame(
        '/admin/outbox',
        owner,
        bar,
        `<section><h1>Outbox</h1><p class="lede">This demo sends no real texts or email. What it would have sent is here, newest first.</p></section>
<section class="panel">${list.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">To</th><th scope="col">Message</th></tr></thead><tbody>${list.slice(0, 100).map((one) => `<tr><td>${dateTime(one.at)}</td><td>${one.channel === 'sms' ? 'Text' : 'Email'} to ${escape(one.to)}</td><td>${one.subject ? `<strong>${escape(one.subject)}</strong><br>` : ''}<span style="white-space:pre-wrap">${escape(one.body)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p>Nothing sent yet.</p>'}</section>`,
      );
    },
  };
}
