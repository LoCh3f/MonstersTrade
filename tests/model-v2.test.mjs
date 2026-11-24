import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeState, addCard, updateEntry, totals, recordSnapshot, exportCSV, importCSV, entryIdentity, applyMarketUpdate, effectivePrice, priceCoverage } from '../dist/model.js';

const date = '2026-11-23T12:00:00.000Z';
const reference = (overrides = {}) => ({ amount: 100, currency: 'EUR', source: 'Cardmarket via TCGdex', metric: 'trend', productId: 733794, providerUpdatedAt: date, fetchedAt: date, lastAttemptAt: date, lastError: null, mapping: 'generic', ...overrides });
const card = (overrides = {}) => ({ id: 'sv03.5-199', name: 'Charizard ex', localId: '199', setId: 'sv03.5', setName: '151', lang: 'en', price: 100, priceUpdated: date, market: reference(), ...overrides });
const entry = (overrides = {}) => addCard(emptyState(), card(overrides), { quantity: 2, cost: 80 }).collection[0];
const valuation = (amount = 250) => ({ amount, currency: 'EUR', updatedAt: date, note: 'Comparable listing checked', url: 'https://example.com/card' });
const bundle = (overrides = {}) => ({ cardId: 'sv03.5-199', reference: reference(), variants: [], fetchedAt: date, lastAttemptAt: date, lastError: null, ...overrides });
const option = (id, mapping = 'matched') => ({ id, label: id === 'reverse' ? 'Reverse holo' : 'Normal', type: id, stamp: [], foil: null, quote: reference({ amount: id === 'reverse' ? 180 : 100, mapping }) });

test('a familiar Pokémon title survives browser normalization and CSV round trips', () => {
  const state = addCard(emptyState(), card({
    id: 'SV2a-201', name: 'リザードンex', pokemonName: 'Charizard', localId: '201', setId: 'SV2a', lang: 'ja',
  }));
  const restored = importCSV(exportCSV(normalizeState(state)));
  const [saved] = restored.collection;
  assert.equal(saved.name, 'リザードンex');
  assert.equal(saved.pokemonName, 'Charizard');
  assert.equal(saved.lang, 'ja');
});

