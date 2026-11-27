import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, addCard, applyMarketUpdate } from '../dist/model.js';

let sequence = 0;
const client = () => import(`../dist/price-client.js?test=${++sequence}`);
const flush = () => new Promise(resolve => setImmediate(resolve));
const timestamp = '2026-11-23T05:47:41.981Z';
const fetchedAt = '2026-11-23T06:00:00.000Z';

const quote = (extra = {}) => ({
  amount: 0.14, currency: 'EUR', source: 'Cardmarket via TCGdex', metric: 'trend',
  productId: 733596, providerUpdatedAt: timestamp, fetchedAt, lastAttemptAt: fetchedAt,
  lastError: null, mapping: 'generic', ...extra,
});
const bundle = (cardId = 'sv03.5-001', extra = {}) => ({
  cardId, reference: quote(), variants: [{ id: 'normal-1', label: 'Normal', type: 'normal', foil: '', stamp: [], quote: quote({ mapping: 'unverified', amount: null }) }],
  fetchedAt, lastAttemptAt: fetchedAt, lastError: null, ...extra,
});
const response = (value, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status, headers: new Headers(headers),
  json: async () => structuredClone(value), body: { cancel: async () => {} },
});

function storage(t, initial = {}) {
  const values = new Map(Object.entries(initial));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'localStorage', original) : delete globalThis.localStorage);
  return values;
}

test('prices deduplicate, isolate cache readers, and send identifiers only to the same origin', async t => {
  const saved = storage(t);
  const api = await client();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return response({ ...bundle(), quantity: 100, cost: 400, secret: 'never-persist' });
  });
  const [first, second] = await Promise.all([api.getPrices('sv03.5-001'), api.getPrices('sv03.5-001')]);
  assert.equal(requests.length, 1);
  first.reference.amount = 999;
  first.variants[0].label = 'Changed';
  assert.equal(second.reference.amount, 0.14);
  assert.equal((await api.getPrices('sv03.5-001')).variants[0].label, 'Normal');
  assert.equal(requests.length, 1);
  await api.getPrices('sv03.5-001', { force: true, quantity: 99, cost: 500 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, '/api/prices/sv03.5-001');
  assert.equal(requests[1].url, '/api/prices/sv03.5-001?refresh=1');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.mode, 'same-origin');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.body, undefined);
  assert.equal(first.quantity, undefined);
  assert.doesNotMatch(saved.get('pocketvault.prices.v1'), /quantity|cost|secret|never-persist/);
});

test('persisted public cache survives reload and remains bounded', async t => {
  const saved = storage(t);
  const api = await client();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    return response(bundle(url.split('/').at(-1)));
  });
  for (let number = 0; number < 102; number++) await api.getPrices(`base1-${number}`);
  const disk = JSON.parse(saved.get('pocketvault.prices.v1'));
  assert.equal(disk.entries.length, 100);
  assert.equal(disk.entries[0].cardId, 'base1-2');
  const reloaded = await client();
  assert.equal((await reloaded.getPrices('base1-101')).cardId, 'base1-101');
  assert.equal(calls, 102);
  await reloaded.getPrices('base1-0');
  assert.equal(calls, 103);
});

test('CardTrader offers are requested by printing language and can succeed independently of the market trend', async t => {
  storage(t);
  const api = await client();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push(path);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.body, undefined);
    if (path.startsWith('/api/card-offers/')) return response({ blueprintId: 406809, currency: 'EUR', language: 'it', observedAt: timestamp, prices: {'Near Mint': 1730} });
    return response({}, 503, {'Retry-After': '900'});
  });
  const result = await api.getPrices('30th-148', {lang: 'it', cost: 20, condition: 'Excellent'});
  assert.deepEqual(requests.sort(), ['/api/card-offers/30th-148?lang=it', '/api/prices/30th-148']);
  assert.equal(result.cardOffers.prices['Near Mint'], 1730);
  assert.match(result.lastError, /503/);
});

test('localized quotes stay separate across simultaneous requests and cache reloads', async t => {
  storage(t);
  const api = await client();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    const language = new URL(url, 'https://example.test').searchParams.get('lang');
    return response(language === 'ja'
      ? bundle('SV2a-025', { catalogueLanguage: 'ja', reference: quote({ amount: 12 }) })
      : bundle('sv2a-025'));
  });
  const [english, japanese] = await Promise.all([api.getPrices('sv2a-025'), api.getPrices('sv2a-025', { lang: 'ja' })]);
  assert.equal(english.reference.amount, 0.14);
  assert.equal(japanese.reference.amount, 12);
  assert.equal(japanese.cardId, 'sv2a-025');
  const reloaded = await client();
  assert.equal((await reloaded.getPrices('SV2a-025', { lang: 'ja' })).cardId, 'SV2a-025');
  assert.deepEqual(requests, ['/api/prices/sv2a-025', '/api/prices/sv2a-025?lang=ja']);
  await assert.rejects(reloaded.getPrices('sv2a-025', { lang: 'ko' }), /mismatched card details/);
});

