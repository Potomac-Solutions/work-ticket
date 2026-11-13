// The page around the components: the shop's frame, its colours, and the connection to the log.
export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
  :root {
    --background: #f6f2ea; --foreground: #2a241b; --card: #ffffff; --border: #d8cfbf; --muted: #ece5d8;
    --muted-foreground: #6b6457; --primary: #4a5d23; --primary-foreground: #ffffff; --ring: #4a5d23;
    --accent: #c8792b; --input: #d8cfbf; --radius: 0.75rem;
    color-scheme: light;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 1.0625rem; line-height: 1.5; background: var(--background); color: var(--foreground); }
  a:not(.action-button, .go, .button) { color: inherit; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .concept { margin: 0; padding: 0.45rem 1rem; background: var(--accent); color: #1f1a10; font-size: 0.85rem; font-weight: 600; text-align: center; }
  .site-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1rem; padding: 1rem clamp(1rem, 4vw, 2.5rem); background: var(--primary); color: var(--primary-foreground); }
  .site-head a { font-size: 1.35rem; font-weight: 800; text-decoration: none; }
  .site-head span { opacity: 0.85; font-size: 0.9rem; }
  main { width: min(60rem, 100% - 2 * clamp(1rem, 4vw, 2.5rem)); margin: 0 auto; padding: 2rem 0 3rem; display: grid; gap: 1.75rem; }
  h1 { margin: 0; font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; }
  h2 { margin: 0; font-size: 1.3rem; }
  .lede { margin: 0.4rem 0 0; color: var(--muted-foreground); }
  .fleets { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
  .fleet { display: grid; gap: 0.5rem; align-content: start; padding: 1.1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .fleet p { margin: 0; color: var(--muted-foreground); }
  .price { color: var(--foreground) !important; font-weight: 700; }
  .go { justify-self: start; padding: 0.55rem 1rem; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); font-weight: 700; text-decoration: none; }
  .panel { display: grid; gap: 0.9rem; padding: 1.1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .panel ul { margin: 0; padding-left: 1.2rem; }
  .notice { margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: #fde4e1; color: #7a1f17; }
  .ok { margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: #dff3e6; color: #13472a; }
  label { display: grid; gap: 0.3rem; font-weight: 600; }
  input, select, textarea { font: inherit; padding: 0.55rem 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); background: #fff; color: inherit; }
  .check { display: flex; gap: 0.5rem; align-items: start; font-weight: 400; }
  .rider { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0.75rem; padding: 0.75rem 0; border-top: 1px solid var(--border); }
  button, .button { font: inherit; font-weight: 700; padding: 0.65rem 1.1rem; border: 0; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); cursor: pointer; text-decoration: none; justify-self: start; }
  .button.light { background: var(--muted); color: var(--foreground); }
  .code { width: min(16rem, 100%); padding: 0.6rem; border-radius: var(--radius); background: #fff; box-shadow: 0 0 0 1px var(--border); }
  .code svg { display: block; width: 100%; height: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  .jobs { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.9rem; margin: 0; padding: 0; list-style: none; }
  .job { display: grid; gap: 0.35rem; align-content: start; padding: 0.9rem 1rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .job p { margin: 0; }
  .job form { display: grid; gap: 0.4rem; }
  .stage { color: var(--primary); font-weight: 700; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; }
  .facts dt { color: var(--muted-foreground); }
  .facts dd { margin: 0; }
  .choices { display: grid; gap: 0.35rem; margin: 0; padding: 0.6rem 0.8rem; border: 1px solid var(--border); border-radius: 0.5rem; }
  .tag { display: grid; gap: 0.6rem; justify-items: start; padding: 1.25rem; border: 2px dashed var(--border); border-radius: var(--radius); background: var(--card); }
  @media print { .concept, .site-head, .site-foot { display: none; } .tag a { display: none; } }
  .site-foot { padding: 1.5rem clamp(1rem, 4vw, 2.5rem) 2.5rem; color: var(--muted-foreground); font-size: 0.9rem; }
`;

export function layout({ title, shop, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escape(title)} · ${escape(shop.name)}</title>
  <style>${STYLE}</style>
</head>
<body>
  <p class="concept">${escape(shop.concept)}</p>
  <header class="site-head"><a href="/">${escape(shop.name)}</a><span>${escape(shop.town)} · ${escape(shop.phone)}</span></header>
  <main>
    ${body}
  </main>
  <footer class="site-foot"><a href="/">Track a job</a> · <a href="/shop">The shop (staff)</a></footer>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