test('v1 migrates without guessing variants or changing IDs, quantities, weighted costs and history', () => {
  const legacy = {
    version: 1,
    collection: [{ id: 'sv03.5-001', name: 'Bulbasaur', localId: '001', lang: 'it', price: 0.38, priceUpdated: date, uid: 'original-row', quantity: 3, cost: 10 / 3, binderId: 'favorites', condition: 'Played', addedAt: '2025-01-01' }],
    wishlist: [{ id: 'base1-4', name: 'Charizard', uid: 'wish', target: 99, lang: 'en', price: null, addedAt: '2025-01-02' }],
    binders: [{ id: 'favorites', name: 'Favorites' }],
    history: [{ date: '2025-01-01', value: 1.14, cost: 10, quantity: 3, pricedQuantity: 3 }],
  };
  const before = JSON.stringify(legacy);
  const migrated = normalizeState(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.collection[0].uid, 'original-row');
  assert.equal(migrated.collection[0].quantity, 3);
  assert.equal(migrated.collection[0].cost, 10 / 3);
  assert.equal(migrated.collection[0].variantId, null);
  assert.equal(migrated.collection[0].grading, null);
  assert.equal(migrated.collection[0].market.source, 'Imported reference');
  assert.equal(migrated.collection[0].market.fetchedAt, null);
  assert.equal(migrated.collection[0].market.providerUpdatedAt, date);
  assert.equal(totals(migrated).cost, 10);
  assert.deepEqual(migrated.binders, legacy.binders);
  assert.equal(migrated.wishlist[0].uid, 'wish');
  assert.equal(migrated.history[0].value, 1.14);
  assert.equal(migrated.history[0].reason, 'legacy');
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('distinct finishes, grading and personal valuation evidence cannot be merged away', () => {
  let state = emptyState();
  state = addCard(state, card({ variantId: 'normal', variantLabel: 'Normal' }));
  state = addCard(state, card({ variantId: 'reverse', variantLabel: 'Reverse holo' }));
  state = addCard(state, card({ variantId: 'normal', grading: { company: 'PSA', grade: '10' } }));
  state = addCard(state, card({ variantId: 'normal', grading: { company: 'PSA', grade: '9' } }));
  state = addCard(state, card({ variantId: 'normal', manualValuation: valuation(150) }));
  state = addCard(state, card({ variantId: 'normal', manualValuation: valuation(175) }));
  assert.equal(state.collection.length, 6);
  assert.equal(new Set(state.collection.map(entryIdentity)).size, 6);
  const original = state.collection[4];
  state = addCard(state, card({ variantId: 'normal', manualValuation: valuation(150) }));
  assert.equal(state.collection.length, 6);
  assert.equal(state.collection.find(row => row.uid === original.uid).quantity, 2);
});

test('personal valuation is distinct from provider quote and survives price refresh', () => {
  const original = entry({ manualValuation: valuation(), grading: { company: 'PSA', grade: '10' } });
  const refreshed = applyMarketUpdate(original, bundle({ reference: reference({ amount: 110 }) }));
  assert.deepEqual(refreshed.manualValuation, original.manualValuation);
  assert.deepEqual(refreshed.grading, original.grading);
  assert.equal(refreshed.cost, 80);
  assert.equal(refreshed.quantity, 2);
  assert.equal(refreshed.market.amount, 110);
  assert.equal(effectivePrice(refreshed), 250);
  assert.equal(effectivePrice({ ...refreshed, manualValuation: null }), null);
  assert.equal(totals({ collection: [refreshed] }).value, 500);
  assert.equal(original.market.amount, 100);
});

test('selected variants require a matching verified quote; unrelated reference is never substituted', () => {
  const original = entry({ variantId: 'reverse', variantLabel: 'Reverse holo' });
  assert.equal(effectivePrice(original), null);
  const matched = applyMarketUpdate(original, bundle({ variants: [option('normal'), option('reverse')] }));
  assert.equal(effectivePrice(matched), 180);
  const uncertain = applyMarketUpdate(original, bundle({ variants: [option('reverse', 'unverified')] }));
  assert.equal(effectivePrice(uncertain), null);
  const absent = applyMarketUpdate(original, bundle());
  assert.equal(absent.market.mapping, 'unverified');
  assert.equal(absent.market.amount, null);
  assert.equal(effectivePrice(absent), null);
  assert.throws(() => applyMarketUpdate(original, bundle({ cardId: 'base1-4' })), /different card/);
});

test('Asian holdings retain marketplace evidence and require their own portfolio valuation', () => {
  const asian = entry({ lang: 'ja' });
  assert.throws(() => applyMarketUpdate(asian, bundle()), /different catalogue language/);
  const refreshed = applyMarketUpdate(asian, bundle({ catalogueLanguage: 'ja', reference: reference({ amount: 35 }) }));
  assert.equal(refreshed.market.amount, 35);
  assert.equal(effectivePrice(refreshed), null);
  assert.equal(effectivePrice({ ...refreshed, manualValuation: valuation(30) }), 30);
  const roundTrip = normalizeState({ ...emptyState(), collection: [refreshed] }).collection[0];
  assert.equal(roundTrip.lang, 'ja');
  assert.equal(roundTrip.uid, asian.uid);
  assert.equal(roundTrip.market.amount, 35);
});

test('missing quote and failed request retain old evidence without inventing a fresh source date', () => {
  const original = entry();
  const tomorrow = '2026-11-24T12:00:00.000Z';
  const failed = applyMarketUpdate(original, bundle({ lastError: 'Network unavailable', lastAttemptAt: tomorrow }));
  assert.equal(failed.market.amount, 100);
  assert.equal(failed.market.providerUpdatedAt, date);
  assert.equal(failed.market.fetchedAt, date);
  assert.equal(failed.market.lastAttemptAt, tomorrow);
  assert.equal(failed.market.lastError, 'Network unavailable');
  const missing = applyMarketUpdate(original, bundle({ reference: reference({ amount: null, providerUpdatedAt: null, fetchedAt: tomorrow, lastAttemptAt: tomorrow }), fetchedAt: tomorrow, lastAttemptAt: tomorrow }));
  assert.equal(missing.market.amount, null);
  assert.equal(missing.market.providerUpdatedAt, null);
  assert.equal(missing.lastValidMarket.amount, 100);
  assert.equal(missing.lastValidMarket.providerUpdatedAt, date);
  assert.equal(effectivePrice(missing), null);
});

test('out-of-order HTTP and provider observations cannot overwrite newer evidence', () => {
  const original = entry();
  const yesterday = '2026-11-22T12:00:00.000Z';
  const tomorrow = '2026-11-24T12:00:00.000Z';
  const olderRequest = applyMarketUpdate(original, bundle({ reference: reference({ amount: 50, providerUpdatedAt: yesterday }), fetchedAt: yesterday, lastAttemptAt: yesterday }));
  assert.equal(olderRequest, original);
  const olderSource = applyMarketUpdate(original, bundle({ reference: reference({ amount: 50, providerUpdatedAt: yesterday, fetchedAt: tomorrow }), fetchedAt: tomorrow, lastAttemptAt: tomorrow }));
  assert.equal(olderSource.market.amount, 100);
  assert.equal(olderSource.market.providerUpdatedAt, date);
  assert.match(olderSource.market.lastError, /older/);
});

test('coverage separates manual, missing, generic, stale and failed observations', () => {
  const now = Date.parse('2026-11-27T12:00:00.000Z');
  const state = { collection: [
    entry({ manualValuation: valuation() }),
    entry({ market: reference({ lastError: 'Timeout' }) }),
    entry({ market: reference({ amount: null }) }),
    entry({ variantId: 'unresolved', market: reference({ mapping: 'unverified' }) }),
  ] };
  const result = priceCoverage(state, now);
  assert.equal(result.quantity, 8);
  assert.equal(result.pricedQuantity, 4);
  assert.equal(result.manualQuantity, 2);
  assert.equal(result.manualValue, 500);
  assert.equal(result.marketValue, 200);
  assert.equal(result.staleQuantity, 2);
  assert.equal(result.errorQuantity, 2);
  assert.equal(result.genericQuantity, 2);
  assert.equal(result.unpricedQuantity, 4);
  assert.equal(result.unverifiedQuantity, 2);
});

test('v2 JSON and CSV round trips preserve identity, sources, grading and manual evidence', () => {
  const populated = card({ variantId: 'normal', variantLabel: 'Normal', grading: { company: 'CGC', grade: '9.5' }, manualValuation: valuation(), variants: [option('normal')], lastValidMarket: reference({ amount: 90 }) });
  const state = recordSnapshot(addCard(emptyState(), populated, { quantity: 3, cost: 10 / 3 }), 'collection');
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
  const restored = importCSV(exportCSV(state));
  assert.deepEqual({ ...restored.collection[0], uid: state.collection[0].uid }, state.collection[0]);
  assert.equal(totals(restored).cost, 10);
  assert.equal(restored.collection[0].market.fetchedAt, date);
  const legacyCSV = 'id,name,quantity,cost,price,priceUpdated\nbase1-4,Charizard,2,12.5,100,2026-01-01';
  const legacy = importCSV(legacyCSV);
  assert.equal(legacy.collection[0].variantId, null);
  assert.equal(legacy.collection[0].market.source, 'Imported reference');
  assert.equal(legacy.collection[0].market.fetchedAt, null);
});

test('currency, timestamp, malformed JSON and unsafe personal links reject atomically', () => {
  const state = addCard(emptyState(), card());
  for (const change of [
    { market: reference({ currency: 'USD' }) },
    { market: reference({ amount: NaN }) },
    { market: reference({ providerUpdatedAt: 'yesterday' }) },
    { market: reference({ productId: '733794' }) },
    { manualValuation: { ...valuation(), currency: 'USD' } },
    { manualValuation: { ...valuation(), url: 'javascript:alert(1)' } },
    { manualValuation: { ...valuation(), url: 'https://user:pass@example.com/' } },
    { manualValuation: { ...valuation(), updatedAt: null } },
    { variants: [option('normal'), option('normal')] },
  ]) assert.throws(() => normalizeState({ ...state, collection: [{ ...state.collection[0], ...change }] }));
  const before = JSON.stringify(state);
  assert.throws(() => importCSV('id,name,quantity,cost,market\na,A,1,2,broken', state), /valid JSON/);
  assert.equal(JSON.stringify(state), before);
});

test('snapshot reasons accumulate within the day without fabricating an earlier price history', () => {
  let state = recordSnapshot(addCard(emptyState(), card()), 'collection');
  state = recordSnapshot(state, 'prices');
  state = recordSnapshot(state, 'visit');
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].reason, 'visit');
  assert.deepEqual(state.history[0].reasons, ['collection', 'prices', 'visit']);
  assert.deepEqual(normalizeState(state), state);
});

