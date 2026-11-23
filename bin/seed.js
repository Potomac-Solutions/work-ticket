// Demo data: an owner and a shop hand, forty customers, a year of jobs through the seasons (busy
// from October), and the shop as it stands today, so every admin page and report has something
// to show.
//
//   npm run seed            add to an empty shop (refuses if it has jobs)
//   npm run seed -- --fresh start over: delete the database first
//
// Each job is taken in through the real intake (tag numbers, prices, accounts by email), then
// its stages are dated back across the time it took. A few jobs are moved to ready today the
// real way, so their texts are in the outbox.
// The names are made up and every address is @example.com. Run it with the server stopped.
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const here = dirname(fileURLToPath(import.meta.url));
const db = join(process.env.DATA_DIR ?? join(here, '..'), 'work-ticket.db');
if (process.argv.includes('--fresh')) for (const file of [db, `${db}-wal`, `${db}-shm`]) if (existsSync(file)) rmSync(file);

// The demo sign-ins live in src/demo.js, so the public demo can show and protect them.
import { DEMO } from '../src/demo.js';
export { DEMO };

let seed = 20261115;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const FIRST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emerson', 'Finley', 'Harper', 'Jamie', 'Kendall', 'Logan', 'Morgan', 'Noah', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor', 'Peyton', 'Rowan', 'Skyler', 'Elliot', 'Hayden', 'Jordan', 'Kai', 'Lane', 'Micah', 'Sasha', 'Tatum', 'Wren', 'Ari'];
const LAST = ['Abbott', 'Barnes', 'Calloway', 'Dunmore', 'Ellison', 'Fairbanks', 'Garrett', 'Holloway', 'Iverson', 'Jessup', 'Kessler', 'Lowry', 'Marsh', 'Nolan', 'Oakley', 'Pruitt', 'Ramsey', 'Sutton', 'Thayer', 'Underwood', 'Vance', 'Whitaker', 'Yates', 'Zeller'];
const person = () => {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  return { name, email: random() < 0.6 ? `${name.toLowerCase().replace(' ', '.')}${Math.floor(random() * 90 + 10)}@example.com` : '', phone: `301-555-0${String(Math.floor(random() * 200)).padStart(3, '0')}` };
};
const DAY = 86_400_000;
const NOW = Date.now();

const server = await createApp({ db, cache: false });
const { book, staff, customers } = server;
const { store } = book;
if (store.under('jobs').length) {
  console.log(`The shop in ${db} already has jobs. Run \`npm run seed -- --fresh\` to start over.`);
  process.exit(1);
}

await staff.accept(await staff.setup(), DEMO.owner);
const ownerView = staff.list().find((one) => one.email === DEMO.owner.email);
await staff.accept((await staff.invite(ownerView, { email: DEMO.staff.email, name: DEMO.staff.name, roles: ['staff'] })).token, DEMO.staff);
const hand = staff.list().find((one) => one.email === DEMO.staff.email);
const accounts = [];
const riley = await customers.signUp(DEMO.customer);
accounts.push({ id: riley.customer, ...DEMO.customer, phone: '301-555-0142' });
for (let i = 0; i < 40; i++) {
  const one = { ...person() };
  one.email ||= `${one.name.toLowerCase().replace(' ', '.')}${i}@example.com`;
  const made = await customers.signUp({ ...one, password: `demo-password-${i}-${Math.floor(random() * 1e6)}` });
  if (made.ok) accounts.push({ id: made.customer, ...one });
}
for (const one of accounts) await store.write('customers', one.id, { at: NOW - Math.floor(random() * 360 + 5) * DAY });

