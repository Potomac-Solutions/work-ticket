# Work Ticket

Drop off and track, for a shop that takes jobs in and hands them back: a taxidermist, a deer processor, a small-engine or ski-tuning shop. The counter takes a job in and prints its tag. The customer follows each stage on their phone, gets a text when it's ready, and can pay the balance online. A Potomac Solutions platform, built on the [kit](https://github.com/Potomac-Solutions/kit) and [Zubra](https://github.com/journey-to-code-org/zubra).

The shop it starts with, Backbone Mountain Taxidermy & Processing in Oakland, Maryland, is made up. Nothing here is a real job, payments are in test mode, and texts are kept on the shop's page instead of being sent.

## Try it

`npm install`, then `npm start`, and open http://localhost:3000. Two browser windows side by side (one private, so it's another person) show the live parts best.

**Staff sign in with their own accounts.** The first time, nobody has one, so the server prints a setup link: open it to make the owner (your email, name and a password). The owner's **People** page invites the rest of the staff (an invite is a link to send them), resets passwords and turns people off.

1. **Take a job in.** Open **The shop (staff)** from the footer and sign in. Choose **Deer processing**, fill in a customer (any phone with an area code), pick the cuts and an extra or two, and **Take it in**. You get the job's tag: its number, what was asked for, and a code.
2. **Follow it.** In the other window, open the customer's page from the tag. Back at the shop, move the job along (Cutting, Wrapping, Ready). The customer's page follows each step without a reload.
3. **Ready.** When it's ready, the shop page shows the text that went out (with the balance and the link).
4. **Pay.** On the customer's page, **Pay it now** with any card number (`4000 0000 0000 0002` is declined). Then the shop marks it **Picked up**. Or take the balance at the counter: tick the box on the job and press **Picked up**.
5. **Lost the link?** On the home page, the tag number and the last four digits of the phone find the job.
6. **Without JavaScript** (turn it off in the browser's settings), all of it works the same.

## How it is put together

| Piece | Job |
| --- | --- |
| [Potomac kit](https://github.com/Potomac-Solutions/kit) (private) | `stages` (each kind of job's stages, one step at a time, once), `notify` (the ready text and email; a test outbox here), `pay` (the balance, charged at most once; its test provider), `staff` and `staff/pages` (the owner and staff: passwords, sessions, invites, roles, and their pages), `auth` (the customer and shop cookies), `store` (the Sync log). The kit's `checkout-form`, from its package |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). Each job is a document only the server writes; a customer's page follows it live, and a browser reads only the jobs it has opened |
| [symbology](https://github.com/journey-to-code-org/symbology) | Draws the code on the tag (the customer's link) |
| `src/shop.js` | The shop, its kinds of job, their stages, questions and prices, as data |
| `src/jobs.js` | The shop's side: intake, tag numbers, who may see which job, the board, the ready text, the balance, and the words |

## Run it

```sh
npm install      # needs read access to the private Potomac-Solutions/kit repository
npm start        # http://localhost:3000
npm test         # needs Chrome or Playwright's Chromium
```

Node 22.13 or later. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file goes.

## What the tests prove

1. Without JavaScript, the shop takes a job in; extras are added to the price; the tag's code is the customer's link on this server; the customer's page shows every stage and the balance.
2. Intake refuses a missing name, a phone without an area code, an answer the kind doesn't have, or a deposit above the price; an extra the kind doesn't offer is ignored, not charged.
3. A job moves one stage at a time and the customer follows it live; ready sends the text and the email, with the first name, the tag, the balance and the link; pickup needs the balance taken, and happens once.
4. Two tablets pressing the same button at once move a job one stage, not two.
5. The customer pays the balance online once (a declined card says so); someone who never opened the job can't pay it.
6. Tag number and the last four of the phone find a lost job; a wrong pair finds nothing.
7. Only signed-in staff take jobs in or moves them; a browser reads only the jobs it has opened, even when it asks for more, and writes nothing.

Every behaviour was broken on purpose once to check a test fails (19 of 19 caught). Writing test 4 found a real bug: a second press of a stage's button moved the job on a further stage. Each button now says which stage it moves to.

## Not yet

- The owner's admin: kinds of job, stages, questions and prices, now in `src/shop.js`.
- Real texts and email (a provider behind the kit's `notify`), and a real payment provider.
- Photos at intake and at ready (the kit's `files`).
