import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, normalizeState, addCard, updateEntry, entryIdentity, effectivePrice,
  applyMarketUpdate, applySealedMarketUpdate, totals, priceCoverage, recordSnapshot, exportCSV, importCSV,
  SEALED_TYPES, SEALED_CONDITIONS,
} from '../dist/model.js';

const date = '2026-11-23T12:00:00.000Z';
const tomorrow = '2026-11-24T12:00:00.000Z';
const observation = (amount = 120, overrides = {}) => ({ amount, currency: 'EUR', updatedAt: date, note: 'Checked a comparable sealed product', url: 'https://example.com/products/151-etb', ...overrides });
const sealed = (overrides = {}) => ({
  id: 'sealed-151-etb', kind: 'sealed', name: '151 Elite Trainer Box', productType: 'elite-trainer-box',
  edition: 'Standard edition', productCode: '290-85312', productUrl: 'https://example.com/products/151-etb',
  lang: 'it', setId: 'sv03.5', setName: '151', ...overrides,
});
const card = { id: 'sv03.5-199', name: 'Charizard ex', lang: 'en', setId: 'sv03.5', price: 100, priceUpdated: date };

test('sealed types cover packs, boxes, ETBs and collections with packaging conditions', () => {
  assert.deepEqual(SEALED_TYPES.map(type => type.id), ['booster-pack', 'booster-box', 'elite-trainer-box', 'collection-box', 'tin', 'blister', 'bundle', 'other']);
  for (const type of SEALED_TYPES) {
    const state = addCard(emptyState(), sealed({ productType: type.id }));
    assert.equal(state.collection[0].productType, type.id);
    assert.equal(state.collection[0].condition, SEALED_CONDITIONS[0]);
    assert.equal(effectivePrice(state.collection[0]), null);
  }
  const created = addCard(emptyState(), sealed({ id: undefined }));
  assert.match(created.collection[0].id, /^sealed-/);
  assert.equal(created.collection[0].kind, 'sealed');
  assert.equal(created.collection[0].variantId, null);
  assert.equal(created.collection[0].grading, null);
  assert.equal(created.collection[0].price, null);
});

test('personal sealed valuations affect totals while costs remain independent', () => {
  const state = addCard(emptyState(), sealed({ manualValuation: observation() }), { quantity: 2, cost: 80 });
  const entry = state.collection[0];
  assert.equal(effectivePrice(entry), 120);
  assert.equal(entry.cost, 80);
  assert.deepEqual(entry.valuationHistory, [observation()]);
  assert.deepEqual(totals(state), { quantity: 2, unique: 1, value: 240, cost: 160, profit: 80, pricedQuantity: 2, unpricedQuantity: 0, sets: 0 });
  assert.equal(priceCoverage(state).manualQuantity, 2);
  assert.equal(priceCoverage(state).manualValue, 240);
  assert.equal(priceCoverage(state).marketValue, 0);
});

test('editing sealed valuation retains prior observations, same-day evidence and original state', () => {
  const original = addCard(emptyState(), sealed({ manualValuation: observation() }), { cost: 80 });
  const uid = original.collection[0].uid;
  let updated = updateEntry(original, uid, { manualValuation: observation(125) });
  updated = updateEntry(updated, uid, { manualValuation: observation(125, { note: 'Different supporting listing' }) });
  updated = updateEntry(updated, uid, { manualValuation: observation(130, { updatedAt: tomorrow }) });
  updated = updateEntry(updated, uid, { quantity: 3 });
  assert.equal(updated.collection[0].valuationHistory.length, 4);
  assert.deepEqual(updated.collection[0].valuationHistory.map(point => point.amount), [120, 125, 125, 130]);
  assert.equal(updated.collection[0].manualValuation.amount, 130);
  assert.equal(original.collection[0].valuationHistory.length, 1);
  assert.equal(original.collection[0].quantity, 1);
  assert.equal(updated.collection[0].cost, 80);
  const cleared = updateEntry(updated, uid, { manualValuation: null });
  assert.equal(effectivePrice(cleared.collection[0]), null);
  assert.equal(cleared.collection[0].valuationHistory.length, 4);
  assert.equal(totals(cleared).unpricedQuantity, 3);
});

