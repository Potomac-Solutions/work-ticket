// Static files: the stylesheets, icon and photographs in public/, and the two typefaces from @fontsource.
//
// Everything is read once at start and served from memory at /assets/<name>. Each file's address
// carries a short hash of its bytes (`asset('site.css')` → /assets/site.css?v=1a2b3c4d), so it can
// be cached for a year and still change the moment the file does.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TYPES = { '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

/** The faces the pages use: [family, weight, style, package, file]. Latin only, a few KB each. */
export const FONTS = [
  ['Fraunces', 600, 'normal', '@fontsource/fraunces', 'fraunces-latin-600-normal.woff2'],
  ['JetBrains Mono', 500, 'normal', '@fontsource/jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2'],
  ['Plus Jakarta Sans', 400, 'normal', '@fontsource/plus-jakarta-sans', 'plus-jakarta-sans-latin-400-normal.woff2'],
  ['Plus Jakarta Sans', 600, 'normal', '@fontsource/plus-jakarta-sans', 'plus-jakarta-sans-latin-600-normal.woff2'],
  ['Plus Jakarta Sans', 700, 'normal', '@fontsource/plus-jakarta-sans', 'plus-jakarta-sans-latin-700-normal.woff2'],
];

const files = new Map();
const add = (name, path) => {
  const body = readFileSync(path);
  files.set(name, { body, type: TYPES[extname(name)] ?? 'application/octet-stream', version: createHash('sha256').update(body).digest('hex').slice(0, 8) });
};
const publicDir = join(here, '..', 'public');
for (const name of readdirSync(publicDir)) if (TYPES[extname(name)]) add(name, join(publicDir, name));
// Photographs: public/photos/<name>.jpg (or .webp). Drop a file in and restart; nothing else to change.
const photoDir = join(publicDir, 'photos');
if (existsSync(photoDir)) for (const name of readdirSync(photoDir)) if (/\.(jpg|webp)$/.test(name)) add(`photos/${name}`, join(photoDir, name));
for (const [, , , pkg, file] of FONTS) add(file, join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file));

/** The address of a static file, with its version. */
export const asset = (name) => {
  const file = files.get(name);
  if (!file) throw new Error(`No such asset: ${name}`);
  return `/assets/${name}?v=${file.version}`;
};

/** A photograph's address by name (`photo('hero')`), or '' when there's no such file: the page copes without it. */
export const photo = (name) => (files.has(`photos/${name}.webp`) ? asset(`photos/${name}.webp`) : files.has(`photos/${name}.jpg`) ? asset(`photos/${name}.jpg`) : '');

/** The @font-face rules, inlined in the page head so text never waits on a stylesheet for them. */
export const FONT_CSS = FONTS.map(([family, weight, style, , file]) => `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};font-display:swap;src:url(${asset(file)}) format("woff2")}`).join('');

/** Serve /assets/<name>. True when the request was one of ours. */
export function serveAsset(req, res, url) {
  if (!url.pathname.startsWith('/assets/')) return false;
  const file = files.get(url.pathname.slice('/assets/'.length));
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return true;
  }
  // A versioned address never changes what it serves; an unversioned one is checked each time.
  res.writeHead(200, { 'content-type': file.type, 'content-length': file.body.length, 'cache-control': url.searchParams.get('v') === file.version ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : file.body);
  return true;
}