test('broken or unavailable browser storage does not break price requests', async t => {
  storage(t, { 'pocketvault.prices.v1': '{not-json' });
  const api = await client();
  t.mock.method(globalThis.localStorage, 'setItem', () => { throw new Error('Quota exceeded'); });
  t.mock.method(globalThis, 'fetch', async () => response(bundle()));
  assert.equal((await api.getPrices('sv03.5-001')).reference.amount, 0.14);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  const noStorage = await client();
  assert.equal((await noStorage.getPrices('sv03.5-001')).reference.amount, 0.14);
  Object.defineProperty(globalThis, 'localStorage', original);
});

test('failed refresh retains earlier prices and provider dates with a visible failure and cooldown', async t => {
  storage(t);
  const api = await client();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return response(bundle());
    throw new TypeError('Offline');
  });
  await api.getPrices('sv03.5-001');
  const fallback = await api.getPrices('sv03.5-001', { force: true });
  assert.equal(fallback.reference.amount, 0.14);
  assert.equal(fallback.reference.providerUpdatedAt, timestamp);
  assert.equal(fallback.reference.fetchedAt, fetchedAt);
  assert.equal(fallback.fetchedAt, fetchedAt);
  assert.match(fallback.lastError, /Cannot reach/);
  assert.equal(fallback.reference.lastError, fallback.lastError);
  assert.equal(fallback.variants[0].quote.lastError, fallback.lastError);
  await api.getPrices('sv03.5-001', { force: true });
  assert.equal(calls, 2);
  await assert.rejects(api.getPrices('other-1'), /Previous references are retained/);
  assert.equal(calls, 3);
});

test('a successful missing price remains missing rather than borrowing an old amount', async t => {
  storage(t);
  const api = await client();
  let missing = false;
  t.mock.method(globalThis, 'fetch', async () => response(bundle('sv03.5-001', {
    reference: quote({ amount: missing ? null : 0.14 }),
  })));
  await api.getPrices('sv03.5-001');
  missing = true;
  assert.equal((await api.getPrices('sv03.5-001', { force: true })).reference.amount, null);
});

test('offline then online against unchanged shared cache clears the local failure without changing quote dates', async t => {
  storage(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00.000Z') });
  const api = await client();
  let offline = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (offline) throw new TypeError('Offline');
    return response(bundle());
  });
  let holding = addCard(emptyState(), { id: 'sv03.5-001', name: 'Bulbasaur', market: quote() }).collection[0];
  holding = applyMarketUpdate(holding, await api.getPrices(holding.id));
  assert.equal(holding.market.lastAttemptAt, '2026-11-23T12:00:00.000Z');
  t.mock.timers.tick(1000);
  offline = true;
  holding = applyMarketUpdate(holding, await api.getPrices(holding.id, { force: true }));
  assert.match(holding.market.lastError, /Cannot reach/);
  t.mock.timers.tick(31_000);
  offline = false;
  holding = applyMarketUpdate(holding, await api.getPrices(holding.id, { force: true }));
  assert.equal(holding.market.lastError, null);
  assert.equal(holding.market.lastAttemptAt, '2026-11-23T12:00:32.000Z');
  assert.equal(holding.market.fetchedAt, fetchedAt);
  assert.equal(holding.market.providerUpdatedAt, timestamp);
});

test('cached delivery records a local check but retains acquisition time and provider errors', async t => {
  storage(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-23T12:00:00.000Z') });
  const api = await client();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response(bundle('sv03.5-001', {
      lastError: 'Provider unavailable', reference: quote({ lastError: 'Provider unavailable' }),
    }));
  });
  await api.getPrices('sv03.5-001');
  t.mock.timers.tick(1000);
  const cached = await api.getPrices('sv03.5-001');
  assert.equal(calls, 1);
  assert.equal(cached.lastAttemptAt, '2026-11-23T12:00:01.000Z');
  assert.equal(cached.reference.lastAttemptAt, cached.lastAttemptAt);
  assert.equal(cached.variants[0].quote.lastAttemptAt, cached.lastAttemptAt);
  assert.equal(cached.fetchedAt, fetchedAt);
  assert.equal(cached.reference.fetchedAt, fetchedAt);
  assert.equal(cached.reference.providerUpdatedAt, timestamp);
  assert.equal(cached.lastError, 'Provider unavailable');
  assert.equal(cached.reference.lastError, 'Provider unavailable');
});