test('card market references cannot be assigned or refreshed onto sealed products', () => {
  const state = addCard(emptyState(), sealed());
  const entry = state.collection[0];
  assert.throws(() => applyMarketUpdate(entry, { cardId: entry.id }), /cannot be applied/);
  assert.throws(() => addCard(emptyState(), sealed({ price: 100 })), /matching sealed/);
  assert.throws(() => updateEntry(state, entry.uid, { price: 100 }), /matching sealed/);
  const borrowed = { ...entry, market: { amount: 999, currency: 'EUR', mapping: 'matched' }, price: 999 };
  assert.equal(effectivePrice(borrowed), null);
  assert.equal(effectivePrice({ ...borrowed, manualValuation: observation(0) }), 0);
});

test('mixed collections keep card and sealed identities separate and sets count actual cards only', () => {
  let state = addCard(emptyState(), card);
  state = addCard(state, sealed({ id: card.id, lang: card.lang, manualValuation: observation() }));
  assert.equal(state.collection.length, 2);
  assert.notEqual(entryIdentity(state.collection[0]), entryIdentity(state.collection[1]));
  assert.equal(totals(state).unique, 2);
  assert.equal(totals(state).sets, 1);
  assert.equal(totals(state).value, 220);
  const snapshot = recordSnapshot(state, 'collection').history[0];
  assert.equal(snapshot.value, 220);
  assert.equal(snapshot.quantity, 2);
});

test('editions, packaging, language and product codes do not merge, identical sealed holdings preserve weighted cost', () => {
  let state = addCard(emptyState(), sealed(), { quantity: 2, cost: 80 });
  state = addCard(state, sealed(), { quantity: 3, cost: 100 });
  assert.equal(state.collection.length, 1);
  assert.equal(state.collection[0].quantity, 5);
  assert.equal(state.collection[0].cost, 92);
  for (const metadata of [{ edition: 'Pokémon Center' }, { productType: 'booster-box' }, { productCode: 'other' }, { lang: 'en' }]) state = addCard(state, sealed(metadata));
  state = addCard(state, sealed(), { condition: SEALED_CONDITIONS[1] });
  assert.equal(state.collection.length, 6);
});

test('merging identical products retains distinct prior valuation evidence', () => {
  const current = observation(130, { updatedAt: tomorrow });
  let state = addCard(emptyState(), sealed({ manualValuation: current, valuationHistory: [observation(100)] }));
  state = addCard(state, sealed({ manualValuation: current, valuationHistory: [observation(110)] }));
  assert.equal(state.collection.length, 1);
  assert.equal(state.collection[0].quantity, 2);
  assert.deepEqual(state.collection[0].valuationHistory.map(point => point.amount), [100, 110, 130]);
});

test('sealed JSON and CSV roundtrips preserve product metadata and every recorded valuation', () => {
  let state = addCard(emptyState(), sealed({ manualValuation: observation(), edition: 'Special, "anniversary" edition', productCode: '00123' }), { cost: 75.3, quantity: 3, condition: SEALED_CONDITIONS[1] });
  state = updateEntry(state, state.collection[0].uid, { manualValuation: observation(145, { updatedAt: tomorrow, note: 'New\ncomparable' }) });
  state = recordSnapshot(state);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
  const csv = importCSV(exportCSV(state));
  assert.deepEqual({ ...csv.collection[0], uid: state.collection[0].uid }, state.collection[0]);
  assert.equal(totals(csv).value, 435);
  const appended = importCSV(exportCSV(state), state);
  assert.equal(appended.collection[0].quantity, 6);
  assert.equal(appended.collection[0].valuationHistory.length, 2);
});

test('existing v1 and v2 backups without a kind still become cards', () => {
  const state = addCard(emptyState(), card);
  const raw = JSON.parse(JSON.stringify(state));
  for (const field of ['kind', 'productType', 'edition', 'productCode', 'productUrl', 'valuationHistory']) delete raw.collection[0][field];
  for (const version of [1, 2]) {
    const restored = normalizeState({ ...raw, version });
    assert.equal(restored.collection[0].kind, 'card');
    assert.equal(restored.collection[0].price, 100);
    assert.equal(restored.collection[0].condition, 'Near Mint');
  }
  assert.equal(importCSV('id,name,quantity,cost\na,Card,1,0').collection[0].kind, 'card');
});

