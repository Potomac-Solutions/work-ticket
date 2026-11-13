// The shop Work Ticket starts with. Everything here is data the owner will edit from an admin page
// (a later step); nothing else in the app knows what a deer is.
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
