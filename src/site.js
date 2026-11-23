// The landing page: what a customer sees at `/`. A full-screen photograph and a few words, the
// one thing most visitors came to do (find their job) never more than a thumb away, then what
// the shop does and what it costs, with a photograph of each.
//
// The words are in src/shop.js (`site`); prices and turnaround are the shop's own (`kinds`, and
// what the owner set in the admin); the photographs are files in public/photos/.
import { escape, art } from './layout.js';
import { photo } from './assets.js';
import { site } from './shop.js';

const picture = (name, alt, { eager = false, cls = '' } = {}) => (photo(name) ? `<img${cls ? ` class="${cls}"` : ''} src="${photo(name)}" alt="${escape(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : '');

/** `kinds` are the shop's kinds of job as they are now; `mine` the signed-in customer's open jobs; `said` any signed message. */
export function landing({ shop, kinds, money, mine = [], said = '', account = null, stageName }) {
  const { hero, dropoff, find, services, story, steps, visit } = site;
  const tel = `tel:+1${shop.phone.replace(/\D/g, '')}`;
  const track = (cls = 'go lg') => `<a class="${cls}" href="#track">${escape(site.track)}</a>`;

  return `<section class="hero">${picture('hero', '', { eager: true, cls: 'bg' })}
  <div class="wrap hero-words">
    <p class="kicker">${escape(hero.kicker)}</p>
    <h1>${escape(hero.title)} <em>${escape(hero.titleSoft)}</em></h1>
    <p class="lede">${escape(hero.lede)}</p>
    <div class="actions">${track()}<a class="button ghost lg" href="#services">${escape(hero.secondary)}</a></div>
  </div>
  <div class="hero-strip"><div class="wrap"><p>${escape(shop.hours)}</p><p><a href="${tel}">${escape(shop.phone)}</a></p></div></div>
</section>
${mine.length ? `<div class="wrap mine"><section class="panel"><h2>Your jobs in the shop</h2><ul>${mine.map((job) => `<li><a href="/t/${job.key}">Tag ${job.tag} · ${escape(job.kind.name)} <span>${escape(stageName(job.status))}</span></a></li>`).join('')}</ul></section></div>` : ''}
<div class="wrap said">${said}</div>

<section class="split"><div class="wrap">
  <div class="pic">${picture('tag', 'A paper tag tied to an antler on the shop counter, beside a phone')}</div>
  <div class="words"><p class="kicker">${escape(dropoff.kicker)}</p><h2>${escape(dropoff.heading)}</h2><p>${escape(dropoff.text)}</p>
    <form class="finder" id="track" method="post" action="/track"><h3>${escape(find.heading)}</h3><p>${escape(find.text)}</p>
      <div class="fields"><label>Tag number<input name="tag" inputmode="numeric" autocomplete="off" placeholder="0042" required></label>
      <label>Last four of your phone<input name="phone" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="0199" required></label></div>
      <button type="submit" class="go lg">Find it</button></form>
  </div>
</div></section>

<div class="sec menu" id="services"><div class="wrap">
  <header class="head center"><p class="kicker">${escape(services.kicker)}</p><h2 class="big">${escape(services.heading)}</h2><p>${escape(services.lede)}</p></header>
  <ul class="cards">${kinds
    .map((kind) => `<li class="card"><div class="pic">${picture(kind.id, kind.name)}<span class="when">${escape(kind.turnaround)}</span></div><div class="body"><h3>${escape(kind.name)}</h3><p>${escape(kind.blurb)}</p><p class="price">From ${money(kind.cents)} · ${escape(kind.turnaround)}</p>${kind.deposit ? `<p class="dep">${money(kind.deposit)} deposit at drop-off</p>` : '<p class="dep">No deposit</p>'}</div></li>`)
    .join('')}</ul>
</div></div>

<section class="banner" id="story">${picture('workshop', '', { cls: 'bg' })}<div class="wrap"><p class="kicker">${escape(story.kicker)}</p><h2>${escape(story.heading)}</h2>${story.paragraphs.map((text) => `<p>${escape(text)}</p>`).join('')}${track()}</div></section>

<div class="sec how" id="how"><div class="wrap">
  <h2 class="big">${escape(steps.heading)}</h2>
  <ol class="steps">${steps.list.map(([title, text]) => `<li><h3>${escape(title)}</h3><p>${escape(text)}</p></li>`).join('')}</ol>
</div></div>

<div class="sec dark" id="visit"><div class="wrap">
  <header class="head"><p class="kicker">${escape(visit.kicker)}</p><h2 class="big">${escape(visit.heading)}</h2></header>
  <div class="visit">
    <div>${art.clock}<h3>Hours</h3><p><strong>${escape(shop.hours)}</strong></p></div>
    <div>${art.pin}<h3>The shop</h3><p><strong>${escape(shop.town)}</strong></p><p>${escape(visit.where)}</p></div>
    <div>${art.phone}<h3>${escape(visit.call)}</h3><p><a class="tel" href="${tel}">${escape(shop.phone)}</a></p><p>${account ? '<a href="/account">Your jobs</a> are in your account.' : 'Bring us a deer every year? <a href="/account/sign-up">Make an account</a>.'}</p></div>
  </div>
  <p class="visit-cta">${track()}</p>
</div></div>`;
}
