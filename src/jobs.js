// The shop's book of jobs: what the server knows, and what only it may decide.
//
// Everything lives in one Sync log (a SQLite file), read and written through the kit's store.
// The kit does the deciding: `stages` moves a job along its kind's stages one step at a time,
// `notify` sends the ready text (to a test outbox here), `pay` takes the balance once. This file
// knows the shop's kinds of job, the tag numbers, who may see which job, and the words.
//
//   jobs/<key>       the job: kind, answers, tag, price, deposit, paid, stage and when each began
//   access/<guest>   the jobs a browser has opened by link or by tag and phone: what it may read
//   notices/<id>     every text and email sent (test mode: kept, not sent)
//   payments/<id>    the kit's record of each balance paid
//   settings/<id>    what the owner changed from the admin: a kind's prices and words, the shop's
//   audit/<key>      who on the staff did what, and when
//   customers, customer-sessions, customer-tokens   customer accounts (kit customers)
//
// A job joins a customer's account when it's taken in under their email, or when they open it
// signed in; then every device they sign in on may read it.
import { createSyncServer } from '@zubra/sync/server';
import { sqliteLog } from '@zubra/sync/sqlite';
import { syncStore, serverOnly, SERVER_ONLY } from '@potomac-solutions/kit/store';
import { createStages } from '@potomac-solutions/kit/stages';
import { createNotify } from '@potomac-solutions/kit/notify';
import { createPay, testProvider } from '@potomac-solutions/kit/pay';
import { shop, kinds, STAGE_NAMES } from './shop.js';