// A year of jobs. Deer season fills the shop from October; spring is quiet.
const SEASON = [1.2, 0.5, 0.3, 0.6, 0.6, 0.3, 0.3, 0.4, 0.9, 2.4, 4.2, 3.2]; // jobs a day, January to December
let jobs = 0;
for (let i = 365; i >= 0; i--) {
  const at = NOW - i * DAY;
  const month = new Date(at).getUTCMonth();
  let count = 0;
  for (let n = 0; n < 8; n++) if (random() < SEASON[month] / 8) count++;
  for (let n = 0; n < count; n++) {
    const kind = book.kind(random() < 0.62 ? 'processing' : random() < 0.6 ? 'european' : 'shoulder');
    const who = random() < 0.45 ? pick(accounts.slice(0, -1)) : person();
    const form = new URLSearchParams({ name: who.name, phone: who.phone, email: who.email, deposit: (kind.deposit / 100).toFixed(2), notes: random() < 0.15 ? pick(['Left side has a hole from the shot.', 'Customer wants the cape back.', 'Call before grinding.', 'Tag with his son’s name.']) : '' });
    for (const question of kind.questions) {
      if (question.many) for (const [label] of question.choices) { if (random() < 0.35) form.append(question.id, label); }
      else form.set(question.id, pick(question.choices));
    }
    const made = await book.intake(kind, form);
    if (!made.ok) throw new Error(made.error);
    // Date it back: dropped off that day, each stage after the last, the whole job about its usual length.
    const received = at - Math.floor(random() * 10 * 3_600_000);
    const total = kind.turnaroundDays * (0.7 + random() * 0.7) * DAY;
    const steps = kind.stages.slice(1, -1); // between received and picked-up
    const stamps = { received };
    let status = 'received';
    let t = received;
    for (const [s, stage] of steps.entries()) {
      t += (total / steps.length) * (0.6 + random() * 0.8);
      if (stage === 'ready') t = Math.max(t, received + total * 0.9);
      if (t > NOW) break;
      stamps[stage] = t;
      status = stage;
    }
    const job = store.get('jobs', made.key);
    const fields = { ...stamps, status };
    if (status === 'ready') {
      const pickedAt = stamps.ready + (1 + random() * 12) * DAY;
      if (pickedAt < NOW && random() < 0.95) {
        fields['picked-up'] = pickedAt;
        fields.status = 'picked-up';
        const balance = job.cents - job.deposit;
        if (random() < 0.3) Object.assign(fields, { paid: balance, paidOnline: balance, paidOnlineAt: stamps.ready + DAY });
        else Object.assign(fields, { paid: balance, paidAtCounter: balance });
      } else if (random() < 0.3) {
        const balance = job.cents - job.deposit;
        Object.assign(fields, { paid: balance, paidOnline: balance, paidOnlineAt: stamps.ready + DAY / 2 });
      }
    }
    await store.write('jobs', made.key, fields);
    jobs++;
  }
}

// Today: a few jobs move along the real way, and their customers are texted.
const link = 'http://localhost:3000';
const moving = book.allJobs().filter((job) => job.kind.id === 'processing' && job.status === 'wrapping').slice(0, 3);
for (const job of moving) {
  const done = await book.advance(job.key, { to: 'ready', link });
  if (done.ok) await book.audit(hand, `moved tag ${job.tag} to ready for pickup`, job.key);
}
const fresh = book.allJobs().filter((job) => job.status === 'received').slice(0, 2);
for (const job of fresh) {
  const next = job.kind.stages[1];
  const done = await book.advance(job.key, { to: next, link });
  if (done.ok) await book.audit(hand, `moved tag ${job.tag} to ${book.stageName(next).toLowerCase()}`, job.key);
}
await book.audit(ownerView, 'changed european mount to $150.00, $50.00 deposit');

console.log(`Seeded ${db}:
  ${accounts.length} customer accounts, ${jobs} jobs over the last year, ${book.allJobs().filter((job) => job.status !== 'picked-up').length} in the shop now.

Sign in (this machine only; these are demo passwords):
  Owner     ${DEMO.owner.email} / ${DEMO.owner.password}    → /admin
  Staff     ${DEMO.staff.email} / ${DEMO.staff.password}     → /admin, /shop
  Customer  ${DEMO.customer.email} / ${DEMO.customer.password}    → /account

Then: npm start`);
process.exit(0);
