// A plain HTTP client with a cookie jar, for the payment tests.
export async function served(server) {
  // A second visitor to the same server: its own cookies, the same address.
  if (!server.listening) await new Promise((done) => server.listen(0, done));
  const base = `http://localhost:${server.address().port}`;
  const jar = new Map();
  const call = async (path, init = {}) => {
    const response = await fetch(new URL(path, base), { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
      else jar.delete(pair.slice(0, at));
    }
    const location = decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
    return { status: response.status, location, text: await response.text(), headers: response.headers };
  };
  const post = (path, form) => call(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const close = () => new Promise((done) => (server.closeAllConnections?.(), server.close(done)));
  await call('/');
  return { server, base, call, post, close };
}
