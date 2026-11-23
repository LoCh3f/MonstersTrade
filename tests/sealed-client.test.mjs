import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
const client = () => import(`../dist/sealed-client.js?test=${++sequence}`);
const observed = '2026-11-22T00:00:00.000Z';
const acquired = '2026-11-23T06:00:00.000Z';
const id = 'sealed-tcgp-673436-eu';
const product = (extra = {}) => ({
  id, kind: 'sealed', name: 'First Partner Illustration Collection (Series 1)', setName: 'First Partner Collection 2026',
  setId: '', lang: 'und', productType: 'collection-box', edition: '', productCode: '673436',
  productUrl: 'https://tcgprices.app/card/first-partner-illustration-collection-series-1', game: 'Pokémon',
  market: { amount: 43.9, currency: 'EUR', source: 'TCGPrices · EU retail', metric: 'store-low', productId: 673436,
    providerUpdatedAt: observed, fetchedAt: acquired, lastAttemptAt: acquired, lastError: null, mapping: 'matched' },
  storesInStock: 10, sourceProductType: 'Collection', fetchedAt: acquired, lastError: null, ...extra,
});
const response = (value, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => structuredClone(value) });

test('sealed requests deduplicate and disclose only public identity, never holding fields', async t => {
  const api = await client(); const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push({ url, options }); return response({ ...product(), cost: 100, quantity: 2, manualValuation: { amount: 400 } }); });
  const [one, two] = await Promise.all([api.getSealedProduct(id), api.getSealedProduct(id)]);
  assert.equal(requests.length, 1); one.market.amount = 999; assert.equal(two.market.amount, 43.9);
  assert.equal((await api.getSealedProduct(id)).market.amount, 43.9);
  await api.getSealedProduct(id, { force: true, cost: 500, quantity: 10 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `/api/sealed/${id}`); assert.equal(requests[1].url, requests[0].url);
  assert.equal(requests[0].options.credentials, 'omit'); assert.equal(requests[0].options.mode, 'same-origin');
  assert.equal(requests[0].options.redirect, 'error'); assert.equal(requests[0].options.body, undefined);
  assert.equal(two.cost, undefined); assert.equal(two.quantity, undefined); assert.equal(two.manualValuation, undefined);
});

test('catalogue filters are encoded, page identity is validated and foreign currency is rejected', async t => {
  const api = await client(); let requested;
  t.mock.method(globalThis, 'fetch', async url => { requested = url; return response({ items: [product()], total: 9, page: 2, pageSize: 24, fetchedAt: acquired }); });
  const result = await api.searchSealed('  box & collection  ', { type: 'collection-box', page: 2, privateNotes: 'never-send' });
  assert.equal(requested, '/api/sealed?q=box+%26+collection&type=collection-box&page=2'); assert.equal(result.items[0].market.currency, 'EUR');
  for (const query of [null, {}, 'x'.repeat(161), '\u0000']) await assert.rejects(api.searchSealed(query), /search/);
  await assert.rejects(api.searchSealed('', { type: 'single-card' }), /type/);
  await assert.rejects(api.searchSealed('', { page: 0 }), /page/);
  await assert.rejects(api.searchSealed('another', { page: 1 }), /result page/);
  const otherApi = await client();
  t.mock.method(globalThis, 'fetch', async () => response(product({ market: { ...product().market, currency: 'USD' } })));
  await assert.rejects(otherApi.getSealedProduct(id), /EUR retail/);
});

test('failed refresh retains observation dates and price, respects cooldown, and recovers', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00Z') });
  const api = await client(); let offline = false; let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; if (offline) throw new TypeError('offline'); return response(product()); });
  await api.getSealedProduct(id); offline = true;
  const failed = await api.getSealedProduct(id, { force: true });
  assert.equal(failed.market.amount, 43.9); assert.equal(failed.market.providerUpdatedAt, observed); assert.equal(failed.market.fetchedAt, acquired);
  assert.match(failed.lastError, /Cannot reach/); assert.equal(failed.market.lastError, failed.lastError);
  await api.getSealedProduct(id, { force: true }); assert.equal(calls, 2);
  t.mock.timers.tick(31_000); offline = false;
  const recovered = await api.getSealedProduct(id, { force: true });
  assert.equal(recovered.lastError, null); assert.equal(recovered.market.lastError, null);
  assert.equal(recovered.market.lastAttemptAt, '2026-11-23T12:00:31.000Z'); assert.equal(recovered.market.fetchedAt, acquired);
});

