import test from 'node:test';
import assert from 'node:assert/strict';

let moduleNumber = 0;
const freshCatalog = () => import(`../dist/catalog.js?test=${++moduleNumber}`);
const card = () => ({
  id: 'sv03.5-001', name: 'Bulbasaur', localId: '001',
  image: 'https://assets.tcgdex.net/en/sv/sv03.5/001',
  set: { id: 'sv03.5', name: '151', cardCount: { total: 207 } },
  rarity: 'Common',
  pricing: { cardmarket: { unit: 'EUR', trend: 0.14, updated: '2026-11-23T05:47:41.981Z' } },
});
const response = value => ({ ok: true, json: async () => structuredClone(value) });

test('normalizes EUR catalogue details without inventing unavailable prices', async () => {
  const { normalizeCard } = await freshCatalog();
  const expected = normalizeCard(card(), 'it');
  assert.equal(expected.price, 0.14);
  assert.equal(expected.priceUpdated, '2026-11-23T05:47:41.981Z');
  assert.equal(expected.priceSource, 'Cardmarket trend · EUR');
  assert.equal(expected.localId, '001');
  assert.equal(expected.lang, 'it');
  assert.equal(expected.setTotal, 207);

  for (const trend of [undefined, null, 0, -1, Infinity, NaN, '14']) {
    const source = card();
    source.pricing.cardmarket.trend = trend;
    const normalized = normalizeCard(source);
    assert.equal(normalized.price, null);
    assert.equal(normalized.priceSource, null);
    assert.equal(normalized.priceUpdated, null);
  }
  const usd = card();
  usd.pricing.cardmarket.unit = 'USD';
  assert.equal(normalizeCard(usd).price, null);
  assert.equal(normalizeCard({ id: 'test-1', name: 'Unpriced card' }).price, null);
  assert.equal(normalizeCard({ id: 'test-1', name: 'Unpriced card' }).image, '');
  const invalidDate = card();
  invalidDate.pricing.cardmarket.updated = 'not a date';
  assert.equal(normalizeCard(invalidDate).priceUpdated, null);
  assert.throws(() => normalizeCard(null), /incomplete/);
});

test('image URLs are restricted to catalogue assets or simple bundled asset paths', async () => {
  const { cardImage } = await freshCatalog();
  const source = card();
  assert.equal(cardImage(source), `${source.image}/low.webp`);
  assert.equal(cardImage(source, 'high'), `${source.image}/high.webp`);
  assert.equal(cardImage({ ...source, localImage: 'assets/example.webp' }), 'assets/example.webp');
  assert.equal(cardImage({ image: `${source.image}/high.webp` }), `${source.image}/high.webp`);
  for (const image of ['javascript:alert(1)', 'http://assets.tcgdex.net/card', 'https://example.com/card', '//example.com/card', '', null]) {
    assert.equal(cardImage({ image }), '');
  }
  assert.equal(cardImage({ localImage: 'assets/../../secret.webp' }), '');
  assert.equal(cardImage(undefined), '');
});

test('card cache deduplicates, isolates callers and respects forced refresh and language', async t => {
  const { getCard } = await freshCatalog();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return response(card());
  });
  const [first, second] = await Promise.all([getCard('sv03.5-001'), getCard('sv03.5-001')]);
  assert.equal(calls, 1);
  first.name = 'Mutation';
  assert.equal(second.name, 'Bulbasaur');
  assert.equal((await getCard('sv03.5-001')).name, 'Bulbasaur');
  assert.equal(calls, 1);
  await getCard('sv03.5-001', 'en', true);
  assert.equal(calls, 2);
  await getCard('sv03.5-001', 'it');
  assert.equal(calls, 3);
});

test('search encodes terms, page and language while preserving card-number strings', async t => {
  const { searchCards } = await freshCatalog();
  let captured;
  t.mock.method(globalThis, 'fetch', async url => {
    captured = new URL(url);
    return response([card(), { id: 'no-image', name: 'Missing image', localId: 7 }, null]);
  });
  assert.deepEqual(await searchCards('   '), []);
  assert.equal(captured, undefined);
  const result = await searchCards('  Bulbasaur & friends  ', 'it', 2);
  assert.equal(captured.pathname, '/v2/it/cards');
  assert.equal(captured.searchParams.get('name'), 'Bulbasaur & friends');
  assert.equal(captured.searchParams.get('pagination:page'), '2');
  assert.equal(captured.searchParams.get('pagination:itemsPerPage'), '24');
  assert.equal(result.length, 2);
  assert.equal(result[0].localId, '001');
  assert.equal(result[0].lang, 'it');
  assert.equal(result[1].localId, '7');
  assert.equal(result[1].image, '');
  await assert.rejects(searchCards('Pikachu', 'en', 0), /page/);
  await assert.rejects(searchCards('Pikachu', '../en'), /language/);
});

test('set endpoints use the selected language and cached sets cannot be mutated by callers', async t => {
  const { getSet, getSets } = await freshCatalog();
  const urls = [];
  const set = { id: 'sv03.5', name: '151', cards: [{ id: 'sv03.5-001', name: 'Bulbasaur' }] };
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(url);
    return response(url.endsWith('/sets') ? [{ id: set.id, name: set.name }] : set);
  });
  const first = await getSet('sv03.5', 'it');
  first.cards[0].name = 'Changed';
  assert.equal((await getSet('sv03.5', 'it')).cards[0].name, 'Bulbasaur');
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith('/v2/it/sets/sv03.5'));
  assert.deepEqual(await getSets('ja'), [{ id: 'sv03.5', name: '151' }]);
  assert.ok(urls[1].endsWith('/v2/ja/sets'));
  await assert.rejects(getSet('../secret'), /valid TCGdex/);
});

test('network and provider failures have actionable messages and can be retried', async t => {
  const { getCard } = await freshCatalog();
  let status = 404;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status }));
  await assert.rejects(getCard('base1-4'), /selected language/);
  status = 429;
  await assert.rejects(getCard('base1-4'), /Wait a moment/);
  status = 503;
  await assert.rejects(getCard('base1-4'), /HTTP 503/);
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(getCard('base1-4'), /internet connection/);
});

test('a stalled request aborts after twelve seconds without real waiting', async t => {
  const { getCard } = await freshCatalog();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  const rejected = assert.rejects(getCard('base1-4'), /took too long/);
  t.mock.timers.tick(11_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
});