const kindsById = new Map(kinds.map((kind) => [kind.id, kind]));
/** A job's key: the secret in the customer's link. */
const KEY = /^j[a-z0-9]{10,24}$/;
const newKey = () => `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const digits = (text) => String(text ?? '').replace(/\D/g, '');

export async function createJobs({ db = ':memory:', now = Date.now } = {}) {
  let who = () => null;
  let onShift = () => false;
  const sync = createSyncServer({
    log: await sqliteLog(db),
    // Pages write nothing: every collection here is the server's.
    authorize: serverOnly([...SERVER_ONLY, 'jobs', 'access', 'notices', 'settings', 'audit', 'boards'], ({ kind }) => kind === 'read'),
    // A page reads the jobs its browser has opened, and nothing else.
    scope({ request }) {
      const guest = who(request);
      const keys = guest ? [...new Set([...(store.get('access', guest.pub)?.keys ?? []), ...(guest.customer ? store.under('jobs').filter((job) => job.customer === guest.customer).map((job) => job.key) : [])])] : [];
      // The shop's board (a number that moves when a job does) goes to staff only.
      return { ...(keys.length ? { jobs: keys } : {}), ...(onShift(request) ? { boards: true } : {}) };
    },
  });
  const store = await syncStore(sync);
  // A new job is a new document, which no open page was made for. One document the server keeps
  // says "the board changed"; the shop's page follows it and fetches the board again.
  const touch = () => store.write('boards', 'shop', { rev: (store.get('boards', 'shop')?.rev ?? 0) + 1 });

  // What the owner changed, over the defaults in shop.js: each kind's price, deposit and words, and
  // the shop's hours and phone. Jobs already taken in keep their price.
  const defaults = { shop: { hours: shop.hours, phone: shop.phone }, kinds: Object.fromEntries(kinds.map((kind) => [kind.id, { cents: kind.cents, deposit: kind.deposit, blurb: kind.blurb, turnaround: kind.turnaround }])) };
  function applySettings() {
    const saved = store.get('settings', 'shop') ?? {};
    Object.assign(shop, defaults.shop, Object.fromEntries(Object.entries(saved).filter(([name]) => name in defaults.shop)));
    for (const kind of kinds) Object.assign(kind, defaults.kinds[kind.id], Object.fromEntries(Object.entries(store.get('settings', kind.id) ?? {}).filter(([name]) => name in defaults.kinds[kind.id])));
  }
  applySettings();
  const accountByEmail = { find: () => '' };

  // One `stages` per kind of job: each has its own steps, in one collection.
  const stagesOf = new Map(kinds.map((kind) => [kind.id, createStages({ store, collection: 'jobs', steps: kind.stages, may: () => true, now })]));

  // Texts and emails go to the shop's outbox in test mode: kept in the log, where the shop page shows them.
  const notify = createNotify({
    send: async ({ channel, to, subject, body }) => {
      await store.write('notices', `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, { channel, to, subject, body, at: now() });
      return { ok: true };
    },
    templates: {
      ready: ({ name, what, tag, balance, link }) => ({
        subject: `Your ${what} is ready`,
        body: `${name}, your ${what} (tag ${tag}) is ready for pickup at ${shop.short}. ${balance ? `Balance due: ${money(balance)}, at pickup or online.` : 'Nothing left to pay.'} ${link}`,
      }),
    },
  });
  const pay = createPay({ provider: testProvider(), store, now });

  const priceOf = (kind, answers) =>
    kind.cents +
    kind.questions
      .filter((question) => question.many)
      .flatMap((question) => question.choices.filter(([label]) => (answers[question.id] ?? []).includes(label)))
      .reduce((sum, [, cents]) => sum + cents, 0);
  const balanceOf = (job) => Math.max(0, job.cents - job.deposit - (job.paid ?? 0));
  const view = (key, job) => (job ? { key, ...job, kind: kindsById.get(job.kind), balance: balanceOf(job) } : null);

  /** Let a browser read a job from now on (it opened the link, or gave the tag and phone). */
  async function grant(guest, key) {
    if (!guest) return;
    const keys = store.get('access', guest.pub)?.keys ?? [];
    if (!keys.includes(key)) await store.write('access', guest.pub, { keys: [...keys, key].slice(-20) });
  }

  return {
    sync,
    store,
    shop,
    kinds,
    kind: (id) => kindsById.get(id) ?? null,
    stageName: (stage) => STAGE_NAMES[stage] ?? stage,
    identify(fn) {
      who = fn;
    },
    /** `fn(request)`: is this a member of staff? They are sent the shop's board. */
    staffed(fn) {
      onShift = fn;
    },
    /** How many times the board has changed: open shop pages follow it (`boards/shop`). */
    boardRev: () => store.get('boards', 'shop')?.rev ?? 0,

    /**
     * The counter takes a job in: who it's for, the kind's questions, the deposit taken. The job
     * gets the next tag number and a secret key for the customer's link.
     */
    async intake(kind, form) {
      const name = String(form.get('name') ?? '').trim().slice(0, 80);
      const phone = String(form.get('phone') ?? '').trim().slice(0, 40);
      const email = String(form.get('email') ?? '').trim().slice(0, 200);
      if (!name) return { error: 'Give the customer’s name.' };
      if (digits(phone).length < 10) return { error: 'Give a phone number with its area code, for the ready text.' };
      const answers = {};
      for (const question of kind.questions) {
        if (question.many) {
          const labels = question.choices.map(([label]) => label);
          answers[question.id] = form.getAll(question.id).map(String).filter((label) => labels.includes(label));
        } else {
          const answer = String(form.get(question.id) ?? '');
          if (!question.choices.includes(answer)) return { error: `Choose ${question.label.toLowerCase()}.` };
          answers[question.id] = answer;
        }
      }
      const deposit = Math.round(Number(form.get('deposit') ?? kind.deposit / 100) * 100);
      const cents = priceOf(kind, answers);
      if (!Number.isInteger(deposit) || deposit < 0 || deposit > cents) return { error: `The deposit is between $0 and ${money(cents)}.` };
      const tag = 1 + Math.max(1000, ...store.under('jobs').map((job) => job.tag ?? 0));
      const key = newKey();
      await stagesOf.get(kind.id).start(key, { kind: kind.id, tag, name, phone, email, answers, notes: String(form.get('notes') ?? '').trim().slice(0, 500), cents, deposit, paid: 0, customer: accountByEmail.find(email) });
      await touch();
      return { ok: true, key, tag };
    },

    /** A job by its key (the customer's link): it, and from now on this browser may read it. */
    async open(guest, key) {
      const job = KEY.test(key) ? store.get('jobs', key) : null;
      if (!job) return null;
      await grant(guest, key);
      // Opened signed in: the job joins the account, unless it's someone else's already.
      if (guest?.customer && !job.customer) await store.write('jobs', key, { customer: guest.customer });
      return view(key, store.get('jobs', key));
    },

    /** A customer who lost the link: the tag number and the last four digits of their phone. */
    async find(guest, form) {
      const tag = Number(digits(form.get('tag')));
      const last4 = digits(form.get('phone')).slice(-4);
      const found = last4.length === 4 && store.under('jobs').find((job) => job.tag === tag && digits(job.phone).endsWith(last4));
      if (!found) return { error: 'No job with that tag number and phone. Check the tag, or call the shop.' };
      await grant(guest, found.key);
      return { ok: true, key: found.key };
    },

    /** The shop's board: every job not picked up, by kind and stage, with the latest texts. */
    board() {
      const jobs = store.under('jobs').map((job) => view(job.key, job));
      return {
        open: jobs.filter((job) => job.status !== 'picked-up').sort((a, b) => a.tag - b.tag),
        done: jobs.filter((job) => job.status === 'picked-up').sort((a, b) => b.tag - a.tag).slice(0, 10),
        notices: store.under('notices').sort((a, b) => b.at - a.at).slice(0, 10),
      };
    },
    job: (key) => view(key, KEY.test(key ?? '') ? store.get('jobs', key) : null),

    /**
     * The shop moves a job to its next stage, one at a time. `to` is the stage the button showed:
     * a second press (another tablet, a double tap) for a stage the job has already reached is
     * refused, not taken as the stage after it. Reaching ready sends the customer the ready text.
     * Picking up needs the balance paid, online or here at the counter.
     */
    async advance(key, { to, link, paidAtCounter = false } = {}) {
      const job = KEY.test(key ?? '') ? store.get('jobs', key) : null;
      if (!job) return { error: 'That isn’t one of our jobs.' };
      const kind = kindsById.get(job.kind);
      const next = kind.stages[kind.stages.indexOf(job.status) + 1];
      if (!next) return { error: 'That job has already been picked up.' };
      if (to !== next) return { error: `Tag ${job.tag} is already at ${STAGE_NAMES[job.status].toLowerCase()}.` };
      if (next === 'picked-up' && balanceOf(job) > 0) {
        if (!paidAtCounter) return { error: `${money(balanceOf(job))} is still due. Take it at the counter first.` };
        await store.write('jobs', key, { paid: (job.paid ?? 0) + balanceOf(job), paidAtCounter: balanceOf(job) });
      }
      const done = await stagesOf.get(kind.id).advance(key, next);
      if (!done.ok) return { error: 'Someone just moved that job. Look again.' };
      await touch();
      let notified = null;
      if (next === 'ready') {
        const after = store.get('jobs', key);
        notified = await notify.notify({ sms: job.phone, ...(job.email ? { email: job.email } : {}) }, 'ready', { name: job.name.split(/\s+/)[0], what: kind.name.toLowerCase(), tag: job.tag, balance: balanceOf(after), link: `${link}/t/${key}` });
      }
      return { ok: true, job: view(key, store.get('jobs', key)), to: next, notified: notified ? Boolean(notified.ok) : undefined };
    },

    /** The customer pays the balance online, once. */
    async payBalance(guest, key, form) {
      const job = KEY.test(key ?? '') ? store.get('jobs', key) : null;
      const access = guest ? (store.get('access', guest.pub)?.keys ?? []) : [];
      if (!job || !(access.includes(key) || (guest?.customer && job.customer === guest.customer))) return { error: 'Open your job from its link first.' };
      const balance = balanceOf(job);
      if (!balance) return { error: 'Nothing left to pay.' };
      const paid = await pay.pay({ id: `job/${key}/${job.paid ?? 0}`, cents: balance, method: { card: String(form.get('card') ?? '') }, description: `${shop.name} balance, tag ${job.tag} (test mode)` });
      if (!paid.ok) return { error: paid.error === 'declined' ? 'That card was declined. Try another.' : 'That didn’t go through. Try again.' };
      await store.write('jobs', key, { paid: (job.paid ?? 0) + balance, paidOnline: balance, paidOnlineAt: now(), ref: paid.ref });
      await touch();
      return { ok: true };
    },

    // ---- Accounts, the admin and the owner's settings -----------------------------------------
    /** How intake finds an account by email (server.js says, since accounts are the kit's). */
    accountsBy(find) {
      accountByEmail.find = (email) => (email ? (find(String(email).trim().toLowerCase()) ?? '') : '');
    },
    /** On signing in or up: the jobs this browser has opened join the account. */
    async claim(guest, customer) {
      let claimed = 0;
      for (const key of store.get('access', guest?.pub ?? '')?.keys ?? []) {
        const job = store.get('jobs', key);
        if (job && !job.customer) {
          await store.write('jobs', key, { customer });
          claimed++;
        }
      }
      return claimed;
    },
    /** A customer's jobs, newest first. */
    jobsOf: (customer) => store.under('jobs').filter((job) => customer && job.customer === customer).map((job) => view(job.key, job)).sort((a, b) => b.tag - a.tag),
    /** Every job, newest first, for the admin. */
    allJobs: () => store.under('jobs').map((job) => view(job.key, job)).sort((a, b) => b.tag - a.tag),
    notices: () => store.under('notices').sort((a, b) => b.at - a.at),
    /** An email the app sends itself (a reset link): kept with the texts, sent nowhere. */
    async email(to, subject, body) {
      await store.write('notices', `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, { channel: 'email', to, subject, body, at: now() });
    },

    /** Something someone on the staff did, for the activity list. */
    async audit(by, what, ref = '') {
      await store.write('audit', `a${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, { by: by?.name ?? 'System', what: String(what).slice(0, 200), ref, at: now() });
    },
    activity: (limit = 20) => store.under('audit').sort((a, b) => b.at - a.at).slice(0, limit),

    /** The owner changes a kind's price, deposit and words. Jobs taken in keep their price. */
    async setKind(id, form) {
      const kind = kindsById.get(id);
      if (!kind) return { error: 'No such kind of job.' };
      const dollars = (name) => {
        const match = /^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(String(form.get(name) ?? '').trim());
        return match ? Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0')) : null;
      };
      const cents = dollars('cents');
      const deposit = dollars('deposit');
      const blurb = String(form.get('blurb') ?? '').trim().slice(0, 200);
      const turnaround = String(form.get('turnaround') ?? '').trim().slice(0, 60);
      if (!cents) return { error: `Give ${kind.name.toLowerCase()} a price in dollars.` };
      if (deposit === null || deposit > cents) return { error: `The deposit for ${kind.name.toLowerCase()} is between $0 and the price.` };
      if (!blurb || !turnaround) return { error: `Describe ${kind.name.toLowerCase()} and how long it takes.` };
      await store.write('settings', id, { cents, deposit, blurb, turnaround });
      applySettings();
      return { ok: true, kind };
    },
    /** The owner changes the shop's hours and phone. */
    async setShop(form) {
      const hours = String(form.get('hours') ?? '').trim().slice(0, 160);
      const phone = String(form.get('phone') ?? '').trim().slice(0, 40);
      if (!hours || digits(phone).length < 10) return { error: 'Give the hours and a phone number with its area code.' };
      await store.write('settings', 'shop', { hours, phone });
      applySettings();
      return { ok: true };
    },
  };
}
