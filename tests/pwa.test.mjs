import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const dist = new URL('../dist/', import.meta.url);
const read = (path, encoding) => readFile(new URL(path, dist), encoding);
const origin = 'https://monstertrade.example';

test('the installed app launches in scope with correctly sized local icons', async () => {
  const html = await read('index.html', 'utf8');
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/assets\/apple-touch-icon\.png"/);

  const manifest = JSON.parse(await read('manifest.webmanifest', 'utf8'));
  const manifestURL = new URL('/manifest.webmanifest', origin);
  const scope = new URL(manifest.scope, manifestURL);
  const launch = new URL(manifest.start_url, manifestURL);
  assert.equal(manifest.display, 'standalone');
  assert.equal(launch.href, `${origin}/`);
  assert.equal(scope.href, launch.href);
  assert.equal(new URL(manifest.id, manifestURL).href, scope.href);
  assert.deepEqual(manifest.icons.map(({sizes, purpose}) => [sizes, purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable'],
  ]);
  for (const {src, sizes, type} of [...manifest.icons, {src: './assets/apple-touch-icon.png', sizes: '180x180', type: 'image/png'}]) {
    assert.equal(new URL(src, manifestURL).origin, origin);
    assert.equal(type, 'image/png');
    const png = await read(src);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, sizes);
  }
});

test('the offline shell caches bundled files and leaves API requests on the network', async () => {
  const handlers = new Map();
  const saved = new Map();
  const cache = {
    async addAll(requests) {
      for (const request of requests) {
        assert.equal(request.cache, 'reload');
        const url = new URL(request.url);
        assert.equal(url.origin, origin);
        const value = await read(url.pathname.slice(1) || 'index.html');
        saved.set(request.url, new Response(value));
      }
    },
    async put(key, response) { saved.set(key, response); },
  };
  let offline = false;
  runInNewContext(await read('sw.js', 'utf8'), {
    URL, Request, Response,
    self: { registration: {scope: `${origin}/`}, location: {origin}, addEventListener: (type, listener) => handlers.set(type, listener) },
    caches: {open: async () => cache, match: async key => saved.get(key)?.clone()},
    fetch: async () => {
      if (offline) throw new Error('No network');
      return new Response('Latest version');
    },
  });
  let installing;
  handlers.get('install')({waitUntil: task => { installing = task; }});
  await installing;
  for (const file of await readdir(dist)) {
    if (file.endsWith('.js') && file !== 'sw.js') assert.ok(saved.has(`${origin}/${file}`), `${file} is missing from the offline shell`);
  }

  function request(path, options = {}) {
    let result;
    handlers.get('fetch')({
      request: {url: new URL(path, origin).href, method: 'GET', mode: 'same-origin', headers: new Headers(), ...options},
      respondWith: response => { result = response; },
    });
    return result;
  }

  assert.equal(await (await request('/app.js')).text(), 'Latest version');
  offline = true;
  assert.equal(await (await request('/app.js')).text(), 'Latest version');
  assert.match(await (await request('/', {mode: 'navigate'})).text(), /<title>Monstertrade/);
  assert.match(await (await request('/index.html', {mode: 'navigate'})).text(), /<title>Monstertrade/);
  assert.equal(request('/api/health'), undefined);
  assert.equal(request('/api/prices?ids=base1-4'), undefined);
  assert.equal(request('/app.js', {method: 'POST'}), undefined);
  assert.equal(request('https://example.com/app.js'), undefined);
});