test('changing finish without a new matched quote invalidates the previous finish price', () => {
  const state = addCard(emptyState(), card({ variantId: 'normal', market: reference({ mapping: 'matched' }) }));
  const updated = updateEntry(state, state.collection[0].uid, { variantId: 'reverse', variantLabel: 'Reverse holo' });
  assert.equal(updated.collection[0].market.amount, null);
  assert.equal(updated.collection[0].lastValidMarket, null);
  assert.equal(effectivePrice(updated.collection[0]), null);
});

test('zero automatic references are unavailable while an explicit personal zero remains valid', () => {
  const automatic = entry({ market: reference({ amount: 0 }) });
  assert.equal(automatic.market.amount, null);
  assert.equal(automatic.price, null);
  assert.equal(effectivePrice(automatic), null);
  assert.equal(totals({ collection: [automatic] }).pricedQuantity, 0);
  assert.equal(priceCoverage({ collection: [automatic] }).unpricedQuantity, 2);
  assert.equal(effectivePrice({ ...automatic, market: reference({ amount: 0 }) }), null);

  const personal = entry({ market: reference({ amount: 0 }), manualValuation: valuation(0) });
  assert.equal(personal.manualValuation.amount, 0);
  assert.equal(effectivePrice(personal), 0);
  assert.equal(totals({ collection: [personal] }).pricedQuantity, 2);
  assert.equal(priceCoverage({ collection: [personal] }).manualQuantity, 2);

  const legacy = normalizeState({ ...emptyState(), version: 1, collection: [{ ...automatic, price: 0 }] });
  assert.equal(legacy.collection[0].market.amount, null);
  assert.equal(legacy.collection[0].price, null);
  assert.equal(totals(legacy).pricedQuantity, 0);
});

test('a successful local recheck clears an error without re-dating an older shared acquisition', () => {
  const failedAt = '2026-11-24T12:00:00.000Z';
  const checkedAt = '2026-11-24T12:05:00.000Z';
  const failed = applyMarketUpdate(entry(), bundle({ lastError: 'Offline', lastAttemptAt: failedAt }));
  const recovered = applyMarketUpdate(failed, bundle({
    reference: reference({ lastAttemptAt: checkedAt }),
    // The shared cache was acquired yesterday; the client supplies today's check time.
    fetchedAt: date, lastAttemptAt: checkedAt,
  }));
  assert.equal(recovered.market.lastError, null);
  assert.equal(recovered.market.lastAttemptAt, checkedAt);
  assert.equal(recovered.market.providerUpdatedAt, date);
  assert.equal(recovered.market.fetchedAt, date);
  assert.equal(recovered.market.amount, 100);
});
