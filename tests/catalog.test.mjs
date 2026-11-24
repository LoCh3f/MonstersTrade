import test from 'node:test';
import assert from 'node:assert/strict';
import { latinCardName } from '../dist/pokemon-search.js';

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

test('variant choices keep scoped identifiers and translated labels without assigning prices', async () => {
  const { normalizeCard } = await freshCatalog();
  const source = card();
  source.variants_detailed = [
    { variantId: 'normal-1', type: 'Normale', size: 'standard', pricing: { cardmarket: { trend: 99 } } },
    { variantId: 'reverse-1', type: 'Reverse', foil: 'Cosmo', stamp: ['set-logo'], size: 'standard' },
    { variantId: 'normal-1', type: 'Duplicate' },
    { variantId: '../invalid', type: 'Invalid' },
    null,
  ];
  const normalized = normalizeCard(source, 'it');
  assert.deepEqual(normalized.variantOptions, [
    { id: 'normal-1', label: 'Normale', type: 'Normale', foil: '', stamp: [] },
    { id: 'reverse-1', label: 'Reverse · Cosmo · set-logo', type: 'Reverse', foil: 'Cosmo', stamp: ['set-logo'] },
  ]);
  assert.equal(normalized.price, 0.14);
  assert.equal(normalized.variantOptions[0].quote, undefined);
  assert.equal(normalizeCard({ ...source, variants_detailed: undefined }).variantOptions.length, 0);
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

test('direct card ID search stays in the selected catalogue and preserves the returned identity', async t => {
  const { searchCards } = await freshCatalog();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return response({ id: 'SV2a-025', name: 'ピカチュウ', localId: '025', set: { id: 'SV2a', name: 'ポケモンカード151' } });
  });
  const [result] = await searchCards('sv2a-025', 'ja');
  assert.equal(result.id, 'SV2a-025');
  assert.equal(result.lang, 'ja');
  assert.deepEqual(await searchCards('sv2a-025', 'ja', 2), []);
  assert.deepEqual(requests, ['https://api.tcgdex.net/v2/ja/cards/sv2a-025']);
});

test('a Latin Pokémon name searches the selected Asian catalogue by exact Pokédex ID', async t => {
  const { searchCards } = await freshCatalog();
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(new URL(url));
    return response([{ id: 'SV2a-025', name: 'ピカチュウ', localId: '025' }]);
  });
  const [result] = await searchCards('Pika', 'ja');
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, '/v2/ja/cards');
  assert.equal(urls[0].searchParams.get('dexId'), 'eq:25');
  assert.equal(result.name, 'ピカチュウ');
  assert.equal(result.id, 'SV2a-025');
  assert.equal(result.setId, 'SV2a');
  assert.equal(result.lang, 'ja');
  assert.equal(latinCardName(result), 'Pikachu');
  assert.equal(latinCardName({ name: 'ミュウツー&ミュウGX', lang: 'ja' }), 'Mewtwo & Mew GX');
});

test('Japanese set qualifiers and the printed ex spelling select the correct printings', async t => {
  const { searchCards } = await freshCatalog();
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const parsed = new URL(url);
    urls.push(parsed);
    if (parsed.pathname.endsWith('/sets')) return response([{ id: 'SV2a', name: 'ポケモンカード151' }]);
    return response([{ id: 'SV2a-201', name: 'リザードンex', localId: '201' }]);
  });
  const [card] = await searchCards('Charizard ex 151', 'ja');
  assert.equal(latinCardName(card), 'Charizard ex');
  assert.equal(urls[1].searchParams.get('set.id'), 'eq:SV2a');
  assert.equal(urls[1].searchParams.get('name'), 'eq:リザードンex');
  await searchCards('Charizard EX', 'ja');
  assert.equal(urls[2].searchParams.get('name'), 'eq:リザードンEX');
  await searchCards('リザードンex', 'ja');
  assert.equal(urls[3].searchParams.get('name'), 'リザードンex');
});

test('localized name fallback keeps its pagination when Pokédex metadata is incomplete', async t => {
  const { searchCards } = await freshCatalog();
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const params = new URL(url).searchParams;
    urls.push(params);
    return response(params.has('dexId') ? [] : [{ id: 'SV4M-001', name: '비구술', localId: '001' }]);
  });
  const [card] = await searchCards('Surskit', 'ko', 2);
  assert.equal(card.lang, 'ko');
  assert.equal(latinCardName(card), 'Surskit');
  assert.equal(urls[0].get('dexId'), 'eq:283');
  assert.equal(urls[0].get('pagination:page'), '1');
  assert.equal(urls[1].get('name'), '비구술');
  assert.equal(urls[1].get('pagination:page'), '2');
});

test('verified Italian Trainer names search Japanese printings without changing the original title', async t => {
  const { searchCards } = await freshCatalog();
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(new URL(url));
    return response([{ id: 'SV-P-016', name: 'ふしぎなアメ', localId: '016' }]);
  });
  const [card] = await searchCards('Caramella Rara', 'ja');
  assert.equal(card.name, 'ふしぎなアメ');
  assert.equal(card.lang, 'ja');
  assert.equal(latinCardName(card), 'Rare Candy');
  assert.equal(urls[0].searchParams.get('name'), 'ふしぎなアメ');
  assert.equal(urls[0].searchParams.get('dexId'), null);
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
