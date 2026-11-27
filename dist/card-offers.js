// IDs reviewed against the CardTrader product page and TCGdex's set, card
// number and sole stamped holo variant. Keep distinct finishes unmapped.
const blueprints = Object.freeze({
  '30th-135': 406796,
  '30th-142': 406803,
  '30th-148': 406809,
  '30th-153': 406814,
});
const anniversaryHolo = '1jz5lzkp5cg8gmrsxmftf0fur0t08j';
export const CARD_OFFER_CONDITIONS = Object.freeze(['Near Mint', 'Excellent', 'Good', 'Played']);
export const CARD_OFFER_SOURCE = 'CardTrader';

export function cardOfferBlueprint(id, language) {
  return (language === 'it' || language === 'en') && Object.hasOwn(blueprints, id) ? blueprints[id] : null;
}

export function cardOfferKey(id, language) {
  const blueprintId = cardOfferBlueprint(id, language);
  return blueprintId ? `${blueprintId}:${language}` : null;
}

export function normalizeCardOffers(value, id, language) {
  if (value == null) return null;
  const blueprintId = cardOfferBlueprint(id, language);
  if (!blueprintId || value.blueprintId !== blueprintId || value.language !== language || value.currency !== 'EUR'
    || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))
    || typeof value.prices !== 'object' || !value.prices || Array.isArray(value.prices)) {
    throw new Error('The CardTrader observation does not match this card and language.');
  }
  const prices = {};
  for (const condition of CARD_OFFER_CONDITIONS) {
    const cents = value.prices[condition];
    if (cents === undefined) continue;
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 1e11) throw new Error('Invalid CardTrader offer price.');
    prices[condition] = cents;
  }
  return { blueprintId, language, currency: 'EUR', observedAt: new Date(value.observedAt).toISOString(), prices };
}

export function cardOfferReference(card) {
  const snapshot = card.cardOffers;
  if (!snapshot || card.kind === 'sealed' || card.grading
    || (card.variantId && card.variantId !== anniversaryHolo)
    || snapshot.language !== card.lang || snapshot.blueprintId !== cardOfferBlueprint(card.id, card.lang)) return null;
  const cents = snapshot.prices[card.condition || 'Near Mint'];
  return {
    amount: cents === undefined ? null : cents / 100,
    currency: 'EUR', source: CARD_OFFER_SOURCE, mapping: 'matched',
    productId: snapshot.blueprintId, providerUpdatedAt: snapshot.observedAt,
  };
}
