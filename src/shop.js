// The shop Work Ticket starts with. The owner edits prices, deposits and words from the admin;
// nothing else in the app knows what a deer is. `turnaroundDays` says when a job is late.
//
// A made-up shop in a real county, so the demo reads like the trade without being anyone's.

export const shop = {
  id: 'backbone',
  name: 'Backbone Mountain Taxidermy & Processing',
  short: 'Backbone Mountain',
  town: 'Oakland, Maryland',
  timeZone: 'America/New_York',
  hours: 'Drop-offs 7 am to 9 pm in season; pickups Tuesday to Saturday, 9 to 5',
  concept: 'Concept by Potomac Solutions. Backbone Mountain Taxidermy & Processing is a made-up shop; nothing here is a real job.',
  phone: '(301) 555-0142',
  /** Listed in search engines? Off for a made-up shop; a real one turns it on. */
  listed: false,
};

/**
 * The kinds of job the shop takes in. Each has its own stages (between received and ready), its
 * own intake questions, a price and the deposit taken at drop-off. Money is whole cents.
 * An option's `cents` is added to the price when it's chosen.
 */
export const kinds = [
  {
    id: 'processing',
    name: 'Deer processing',
    blurb: 'Skinned, cut, wrapped and frozen, labelled by cut.',
    stages: ['received', 'cutting', 'wrapping', 'ready', 'picked-up'],
    cents: 11000,
    deposit: 0,
    turnaround: 'About a week',
    turnaroundDays: 7,
    questions: [
      { id: 'cuts', label: 'How to cut it', choices: ['Steaks and roasts', 'Half steaks and roasts, half ground', 'All ground'] },
      { id: 'extras', label: 'Extras', many: true, choices: [['Summer sausage', 4000], ['Jerky', 3500], ['Snack sticks', 3000]] },
    ],
  },
  {
    id: 'shoulder',
    name: 'Shoulder mount',
    blurb: 'Tanned and mounted on a form, eyes set, finished by hand.',
    stages: ['received', 'tanning', 'mounting', 'finishing', 'ready', 'picked-up'],
    cents: 65000,
    deposit: 30000,
    turnaround: 'About six months',
    turnaroundDays: 180,
    questions: [{ id: 'pose', label: 'Pose', choices: ['Upright', 'Semi-sneak', 'Full sneak'] }],
  },
  {
    id: 'european',
    name: 'European mount',
    blurb: 'Skull cleaned and whitened, antlers left natural.',
    stages: ['received', 'cleaning', 'whitening', 'ready', 'picked-up'],
    cents: 15000,
    deposit: 5000,
    turnaround: 'About six weeks',
    turnaroundDays: 42,
    questions: [{ id: 'finish', label: 'Finish', choices: ['Natural', 'Whitened'] }],
  },
];

/** How a stage reads to the customer. */
export const STAGE_NAMES = {
  received: 'Received',
  cutting: 'Cutting',
  wrapping: 'Wrapping',
  tanning: 'Tanning',
  mounting: 'Mounting',
  finishing: 'Finishing',
  cleaning: 'Cleaning',
  whitening: 'Whitening',
  ready: 'Ready for pickup',
  'picked-up': 'Picked up',
};

/**
 * Every word on the landing page that isn't a price. Change the page here, not in src/site.js.
 * What each kind of job costs and how long it takes come from `kinds` above (and the admin).
 */
export const site = {
  description: 'Deer processing and taxidermy on Backbone Mountain in Oakland, Maryland. Drop it off, follow every stage from your phone, and get a text when it’s ready.',
  trade: 'Taxidermy & Processing',
  track: 'Track your job',
  hero: {
    kicker: 'Oakland, Maryland · since the first frost',
    title: 'Your deer, done right.',
    titleSoft: 'Watch it from your phone.',
    lede: 'Processing and mounts from a shop that answers before you have to ask.',
    secondary: 'Prices',
  },
  dropoff: {
    kicker: 'No more calling to ask',
    heading: 'One tag. Every stage.',
    text: 'We tie a tag on at the counter. Scan it and you’ll see your job move: received, on the bench, ready. We text you the minute it’s done.',
  },
  find: {
    heading: 'Find your job',
    text: 'Scan the code on your tag, or give the tag number and the last four digits of your phone.',
  },
  services: {
    kicker: 'What we do',
    heading: 'Cut, wrapped, mounted.',
    lede: 'Honest prices, posted. A deposit at drop-off; the balance online or at pickup.',
  },
  story: {
    kicker: 'The shop',
    heading: 'Slow work. No shortcuts.',
    paragraphs: [
      'A shoulder mount takes about six months because tanning takes as long as it takes. We’d sooner tell you that up front than rush a hide.',
      'Every job that comes through the door gets a tag, a name and a place on the bench. You’ll always know where yours is.',
    ],
  },
  steps: {
    heading: 'How it works',
    list: [
      ['Drop it off', 'Leave a deposit, take a tag.'],
      ['Follow along', 'Scan the tag. Watch each stage.'],
      ['Pick it up', 'We text you. Pay online or at the counter.'],
    ],
  },
  visit: { kicker: 'Find us', heading: 'Visit', where: 'On Backbone Mountain, ten minutes out of town. Pull around back in season; the cooler door is the green one.', call: 'Call the shop' },
  foot: { line: 'Deer processing and taxidermy, tracked from drop-off to pickup.', built: 'Built by Potomac Solutions', builtHref: 'https://potomac.solutions' },
};