test('invalid sealed metadata and history reject atomically instead of losing evidence', () => {
  const state = addCard(emptyState(), sealed());
  const before = JSON.stringify(state);
  for (const patch of [
    { kind: 'other' }, { kind: 'card' }, { productType: 'mystery' }, { condition: 'Near Mint' },
    { variantId: 'holo' }, { grading: { company: 'PSA', grade: '10' } }, { variants: [{}] },
    { productUrl: 'javascript:alert(1)' }, { productUrl: 'https://user:pass@example.com' },
    { valuationHistory: [null] }, { valuationHistory: [observation(100, { currency: 'USD' })] },
    { valuationHistory: [observation(100, { updatedAt: 'yesterday' })] },
    { valuationHistory: [observation(100, { url: 'javascript:alert(1)' })] },
  ]) assert.throws(() => updateEntry(state, state.collection[0].uid, patch));
  assert.equal(JSON.stringify(state), before);
  const imported = { ...state, collection: [{ ...state.collection[0], quantity: 0 }] };
  assert.throws(() => normalizeState(imported));
});

test('history limits retain existing evidence and allow idempotent full-history imports', () => {
  const history = Array.from({ length: 1000 }, (_, i) => observation(i, { note: String(i) }));
  const state = addCard(emptyState(), sealed({ valuationHistory: history, manualValuation: history.at(-1) }));
  assert.equal(state.collection[0].valuationHistory.length, 1000);
  const merged = importCSV(exportCSV(state), state);
  assert.equal(merged.collection[0].valuationHistory.length, 1000);
  assert.throws(() => updateEntry(state, state.collection[0].uid, { manualValuation: observation(2000) }), /1000/);
  assert.equal(state.collection[0].valuationHistory.length, 1000);
});

const retailQuote = (overrides = {}) => ({ amount: 90, currency: 'EUR', source: 'TCGPrices · EU retail', metric: 'store-low', productId: 123,
  mapping: 'matched', providerUpdatedAt: date, fetchedAt: date, lastAttemptAt: date, lastError: null, ...overrides });
const retailProduct = (overrides = {}) => sealed({ id: 'sealed-tcgp-123-eu', lang: 'und', edition: '', market: retailQuote(), sourceProductType: 'elite_trainer_box', game: 'pokemon', storesInStock: 2, ...overrides });

test('exact sealed retail product references can value unspecified-language products and survive exports', () => {
  const state = addCard(emptyState(), retailProduct(), { quantity: 2, cost: 70 });
  assert.equal(effectivePrice(state.collection[0]), 90);
  assert.equal(totals(state).value, 180);
  assert.equal(priceCoverage(state).marketValue, 180);
  assert.deepEqual(normalizeState(state), state);
  const restored = importCSV(exportCSV(state));
  assert.deepEqual({ ...restored.collection[0], uid: state.collection[0].uid }, state.collection[0]);
  const italian = updateEntry(state, state.collection[0].uid, { lang: 'it' });
  assert.equal(effectivePrice(italian.collection[0]), null);
  assert.equal(priceCoverage(italian).unverifiedQuantity, 2);
  const personal = updateEntry(italian, italian.collection[0].uid, { manualValuation: observation(140) });
  assert.equal(effectivePrice(personal.collection[0]), 140);
});

test('retail pricing refuses wrong identifiers, currency, source and price metrics', () => {
  const state = addCard(emptyState(), retailProduct());
  const entry = state.collection[0];
  for (const changed of [
    retailProduct({ id: 'sealed-tcgp-124-eu' }),
    retailProduct({ kind: 'card' }),
    retailProduct({ market: retailQuote({ productId: 124 }) }),
    retailProduct({ market: retailQuote({ metric: 'trend' }) }),
    retailProduct({ market: retailQuote({ source: 'Cardmarket via TCGdex' }) }),
    retailProduct({ market: retailQuote({ mapping: 'generic' }) }),
    retailProduct({ market: retailQuote({ currency: 'USD' }) }),
  ]) assert.throws(() => applySealedMarketUpdate(entry, changed));
  assert.throws(() => addCard(emptyState(), retailProduct({ id: 'sealed-custom' })), /matching sealed/);
  for (const patch of [{ id: 'sealed-custom' }, { market: retailQuote({ productId: 999 }) }, { market: retailQuote({ metric: 'trend' }) }]) {
    assert.equal(effectivePrice({ ...entry, ...patch }), null);
  }
});