test('dated observations cannot roll backwards and successful missing quotes remain missing', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00Z') });
  const api = await client(); let value = product();
  t.mock.method(globalThis, 'fetch', async () => response(value));
  await api.getSealedProduct(id);
  value = product({ market: { ...product().market, amount: 1, providerUpdatedAt: '2026-11-21T00:00:00Z' } });
  const retained = await api.getSealedProduct(id, { force: true });
  assert.equal(retained.market.amount, 43.9); assert.match(retained.lastError, /older snapshot/);
  t.mock.timers.tick(31_000);
  value = product({ market: { ...product().market, amount: null, providerUpdatedAt: null } });
  assert.equal((await api.getSealedProduct(id, { force: true })).market.amount, null);
});

test('malformed identities, dates, source links and product matches are rejected before caching', async t => {
  const api = await client(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(product()); });
  for (const invalid of ['../private', 'https://tcgprices.app', {}, 'sealed-tcgp-01-eu', 'sealed-tcgp-673436-us']) await assert.rejects(api.getSealedProduct(invalid), /identifier/);
  assert.equal(calls, 0);
  for (const patch of [
    { productCode: '1' }, { productUrl: 'javascript:alert(1)' }, { productUrl: 'https://evil.example/card/product' },
    { lang: 'it' }, { fetchedAt: '2026-02-31' }, { market: { ...product().market, providerUpdatedAt: null } },
    { market: { ...product().market, productId: 1 } }, { storesInStock: -1 },
  ]) {
    const fresh = await client();
    t.mock.method(globalThis, 'fetch', async () => response(product(patch)));
    await assert.rejects(fresh.getSealedProduct(id));
  }
});

test('cache is bounded, expires after ten minutes, and isolates catalogue results', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00Z') });
  const api = await client(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({ items: [product()], total: 1, page: 1, pageSize: 24, fetchedAt: acquired }); });
  const first = await api.searchSealed('0'); first.items[0].name = 'mutated';
  assert.notEqual((await api.searchSealed('0')).items[0].name, 'mutated'); assert.equal(calls, 1);
  for (let i = 1; i <= 100; i++) await api.searchSealed(String(i));
  await api.searchSealed('0'); assert.equal(calls, 102);
  t.mock.timers.tick(600_001); await api.searchSealed('0'); assert.equal(calls, 103);
});

test('service timeout and Retry-After are bounded without real waits', async t => {
  const api = await client(); t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-11-23T12:00:00Z') });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { signal = options.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })); });
  const stalled = assert.rejects(api.getSealedProduct(id), /took too long/);
  t.mock.timers.tick(11_999); assert.equal(signal.aborted, false); t.mock.timers.tick(1); await stalled;
  const busyApi = await client(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response({}, 429, { 'Retry-After': '120' }); });
  await assert.rejects(busyApi.getSealedProduct(id), /busy/);
  t.mock.timers.tick(60_000); await assert.rejects(busyApi.getSealedProduct(id, { force: true }), /busy/); assert.equal(calls, 1);
  t.mock.timers.tick(60_001); await assert.rejects(busyApi.getSealedProduct(id), /busy/); assert.equal(calls, 2);
});

test('public history validates identity, currency and calendar dates and keeps stale observations on error', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00Z') });
  const api = await client(); let requested; let offline = false;
  const value = { productId: id, currency: 'EUR', points: [{ date: '2026-11-22', amount: 43.9, providerUpdatedAt: observed, fetchedAt: acquired }] };
  t.mock.method(globalThis, 'fetch', async url => { requested = url; if (offline) throw new TypeError('offline'); return response(value); });
  assert.equal((await api.getSealedHistory(id, 30)).points.length, 1); assert.equal(requested, `/api/sealed/${id}/history?days=30`);
  for (const days of [0, 366, 1.2, '30']) await assert.rejects(api.getSealedHistory(id, days), /period/);
  value.points[0].date = '2026-02-31'; await assert.rejects(api.getSealedHistory(id, 90), /invalid date/);
  t.mock.timers.tick(600_001); offline = true;
  const stale = await api.getSealedHistory(id, 30); assert.equal(stale.points[0].date, '2026-11-22'); assert.match(stale.lastError, /Cannot reach/);
});
