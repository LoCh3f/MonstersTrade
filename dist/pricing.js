/** Shared price provenance. Quotes describe market-wide raw-card references, not personal valuations. */
export const PRICE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const PRICE_SOURCE = 'Cardmarket via TCGdex';
const MAX_VARIANTS = 32;
const cleanText = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9 ? value : null;

export function normalizeQuote(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    amount: value.currency === 'EUR' ? positive(value.amount) : null,
    currency: 'EUR',
    source: cleanText(value.source, 100) || PRICE_SOURCE,
    metric: ['trend', 'trend-holo', 'legacy', 'store-low'].includes(value.metric) ? value.metric : 'trend',
    productId: Number.isSafeInteger(value.productId) && value.productId > 0 ? value.productId : null,
    providerUpdatedAt: timestamp(value.providerUpdatedAt),
    fetchedAt: timestamp(value.fetchedAt),
    lastAttemptAt: timestamp(value.lastAttemptAt),
    lastError: cleanText(value.lastError) || null,
    mapping: ['generic', 'matched', 'unverified'].includes(value.mapping) ? value.mapping : 'unverified',
  };
}

export function quoteStatus(quote, now = Date.now()) {
  if (!quote || typeof quote !== 'object') return 'missing';
  if (quote.lastError) return 'error';
  if (quote.mapping === 'unverified') return 'unverified';
  if (typeof quote.amount !== 'number' || !Number.isFinite(quote.amount) || quote.amount <= 0 || quote.currency !== 'EUR') return 'missing';
  const updated = Date.parse(quote.providerUpdatedAt || '');
  if (!Number.isFinite(updated) || updated > Number(now) + 300_000) return 'unverified';
  return Number(now) - updated > PRICE_MAX_AGE_MS ? 'stale' : 'current';
}

function quoteFromMarket(market, now, mapping = 'generic', metric = 'trend') {
  return normalizeQuote({
    amount: market?.unit === 'EUR' ? market[metric] : null,
    currency: 'EUR', source: PRICE_SOURCE, metric,
    productId: market?.idProduct,
    providerUpdatedAt: market?.updated, fetchedAt: now, lastAttemptAt: now,
    mapping,
  });
}

/**
 * A reviewed mapping must specify card + variant + product + metric. A third-party ID
 * by itself is not verification: normal/reverse variants can share an entire price
 * block and a printed holo does not universally use Cardmarket's trend-holo field.
 * Keep this list empty until a product/printing has an independently reviewed mapping.
 */
export const VERIFIED_PRICE_MAPPINGS = Object.freeze({});

export function normalizePricing(raw, nowISOString = new Date().toISOString()) {
  if (!raw || typeof raw.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.\-]{0,79}$/.test(raw.id)) {
    throw new Error('The provider returned an invalid card identifier.');
  }
  const now = timestamp(nowISOString);
  if (!now) throw new Error('A valid acquisition time is required.');
  const seen = new Set();
  const variants = (Array.isArray(raw.variants_detailed) ? raw.variants_detailed : []).slice(0, MAX_VARIANTS).flatMap(value => {
    if (!value || typeof value.variantId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.variantId) || seen.has(value.variantId)) return [];
    seen.add(value.variantId);
    const type = cleanText(value.type, 40) || 'unspecified';
    const foil = cleanText(value.foil, 50);
    const stamp = (Array.isArray(value.stamp) ? value.stamp : []).filter(item => typeof item === 'string').slice(0, 6).map(item => cleanText(item, 60));
    const size = cleanText(value.size, 40);
    const label = [type, foil, ...stamp, size && size !== 'standard' ? size : ''].filter(Boolean).join(' · ');
    const market = value.pricing?.cardmarket;
    const mapping = VERIFIED_PRICE_MAPPINGS[`${raw.id}:${value.variantId}`];
    const verified = mapping && market?.idProduct === mapping.productId && value.thirdParty?.cardmarket === mapping.productId;
    const quote = quoteFromMarket(market, now, verified ? 'matched' : 'unverified', verified ? mapping.metric : 'trend');
    // Preserve provenance and product ID, but never assign an ambiguous price.
    if (!verified) quote.amount = null;
    return [{ id: value.variantId, label: label || 'Unspecified variant', type, stamp, foil, quote }];
  });
  return {
    cardId: raw.id,
    reference: quoteFromMarket(raw.pricing?.cardmarket, now),
    variants,
    fetchedAt: now, lastAttemptAt: now, lastError: null,
  };
}