test('sealed retail refresh preserves private metadata and valuations with source-date guards', () => {
  const state = addCard(emptyState(), retailProduct({ manualValuation: observation(), edition: 'My specific edition' }), { quantity: 2, cost: 70 });
  const entry = state.collection[0];
  const incoming = retailProduct({ market: retailQuote({ amount: 95, providerUpdatedAt: tomorrow, fetchedAt: tomorrow, lastAttemptAt: tomorrow }), storesInStock: 3, edition: 'Other', lang: 'en' });
  const refreshed = applySealedMarketUpdate(entry, incoming);
  assert.equal(refreshed.market.amount, 95);
  assert.equal(refreshed.quantity, 2);
  assert.equal(refreshed.cost, 70);
  assert.equal(refreshed.edition, 'My specific edition');
  assert.equal(refreshed.lang, 'und');
  assert.equal(refreshed.storesInStock, 3);
  assert.deepEqual(refreshed.manualValuation, entry.manualValuation);
  assert.deepEqual(refreshed.valuationHistory, entry.valuationHistory);
  assert.equal(effectivePrice(refreshed), 120);
  assert.equal(applySealedMarketUpdate(refreshed, retailProduct()), refreshed);
  const checkedLater = '2026-11-25T12:00:00.000Z';
  const olderSource = applySealedMarketUpdate(refreshed, retailProduct({ market: retailQuote({ amount: 75, fetchedAt: checkedLater, lastAttemptAt: checkedLater }) }));
  assert.equal(olderSource.market.amount, 95);
  assert.equal(olderSource.market.providerUpdatedAt, tomorrow);
  assert.match(olderSource.market.lastError, /older/);
});

test('sealed source failures retain evidence while successful missing prices clear current value', () => {
  const entry = addCard(emptyState(), retailProduct()).collection[0];
  const failed = applySealedMarketUpdate(entry, { kind: 'sealed', id: entry.id, lastAttemptAt: tomorrow, lastError: 'Service unavailable' });
  assert.equal(failed.market.amount, 90);
  assert.equal(failed.market.providerUpdatedAt, date);
  assert.equal(failed.market.lastError, 'Service unavailable');
  const missing = applySealedMarketUpdate(entry, retailProduct({ market: retailQuote({ amount: null, providerUpdatedAt: tomorrow, fetchedAt: tomorrow, lastAttemptAt: tomorrow }), storesInStock: 0 }));
  assert.equal(missing.market.amount, null);
  assert.equal(missing.lastValidMarket.amount, 90);
  assert.equal(effectivePrice(missing), null);
  assert.equal(missing.storesInStock, 0);
});

test('sealed retail baseline excludes damaged packaging and custom editions without a personal valuation', () => {
  assert.equal(effectivePrice(retailProduct()), 90);
  const baseline = addCard(emptyState(), retailProduct());
  const uid = baseline.collection[0].uid;
  for (const patch of [{ condition: SEALED_CONDITIONS[1] }, { edition: 'Pokémon Center edition' }]) {
    const changed = updateEntry(baseline, uid, patch);
    assert.equal(changed.collection[0].market.amount, 90);
    assert.equal(effectivePrice(changed.collection[0]), null);
    assert.equal(priceCoverage(changed).unverifiedQuantity, 1);
    assert.equal(priceCoverage(changed).unpricedQuantity, 1);
    assert.equal(priceCoverage(changed).marketValue, 0);
    const valued = updateEntry(changed, uid, { manualValuation: observation(85) });
    assert.equal(effectivePrice(valued.collection[0]), 85);
    assert.equal(priceCoverage(valued).manualValue, 85);
  }
});
