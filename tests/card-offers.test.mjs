import test from 'node:test';
import assert from 'node:assert/strict';
import { addCard, applyMarketUpdate, effectivePrice, emptyState, exportCSV, importCSV, normalizeState, totals, updateEntry } from '../dist/model.js';
import { marketPanel, priceBadge } from '../dist/price-view.js';

test('the CardTrader offer follows the saved copy, contributes to the total, and survives backups', () => {
  const observedAt = new Date().toISOString();
  const card = { id: '30th-148', lang: 'it', name: 'Greninja-ex', price: 99, priceUpdated: observedAt };
  const cardOffers = { blueprintId: 406809, language: 'it', currency: 'EUR', observedAt, prices: {'Near Mint': 1725, Excellent: 1600} };
  let state = addCard(emptyState(), card, { quantity: 2, cost: 3 });
  const update = entry => applyMarketUpdate(entry, { cardId: card.id, cardOffers, lastError: 'Legacy trend unavailable' });
  const entry = update(state.collection[0]);
  state = {...state, collection: [entry]};
  assert.equal(effectivePrice(entry), 17.25);
  assert.equal(totals(state).value, 34.5);
  assert.match(priceBadge(entry), /Lowest CardTrader offer/);
  assert.match(marketPanel(entry), /CardTrader · Italian · Near Mint/);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))).collection[0].cardOffers, cardOffers);
  assert.deepEqual(importCSV(exportCSV(state)).collection[0].cardOffers, cardOffers);
  state = updateEntry(state, entry.uid, { condition: 'Excellent' });
  assert.equal(effectivePrice(state.collection[0]), 16);
  assert.equal(effectivePrice({...entry, condition: 'Played'}), null);
  assert.match(priceBadge({...entry, condition: 'Played'}), /No matching offers/);
  assert.equal(effectivePrice({...entry, variantId: 'unreviewed'}), null);
  assert.equal(effectivePrice({...entry, grading: {company: 'PSA', grade: '10'}}), null);
  assert.equal(effectivePrice({...entry, manualValuation: {amount: 20}}), 20);
  assert.throws(() => update({...entry, lang: 'en'}), /does not match/);
  assert.equal(updateEntry(state, entry.uid, {lang: 'en'}).collection[0].cardOffers, undefined);
});
