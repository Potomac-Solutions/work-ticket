// The public demo (DEMO=1): the seeded Work Ticket, open to anyone, back office included.
//
// - The demo sign-ins (below) are the ones `bin/seed.js` makes. The sign-in pages show them.
// - Nobody can change a demo account: not its password, roles, name or reset link, and nobody can
//   turn it off. Anything else a visitor does (orders, accounts, people they invite) lasts until
//   the next reset.
// - Railway starts the demo with `npm run demo` (seed fresh, then serve). `nightly` exits once a
//   day at a quiet hour, and Railway's "always" restart policy starts it again: fresh data, the
//   same sign-ins, and orders dated today.
//
// Nothing here changes the app unless the server runs with DEMO=1.

export const DEMO = {
  owner: { email: 'owner@example.com', name: 'Wade Lowry', password: 'backbone-owner-demo' },
  staff: { email: 'shop@example.com', name: 'Tess Garrett', password: 'backbone-staff-demo' },
  customer: { email: 'riley@example.com', name: 'Riley Morgan', password: 'backbone-guest-demo' },
};

const REFUSED = { error: 'The demo accounts can’t be changed. Everything resets overnight.' };
const STAFF_EMAILS = new Set([DEMO.owner.email, DEMO.staff.email]);
const GUEST_EMAILS = new Set([DEMO.customer.email]);
const same = (email) => String(email ?? '').trim().toLowerCase();

/** The kit's staff, with every change to a demo account refused. */
export function lockedStaff(staff, emails = STAFF_EMAILS) {
  const isDemo = (account) => staff.list().some((one) => one.account === account && emails.has(same(one.email)));
  return Object.assign(Object.create(staff), {
    resetLink: (by, account) => (isDemo(account) ? REFUSED : staff.resetLink(by, account)),
    setRoles: (by, account, roles) => (isDemo(account) ? REFUSED : staff.setRoles(by, account, roles)),
    setDisabled: (by, account, disabled) => (isDemo(account) ? REFUSED : staff.setDisabled(by, account, disabled)),
    endSessions: (account) => (isDemo(account) ? 0 : staff.endSessions(account)),
    changePassword: (who, current, next) => (isDemo(who?.account) ? REFUSED : staff.changePassword(who, current, next)),
  });
}

/** The kit's customers, with every change to the demo customer refused. */
export function lockedCustomers(customers, emails = GUEST_EMAILS) {
  const isDemo = (customer) => emails.has(same(customers.get(customer)?.email));
  return Object.assign(Object.create(customers), {
    // No reset link for the demo customer; the app answers as it does for an unknown email.
    resetToken: (email) => (emails.has(same(email)) ? null : customers.resetToken(email)),
    rename: (customer, name) => (isDemo(customer) ? REFUSED : customers.rename(customer, name)),
    setDisabled: (customer, disabled) => (isDemo(customer) ? REFUSED : customers.setDisabled(customer, disabled)),
    endSessions: (customer) => (isDemo(customer) ? 0 : customers.endSessions(customer)),
  });
}

const login = (escape, who, account) =>
  `<p><strong>${escape(who)}</strong><br>${escape(account.email)}<br>Password: ${escape(account.password)}</p>`;

/** Above the staff sign-in form. */
export const staffSignIn = (escape) =>
  `<section class="panel demo-login"><h2>Try the back office</h2><p>This is a demo. Sign in as the owner to see everything, or as staff to work the shop board.</p>${login(escape, 'Owner', DEMO.owner)}${login(escape, 'Staff', DEMO.staff)}<p class="hint">Everything you do here is cleared overnight. No job here is real, and nothing is sent.</p></section>`;

/** Above the customer sign-in form. */
export const guestSignIn = (escape) =>
  `<section class="panel demo-login"><h2>Try a customer account</h2>${login(escape, 'Customer', DEMO.customer)}<p class="hint">This is a demo. Everything is cleared overnight.</p></section>`;

/**
 * Exit once a day at `hour` (in `timeZone`), so the host restarts the demo with fresh data.
 * Returns `{ check, stop }`: `check` is what the timer runs every five minutes.
 */
export function nightly({ hour = 4, timeZone = 'America/New_York', now = Date.now, exit = () => process.exit(0), log = console.log } = {}) {
  const hourIn = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(ms));
  const started = now();
  // Not in the first hour, so a restart during the reset hour doesn't loop.
  const check = () => {
    if (now() - started <= 60 * 60_000 || hourIn(now()) !== hour) return false;
    log('Demo reset: exiting so the host starts it again with fresh data.');
    exit();
    return true;
  };
  const timer = setInterval(check, 5 * 60_000);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}
