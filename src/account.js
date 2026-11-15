// A customer's account pages: sign in, sign up, a forgotten password, and their own page.
import { escape } from './layout.js';

export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
const badge = (status, words) => `<span class="badge ${status}">${escape(words)}</span>`;

export function signIn({ problem = '', email = '' } = {}) {
  return `<section><h1>Sign in</h1><p class="lede">See your jobs on any device. No account? <a href="/account/sign-up">Make one</a>.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-in">
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(email)}"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p><a href="/account/forgot">Forgot your password?</a></p>
</form>`;
}

export function signUp({ problem = '', form = null } = {}) {
  return `<section><h1>Make an account</h1><p class="lede">Every job you drop off with us, on any device. Jobs you’ve opened from a tag in this browser, and any taken in under your email, join your account.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-up">
  <label>Your name<input name="name" autocomplete="name" required maxlength="80" value="${escape(form?.get('name') ?? '')}"></label>
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(form?.get('email') ?? '')}"></label>
  <label>Password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Make my account</button>
  <p>Already have one? <a href="/account/sign-in">Sign in</a>.</p>
</form>`;
}

export function forgot({ sent = false } = {}) {
  return `<section><h1>Reset your password</h1><p class="lede">We’ll email a link that works once, for an hour.</p></section>
${sent ? '<p class="ok" role="status">If there’s an account with that email, a link is on its way.</p>' : ''}
<form class="panel" method="post" action="/account/forgot">
  <label>Email<input name="email" type="email" autocomplete="email" required></label>
  <button type="submit">Send the link</button>
</form>`;
}

export function reset({ token, problem = '', works = true }) {
  if (!works) return `<section><h1>That link has expired</h1><p class="lede">It may have been used already. <a href="/account/forgot">Ask for a new one</a>.</p></section>`;
  return `<section><h1>Choose a new password</h1></section>
${problem}
<form class="panel" method="post" action="/account/reset">
  <input type="hidden" name="token" value="${escape(token)}">
  <label>New password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Save and sign in</button>
</form>`;
}

/** The customer's own page: their jobs, in the shop and picked up; their details. */
export function account({ book, customer, said }) {
  const jobs = book.jobsOf(customer.customer);
  const open = jobs.filter((job) => job.status !== 'picked-up');
  const done = jobs.filter((job) => job.status === 'picked-up');
  const due = open.reduce((sum, job) => sum + job.balance, 0);
  const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: book.shop.timeZone });
  const rows = (list) =>
    `<div class="table-wrap"><table><thead><tr><th scope="col">Tag</th><th scope="col">Job</th><th scope="col">Dropped off</th><th scope="col">Stage</th><th scope="col" class="num">Due</th></tr></thead><tbody>${list
      .map((job) => `<tr><td><a href="/t/${job.key}">${job.tag}</a></td><td>${escape(job.kind.name)}</td><td>${escape(day(job.received))}</td><td>${badge(job.status === 'ready' ? 'ready' : job.status === 'picked-up' ? 'past' : 'booked', book.stageName(job.status))}</td><td class="num">${job.balance ? money(job.balance) : '—'}</td></tr>`)
      .join('')}</tbody></table></div>`;
  return `<section><h1>Hello, ${escape(customer.name.split(' ')[0])}</h1><p class="lede">${open.length ? `${open.length} job${open.length === 1 ? '' : 's'} in the shop${due ? `, ${money(due)} due at pickup or online` : ''}.` : 'Nothing in the shop right now.'}</p></section>
${said}
<section class="panel"><h2>In the shop</h2>${open.length ? rows(open) : '<p>Nothing. Jobs taken in under your email, or opened from a tag while you’re signed in, show here.</p>'}</section>
${done.length ? `<section class="panel"><h2>Picked up</h2>${rows(done)}</section>` : ''}
<section class="two">
  <form class="panel" method="post" action="/account/profile"><h2>Your details</h2><label>Name<input name="name" autocomplete="name" required maxlength="80" value="${escape(customer.name)}"></label><p class="muted">Email: ${escape(customer.email)}</p><button type="submit">Save</button></form>
  <div class="panel"><h2>Signing in</h2><p><a href="/account/forgot">Change your password</a> by email.</p><form method="post" action="/account/sign-out"><button class="button light" type="submit">Sign out</button></form></div>
</section>`;
}