test('older server snapshots cannot roll the cache backwards', async t => {
  storage(t);
  const api = await client();
  let older = false;
  t.mock.method(globalThis, 'fetch', async () => response(bundle('sv03.5-001', older ? {
    fetchedAt: '2026-11-20T06:00:00.000Z', reference: quote({ amount: 0.01, fetchedAt: '2026-11-20T06:00:00.000Z' }),
  } : {})));
  await api.getPrices('sv03.5-001');
  older = true;
  const result = await api.getPrices('sv03.5-001', { force: true });
  assert.equal(result.reference.amount, 0.14);
  assert.equal(result.fetchedAt, fetchedAt);
  assert.match(result.lastError, /older snapshot/);
});

test('invalid identifiers and malformed/mismatched prices never enter the cache', async t => {
  storage(t);
  const api = await client();
  let calls = 0;
  let value = bundle('other-1');
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(value); });
  for (const bad of ['../private', 'https://example.com', '', {}, 'a?cost=1']) await assert.rejects(api.getPrices(bad), /identifier/);
  assert.equal(calls, 0);
  await assert.rejects(api.getPrices('sv03.5-001'), /mismatched/);
  value = bundle('usd-1', { reference: quote({ currency: 'USD' }) });
  await assert.rejects(api.getPrices('usd-1'), /EUR/);
  value = bundle('wrong-1', { reference: quote({ amount: '1' }) });
  await assert.rejects(api.getPrices('wrong-1'), /EUR/);
  value = bundle('duplicate-1');
  value.variants.push(value.variants[0]);
  await assert.rejects(api.getPrices('duplicate-1'), /variant/);
});

test('429 long Retry-After does not trigger an early retry, including forced refresh', async t => {
  storage(t);
  const api = await client();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response({}, 429, { 'Retry-After': '60' });
  });
  await assert.rejects(api.getPrices('sv03.5-001'), /busy/);
  await assert.rejects(api.getPrices('sv03.5-001', { force: true }), /busy/);
  assert.equal(calls, 1);
});

test('503 permits one bounded retry with Retry-After and no real wait', async t => {
  storage(t);
  const api = await client();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1 ? response({}, 503, { 'Retry-After': '2' }) : response(bundle());
  });
  const loading = api.getPrices('sv03.5-001');
  await flush();
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal((await loading).reference.amount, 0.14);
  assert.equal(calls, 2);
});

test('stalled service calls abort after twelve seconds without real waiting', async t => {
  storage(t);
  const api = await client();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const loading = assert.rejects(api.getPrices('sv03.5-001'), /took too long/);
  t.mock.timers.tick(11_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await loading;
  assert.equal(signal.aborted, true);
});

test('history only sends public identity and validates date, range, and response identity', async t => {
  storage(t);
  const api = await client();
  let requested;
  const history = { cardId: 'sv03.5-001', variantId: 'normal-1', retentionDays: 365, points: [
    { date: '2026-11-23', amount: 0.14, providerUpdatedAt: timestamp, fetchedAt, mapping: 'matched' },
  ] };
  t.mock.method(globalThis, 'fetch', async url => { requested = url; return response(history); });
  const result = await api.getPriceHistory('sv03.5-001', 'normal-1', 30);
  assert.equal(requested, '/api/prices/sv03.5-001/history?variant=normal-1&days=30');
  assert.equal(result.points[0].amount, 0.14);
  for (const days of [0, 366, 1.5, '30']) await assert.rejects(api.getPriceHistory('sv03.5-001', null, days), /period/);
  await assert.rejects(api.getPriceHistory('sv03.5-001', '../invalid'), /identifier/);
  await assert.rejects(api.getPriceHistory('sv03.5-001', 'other-variant'), /mismatched/);
  history.points[0].date = '2026-02-31';
  await assert.rejects(api.getPriceHistory('sv03.5-001', 'normal-1'), /observations/);
});

test('service health exposes only the public configured status', async t => {
  storage(t);
  const api = await client();
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, '/api/health');
    return response({ configured: true, service: 'public-prices', secret: 'not-returned' });
  });
  assert.deepEqual(await api.priceServiceHealth(), { configured: true, status: 'ready', retentionDays: 365 });
});
