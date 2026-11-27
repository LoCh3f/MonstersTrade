const cachePrefix = 'monstertrade-static-';
const cacheName = `${cachePrefix}v4`;
const scope = self.registration.scope;
const launchURL = new URL(scope);
const indexURL = new URL('index.html', scope);
const assets = new Set([
  '', 'manifest.webmanifest', 'styles.css', 'featured.json', 'POKEAPI-LICENSE.txt',
  'app.js', 'card-offers.js', 'catalog.js', 'import-worker.js', 'install.js', 'languages.js', 'model.js',
  'photos.js', 'pokemon-names.js', 'pokemon-search.js', 'price-client.js', 'price-view.js',
  'pricing.js', 'regional-catalogue.js', 'sealed-client.js', 'sealed-view.js',
  'assets/monstertrade-logo.jpg', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png',
  'assets/sv03.5-198.webp', 'assets/sv03.5-199.webp', 'assets/sv03.5-200.webp',
  'assets/sv03.5-205.webp', 'assets/sv08-238.webp', 'assets/swsh7-215.webp',
].map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll([...assets].map(url => new Request(url, { cache: 'reload' }))),
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Network-first keeps the installable app current across deployments. Only the
// bundled static shell has an offline fallback, so API responses stay live.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Range')) return;
  const url = new URL(request.url);
  const isLaunch = request.mode === 'navigate' && url.origin === launchURL.origin
    && (url.pathname === launchURL.pathname || url.pathname === indexURL.pathname);
  const key = isLaunch ? launchURL.href : url.href;
  if (!assets.has(key)) return;
  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(request);
    } catch {
      return await caches.match(key, { cacheName }) || Response.error();
    }
    if (response.status === 200 && !response.redirected) {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(key, response.clone());
      } catch {
        // Browsing still works when browser storage is full or unavailable.
      }
    }
    return response;
  })());
});
