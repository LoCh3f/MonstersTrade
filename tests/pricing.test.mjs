import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuote, normalizePricing, quoteStatus, PRICE_MAX_AGE_MS } from '../dist/pricing.js';

const now = '2026-11-23T12:00:00.000Z';
const market = { unit: 'EUR', idProduct: 733596, trend: 0.16, 'trend-holo': 0.38, updated: '2026-11-23T02:00:00Z' };
const card = () => ({ id: 'sv03.5-001', pricing: { cardmarket: { ...market } }, variants_detailed: [
  { variantId: 'normal-1', type: 'normal', size: 'standard', thirdParty: { cardmarket: 733596 }, pricing: { cardmarket: { ...market } } },
  { variantId: 'reverse-1', type: 'reverse', size: 'standard', thirdParty: { cardmarket: 733596 }, pricing: { cardmarket: { ...market } } },
] });

test('quote normalization retains provenance and accepts only usable positive EUR values', () => {
  const quote = normalizePricing(card(), now).reference;
  assert.equal(quote.amount, 0.16);
  assert.equal(quote.productId, 733596);
  assert.equal(quote.source, 'Cardmarket via TCGdex');
  assert.equal(quote.providerUpdatedAt, '2026-11-23T02:00:00.000Z');
  assert.equal(quote.fetchedAt, now);
  for (const amount of [0, -1, Infinity, NaN, '1', undefined, 1e10]) {
    assert.equal(normalizeQuote({ ...quote, amount }).amount, null);
  }
  assert.equal(normalizeQuote({ ...quote, currency: 'USD' }).amount, null);
  assert.equal(normalizeQuote({ ...quote, providerUpdatedAt: 'invalid' }).providerUpdatedAt, null);
});

test('freshness is based on provider time, not the latest fetch or a fabricated date', () => {
  const quote = normalizePricing(card(), now).reference;
  assert.equal(quoteStatus(quote, Date.parse(now)), 'current');
  assert.equal(quoteStatus({ ...quote, fetchedAt: now }, Date.parse(quote.providerUpdatedAt) + PRICE_MAX_AGE_MS + 1), 'stale');
  assert.equal(quoteStatus({ ...quote, providerUpdatedAt: null }, Date.parse(now)), 'unverified');
  assert.equal(quoteStatus({ ...quote, providerUpdatedAt: '2027-01-01' }, Date.parse(now)), 'unverified');
  assert.equal(quoteStatus({ ...quote, lastError: 'Timeout' }, Date.parse(now)), 'error');
  assert.equal(quoteStatus({ ...quote, amount: null }, Date.parse(now)), 'missing');
});

test('ambiguous normal/reverse/holo prices never become verified based on IDs or nonzero fields', () => {
  const raw = card();
  raw.variants_detailed.push({ variantId: 'holo-only', type: 'holo', thirdParty: { cardmarket: 733601 }, pricing: { cardmarket: { ...market, idProduct: 733601, trend: 7.83, 'trend-holo': 0 } } });
  const bundle = normalizePricing(raw, now);
  assert.equal(bundle.reference.mapping, 'generic');
  assert.equal(bundle.variants.length, 3);
  for (const variant of bundle.variants) {
    assert.equal(variant.quote.mapping, 'unverified');
    assert.equal(variant.quote.amount, null);
    assert.equal(quoteStatus(variant.quote, Date.parse(now)), 'unverified');
  }
});

test('variant keys are card scoped, labels are descriptive, malformed/duplicate variants are bounded', () => {
  const raw = card();
  raw.variants_detailed[1].foil = 'cosmos';
  raw.variants_detailed[1].stamp = ['set-logo'];
  raw.variants_detailed.push(null, { ...raw.variants_detailed[0] }, { variantId: '../../other', type: 'normal' });
  const first = normalizePricing(raw, now);
  const second = normalizePricing({ ...raw, id: 'swsh3-136' }, now);
  assert.equal(first.variants.length, 2);
  assert.equal(first.variants[1].label, 'reverse · cosmos · set-logo');
  assert.equal(first.variants[0].id, second.variants[0].id);
  assert.notEqual(first.cardId, second.cardId);
  assert.throws(() => normalizePricing(null, now));
  assert.throws(() => normalizePricing(raw, 'not-a-date'));
});
