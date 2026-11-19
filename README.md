# Work Ticket

Drop off and track, for a shop that takes jobs in and hands them back: a taxidermist, a deer processor, a small-engine or ski-tuning shop. The counter takes a job in and prints its tag. The customer follows each stage on their phone, gets a text when it's ready, and can pay the balance online. A Potomac Solutions platform, built on the [kit](https://github.com/Potomac-Solutions/kit) and [Zubra](https://github.com/journey-to-code-org/zubra).

The shop it starts with, Backbone Mountain Taxidermy & Processing in Oakland, Maryland, is made up. Nothing here is a real job, payments are in test mode, and texts are kept on the shop's page instead of being sent.

## Try it

`npm install`, then `npm run demo`: it fills the shop with a year of made-up jobs through the seasons (busy from October), forty customers, and today's shop, and starts it on http://localhost:3000. It prints three demo sign-ins, for this machine only:

| Who | Email | Password | Where |
| --- | --- | --- | --- |
| Owner | `owner@example.com` | `backbone-owner-demo` | `/admin`: everything |
| Staff | `shop@example.com` | `backbone-staff-demo` | `/admin` (overview, jobs, customers), `/shop` |
| Customer | `riley@example.com` | `backbone-guest-demo` | `/account` |

`npm start` alone keeps what's there; with no data it prints a setup link for the first owner instead. `npm run seed` fills an empty shop, and `npm run seed -- --fresh` starts over.

**The public side**
1. **The landing page** (`/`): the shop, finding a job by tag and phone, what it does and for how much, how it works, and where and when.
2. **Follow a job.** Open one from its tag (or tag number and phone): its stages move without a reload, and **Pay it now** takes the balance with any card number (`4000 0000 0000 0002` is declined).
3. **An account** (`/account`): a job taken in under your email joins it, and so does any job you open while signed in. Signed in on any device, every job is there, and you can pay from there. **Forgot your password?** sends a one-time link (to the Outbox, and the server's log).

**The admin** (`/admin`, staff sign-in)
4. **Overview**: what was taken in over the last 30 days against the 30 before, jobs being worked on, ready and waiting (with what's still to collect), late jobs (past their kind's usual turnaround), new accounts, a chart by day, and what the staff did.
5. **Jobs**: search by tag, name, phone or email; filter by where they are (being worked on, ready, late, picked up) and kind; CSV. A job's page shows its answers, money and every stage's date, and moves it along (ready texts the customer; pickup needs the balance).
6. **Customers**: every account with its jobs; an owner can turn one off or email a reset link.
7. **Reports** (owners): taken in and jobs by day, week or month in the shop's time zone, by kind, extras chosen, days from drop-off to ready against the usual, deposits, what's still to collect, and CSV.
8. **Settings** (owners): each kind's price, deposit, description and turnaround, and the shop's hours and phone. New jobs use them; jobs already in keep their price.
9. **The board** (`/shop`): take a job in, print its tag, move jobs along, see the texts sent.
10. **Without JavaScript** (turn it off in the browser's settings), all of it works the same.

## How it is put together

| Piece | Job |
| --- | --- |
| [Potomac kit](https://github.com/Potomac-Solutions/kit) (private) | `stages` (each kind of job's stages, one step at a time, once), `notify` (the ready text and email; a test outbox here), `pay` (the balance, charged at most once; its test provider), `staff` and `staff/pages` (the owner and staff: passwords, sessions, invites, roles, and their pages), `auth` (the customer and shop cookies), `store` (the Sync log). The kit's `checkout-form`, from its package |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). Each job is a document only the server writes; a customer's page follows it live, and a browser reads only the jobs it has opened |
| [symbology](https://github.com/journey-to-code-org/symbology) | Draws the code on the tag (the customer's link) |
| `src/shop.js` | The shop, its kinds of job, their stages, questions and prices, as data |
| `src/jobs.js` | The shop's side: intake, tag numbers, who may see which job, the board, the ready text, the balance, what follows a customer account, the owner's settings, the staff activity, and the words |
| `kit/customers`, `kit/reports`, `kit/charts` | Customer accounts; the numbers by day, week or month, and CSV; charts drawn on the server as SVG, with a table under each |
| `src/account.js`, `src/admin.js` | The account pages; the admin |
| `bin/seed.js` | The demo data |

## Run it

```sh
npm install      # needs read access to the private Potomac-Solutions/kit repository
npm start        # http://localhost:3000
npm test         # needs Chrome or Playwright's Chromium
```

Node 22.13 or later. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file goes. Behind a proxy (Railway, Fly, a load balancer), set `TRUST_PROXIES` to how many add to `X-Forwarded-For` (usually `1`), so a wrong-password lockout falls on the device guessing and not on everyone; left unset, no header is trusted and every sign-in counts as the proxy's address.

## What the tests prove

1. Without JavaScript, the shop takes a job in; extras are added to the price; the tag's code is the customer's link on this server; the customer's page shows every stage and the balance.
2. Intake refuses a missing name, a phone without an area code, an answer the kind doesn't have, or a deposit above the price; an extra the kind doesn't offer is ignored, not charged.
3. A job moves one stage at a time and the customer follows it live; ready sends the text and the email, with the first name, the tag, the balance and the link; pickup needs the balance taken, and happens once.
4. Two tablets pressing the same button at once move a job one stage, not two.
5. The customer pays the balance online once (a declined card says so); someone who never opened the job can't pay it.
6. Tag number and the last four of the phone find a lost job; a wrong pair finds nothing.
7. Only signed-in staff take jobs in or moves them; a browser reads only the jobs it has opened, even when it asks for more, and writes nothing.

The admin, customer accounts and reports (`test/admin.test.js`, over plain HTTP):

8. The landing page leads with the shop, then finding a job; a guest sees no admin link.
9. A job taken in under an account's email (in any case) joins it; one taken in without it doesn't, until it's opened signed in; then another signed-in device can pay it, and a signed-out one can't.
10. A forgotten password gets the same page whether or not the account exists; the emailed link works once.
11. The admin needs a staff sign-in; staff get no reports, settings or outbox (403) and their settings posts change nothing; owners get them all.
12. Staff find a job by tag and move it along from its page; ready texts the customer; pickup needs the balance; it's in the activity.
13. A new price and deposit apply to new jobs, not ones already in; a deposit above the price is refused.
14. The report's total matches the jobs and its CSV adds up to it; a name starting with `=` opens in a spreadsheet as text.
15. A turned-off customer is signed out; only an owner can turn them back on.

Every behaviour was broken on purpose once to check a test fails (19 of 19 caught). Writing test 4 found a real bug: a second press of a stage's button moved the job on a further stage. Each button now says which stage it moves to.

## Not yet

- More of the owner's admin: adding kinds of job, their stages and questions are still in `src/shop.js` (prices, deposits and words are editable).
- Real texts and email (a provider behind the kit's `notify`; texts and reset links go to the outbox), and a real payment provider.
- Photos at intake and at ready (the kit's `files`).
