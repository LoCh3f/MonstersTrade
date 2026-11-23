import { quoteStatus } from './pricing.js';
import { safePhotoURL } from './photos.js';

/** Immutable collection operations. Prices and purchase costs are per item, in EUR. */
export const CONDITIONS = Object.freeze(['Near Mint', 'Excellent', 'Good', 'Played']);
export const SEALED_TYPES = Object.freeze([
  { id: 'booster-pack', label: 'Booster pack' },
  { id: 'booster-box', label: 'Booster box' },
  { id: 'elite-trainer-box', label: 'Elite Trainer Box' },
  { id: 'collection-box', label: 'Collection box' },
  { id: 'tin', label: 'Tin' },
  { id: 'blister', label: 'Blister' },
  { id: 'bundle', label: 'Bundle' },
  { id: 'other', label: 'Other sealed product' },
].map(Object.freeze));
export const SEALED_CONDITIONS = Object.freeze(['Factory sealed', 'Sealed · damaged packaging']);
const MAX_ROWS = 100000;
const MAX_MONEY = 1e9;
const MAX_QUANTITY = 1e6;
const MAX_VALUATIONS = 1000;
const JSON_COLUMNS = ['grading', 'manualValuation', 'market', 'lastValidMarket', 'variants', 'valuationHistory'];
const CSV_COLUMNS = ['id', 'name', 'localId', 'image', 'setId', 'setName', 'setTotal', 'rarity', 'price', 'priceUpdated', 'lang', 'quantity', 'cost', 'condition', 'binderId', 'binderName', 'addedAt', 'variantId', 'variantLabel', 'kind', 'productType', 'edition', 'productCode', 'productUrl', 'sourceProductType', 'game', 'storesInStock', ...JSON_COLUMNS];
const SNAPSHOT_REASONS = ['visit', 'collection', 'prices', 'legacy'];

export function emptyState() {
  return { version: 2, collection: [], wishlist: [], binders: [{ id: 'main', name: 'My collection' }], history: [] };
}

function fail(message) { throw new Error(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}
function text(value, label, fallback = '', maximum = 500) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000')) fail(`${label} must be text of at most ${maximum} characters.`);
  return value;
}
function requiredText(value, label, maximum = 200) {
  const result = text(value, label, '', maximum);
  if (!result.trim()) fail(`${label} is required.`);
  return result;
}
function number(value, label, { maximum = MAX_MONEY, integer = false, minimum = 0 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    fail(`${label} must be ${integer ? 'an integer' : 'a number'} between ${minimum} and ${maximum}.`);
  }
  return value;
}
function list(value, label) {
  if (!Array.isArray(value) || value.length > MAX_ROWS) fail(`${label} must be an array with at most ${MAX_ROWS} entries.`);
  return value;
}
function uniqueId() {
  return globalThis.crypto?.randomUUID?.() || `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function timestamp(value, label, fallback = new Date().toISOString()) {
  const result = text(value, label, fallback, 50);
  if (result && !Number.isFinite(Date.parse(result))) fail(`${label} must be a valid date.`);
  return result;
}
function nullableTimestamp(value, label) {
  return value === undefined || value === null || value === '' ? null : timestamp(value, label, '');
}
function validURL(value, label) {
  const result = text(value, label, '', 2048);
  if (!result) return '';
  try {
    const parsed = new URL(result);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail(`${label} must be an HTTP(S) URL without credentials.`);
  } catch { fail(`${label} must be an HTTP(S) URL without credentials.`); }
  return result;
}
/** Import validation is strict: malformed quotes must not silently become real prices. */
function quote(input) {
  object(input, 'Price observation');
  if (input.currency !== 'EUR') fail('Price observations must use EUR.');
  const metric = text(input.metric, 'Price metric', 'legacy', 30);
  if (!['trend', 'trend-holo', 'legacy', 'store-low'].includes(metric)) fail('Unsupported price metric.');
  const mapping = text(input.mapping, 'Price mapping', 'unverified', 30);
  if (!['generic', 'matched', 'unverified'].includes(mapping)) fail('Unsupported price mapping.');
  return {
    amount: input.amount === undefined || input.amount === null ? null : number(input.amount, 'Reference price') || null,
    currency: 'EUR',
    source: text(input.source, 'Price source', 'Unknown source', 200),
    metric,
    productId: input.productId === undefined || input.productId === null ? null : number(input.productId, 'Product ID', { integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    providerUpdatedAt: nullableTimestamp(input.providerUpdatedAt, 'Provider price date'),
    fetchedAt: nullableTimestamp(input.fetchedAt, 'Price fetch date'),
    lastAttemptAt: nullableTimestamp(input.lastAttemptAt, 'Price attempt date'),
    lastError: input.lastError === undefined || input.lastError === null ? null : text(input.lastError, 'Price error', '', 500),
    mapping,
  };
}
function legacyQuote(input) {
  return quote({
    amount: input.price === undefined || input.price === null ? null : number(input.price, 'Market price'),
    currency: 'EUR', source: 'Imported reference', metric: 'legacy',
    providerUpdatedAt: input.priceUpdated || null, mapping: 'generic',
  });
}
function grading(input) {
  if (input === undefined || input === null) return null;
  object(input, 'Grading');
  return { company: requiredText(input.company, 'Grading company', 40), grade: requiredText(input.grade, 'Grade', 20) };
}
function manualValuation(input) {
  if (input === undefined || input === null) return null;
  object(input, 'Personal valuation');
  if (input.currency !== 'EUR') fail('Personal valuations must use EUR.');
  const updatedAt = nullableTimestamp(input.updatedAt, 'Personal valuation date');
  if (!updatedAt) fail('Personal valuations must have a date.');
  return {
    amount: number(input.amount, 'Personal valuation'), currency: 'EUR', updatedAt,
    note: text(input.note, 'Personal valuation note', '', 2000),
    url: validURL(input.url, 'Personal valuation source'),
  };
}
function valuationHistory(input, current = null) {
  if (input !== undefined && input !== null && (!Array.isArray(input) || input.length > MAX_VALUATIONS)) fail(`Valuation history must contain at most ${MAX_VALUATIONS} observations.`);
  const observations = (input || []).map(item => {
    if (item === null) fail('A valuation history observation must be an object.');
    return manualValuation(item);
  });
  if (current) observations.push(current);
  const unique = [...new Map(observations.map(item => [JSON.stringify(item), item])).values()];
  if (unique.length > MAX_VALUATIONS) fail(`This product has reached ${MAX_VALUATIONS} valuation observations. Export a backup before starting a new record.`);
  return unique.sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
}
function mergeValuationHistory(left, right) {
  const combined = [...valuationHistory(left), ...valuationHistory(right)];
  return valuationHistory([...new Map(combined.map(item => [JSON.stringify(item), item])).values()]);
}
function matchingSealedQuote(entry, market) {
  const match = /^sealed-tcgp-([1-9]\d*)-eu$/.exec(entry.id || '');
  return Boolean(match && Number.isSafeInteger(Number(match[1])) && market?.productId === Number(match[1]) && market.source === 'TCGPrices · EU retail' && market.metric === 'store-low' && market.mapping === 'matched');
}
function usableSealedReference(entry, market) {
  return entry.lang === 'und' && !entry.variantId && !String(entry.edition || '').trim()
    && (entry.condition === undefined || entry.condition === SEALED_CONDITIONS[0])
    && matchingSealedQuote(entry, market);
}
function variants(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 32) fail('A card may have at most 32 stored variants.');
  const result = input.map(item => {
    object(item, 'Variant');
    const stamp = item.stamp ?? [];
    if (!Array.isArray(stamp) || stamp.length > 10) fail('Variant stamps must be a short list.');
    return {
      id: requiredText(item.id, 'Variant ID', 100),
      label: requiredText(item.label, 'Variant label', 200),
      type: text(item.type, 'Variant type', '', 40),
      stamp: stamp.map(value => requiredText(value, 'Variant stamp', 100)),
      foil: item.foil === undefined || item.foil === null ? null : text(item.foil, 'Foil finish', '', 100),
      quote: quote(item.quote),
    };
  });
  if (new Set(result.map(item => item.id)).size !== result.length) fail('Variant IDs must be unique within a card.');
  return result;
}
function cardMetadata(input, legacy = false) {
  object(input, 'Card');
  const kind = legacy ? 'card' : text(input.kind, 'Item kind', 'card', 20);
  if (!['card', 'sealed'].includes(kind)) fail('Choose card or sealed as the item kind.');
  const sealed = kind === 'sealed';
  const productType = sealed ? text(input.productType, 'Sealed product type', 'other', 40) : '';
  if (sealed && !SEALED_TYPES.some(type => type.id === productType)) fail('Choose a supported sealed product type.');
  if (sealed && (input.variantId || input.grading || (Array.isArray(input.variants) && input.variants.length))) fail('Sealed products cannot have card variants or grading.');
  if (sealed && input.variants !== undefined && input.variants !== null && !Array.isArray(input.variants)) fail('Sealed product variants must be empty.');
  const lang = text(input.lang, 'Language', 'en', 10);
  if (!/^(?:[a-z]{2}(?:-[A-Za-z]{2,4})?|und)$/.test(lang)) fail('Item language must be a language code such as en, it, or und for unspecified.');
  let image = text(input.image, sealed ? 'Product photo' : 'Card image', '', 2000);
  if (sealed && image) {
    image = safePhotoURL(image);
    if (!image) fail('Product photo must be an HTTPS URL without credentials, up to 2000 characters.');
  } else if (image && !/^(https?:\/\/|\.?\/?assets\/)/i.test(image)) fail('Card image must be an HTTP(S) URL or a local assets path.');
  // Validate the legacy mirrors too; a corrupt import must not be silently accepted.
  if (input.price !== undefined && input.price !== null) number(input.price, 'Market price');
  if (input.priceUpdated) timestamp(input.priceUpdated, 'Price date', '');
  const market = !legacy && input.market ? quote(input.market) : legacyQuote(input);
  if (sealed && market.amount !== null && !matchingSealedQuote(input, market)) fail('Only a matching sealed retail reference or personal valuation can value a sealed product.');
  if (sealed && input.lastValidMarket?.amount != null && !matchingSealedQuote(input, input.lastValidMarket)) fail('The prior reference must match the sealed product.');
  const personal = legacy ? null : manualValuation(input.manualValuation);
  const variantId = legacy || input.variantId === undefined || input.variantId === null || input.variantId === '' ? null : requiredText(input.variantId, 'Variant ID', 100);
  return {
    kind,
    productType,
    edition: sealed ? text(input.edition, 'Product edition', '', 200) : '',
    productCode: sealed ? text(input.productCode, 'Product code', '', 100) : '',
    productUrl: sealed ? validURL(input.productUrl, 'Product link') : '',
    sourceProductType: sealed ? text(input.sourceProductType, 'Provider product type', '', 120) : '',
    game: sealed ? text(input.game, 'Product game', 'Pokémon', 100) : '',
    storesInStock: sealed && input.storesInStock !== undefined && input.storesInStock !== null ? number(input.storesInStock, 'Stores in stock', { integer: true, maximum: MAX_ROWS }) : null,
    valuationHistory: sealed ? valuationHistory(input.valuationHistory, personal) : [],
    id: requiredText(input.id, 'Card ID'),
    name: requiredText(input.name, 'Card name', 300),
    localId: text(input.localId, 'Card number', '', 100),
    image,
    setId: text(input.setId, 'Set ID', '', 200),
    setName: text(input.setName, 'Set name', 'Unknown set', 300),
    setTotal: input.setTotal === undefined || input.setTotal === null ? 0 : number(input.setTotal, 'Set size', { integer: true, maximum: MAX_ROWS }),
    rarity: text(input.rarity, 'Rarity', 'Unknown', 150),
    price: market.amount,
    priceUpdated: market.providerUpdatedAt || '',
    priceSource: market.source,
    lang,
    variantId,
    variantLabel: variantId ? text(input.variantLabel, 'Variant label', 'Unspecified variant', 200) : 'Unspecified variant',
    grading: legacy ? null : grading(input.grading),
    manualValuation: personal,
    market,
    lastValidMarket: legacy || !input.lastValidMarket ? null : quote(input.lastValidMarket),
    variants: legacy ? [] : variants(input.variants),
  };
}
function entryDetails(input, binders) {
  const conditions = input.kind === 'sealed' ? SEALED_CONDITIONS : CONDITIONS;
  const condition = input.condition ?? conditions[0];
  if (!conditions.includes(condition)) fail(input.kind === 'sealed' ? 'Choose a supported sealed packaging condition.' : 'Choose a supported card condition.');
  const binderId = input.binderId ?? 'main';
  if (!binders.some(binder => binder.id === binderId)) fail('The selected binder does not exist.');
  return {
    quantity: number(input.quantity ?? 1, 'Quantity', { integer: true, minimum: 1, maximum: MAX_QUANTITY }),
    cost: number(input.cost ?? 0, 'Purchase cost'),
    condition,
    binderId,
  };
}
function assertUnique(entries, label) {
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.uid)) fail(`${label} contains a duplicate entry ID.`);
    ids.add(entry.uid);
  }
}

/** Validate a JSON backup before replacing current data. Unknown fields are discarded. */
export function normalizeState(input) {
  object(input, 'Backup');
  if (![1, 2].includes(input.version)) fail('This is not a supported Monstertrade backup (version 1 or 2 required).');
  const legacy = input.version === 1;
  const binders = list(input.binders, 'Binders').map(binder => {
    object(binder, 'Binder');
    return { id: requiredText(binder.id, 'Binder ID'), name: requiredText(binder.name, 'Binder name', 100) };
  });
  if (!binders.length) fail('A backup must contain at least one binder.');
  if (new Set(binders.map(binder => binder.id)).size !== binders.length) fail('Binder IDs must be unique.');
  const collection = list(input.collection, 'Collection').map(entry => {
    object(entry, 'Collection entry');
    if (entry.quantity === undefined || entry.cost === undefined) fail('Every collection entry needs a quantity and purchase cost.');
    return {
      ...cardMetadata(entry, legacy),
      uid: requiredText(entry.uid, 'Entry ID'),
      ...entryDetails({ ...entry, kind: legacy ? 'card' : entry.kind }, binders),
      addedAt: timestamp(entry.addedAt, 'Date added'),
    };
  });
  const wishlist = list(input.wishlist, 'Wishlist').map(entry => {
    object(entry, 'Wishlist entry');
    return {
      ...cardMetadata(entry, legacy),
      uid: requiredText(entry.uid, 'Wishlist entry ID'),
      target: number(entry.target, 'Target price'),
      addedAt: timestamp(entry.addedAt, 'Date added'),
    };
  });
  assertUnique(collection, 'Collection');
  assertUnique(wishlist, 'Wishlist');
  const seenDates = new Set();
  const history = list(input.history, 'History').map(snapshot => {
    object(snapshot, 'History snapshot');
    const date = requiredText(snapshot.date, 'Snapshot date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail('Snapshot date must use YYYY-MM-DD.');
    if (seenDates.has(date)) fail('History contains a duplicate date.');
    seenDates.add(date);
    return {
      date,
      value: number(snapshot.value, 'Snapshot value', { maximum: Number.MAX_SAFE_INTEGER }),
      cost: number(snapshot.cost, 'Snapshot cost', { maximum: Number.MAX_SAFE_INTEGER }),
      quantity: number(snapshot.quantity, 'Snapshot quantity', { integer: true, maximum: Number.MAX_SAFE_INTEGER }),
      pricedQuantity: number(snapshot.pricedQuantity, 'Snapshot priced quantity', { integer: true, maximum: snapshot.quantity }),
      reason: snapshotReason(snapshot.reason ?? 'legacy'),
      reasons: snapshotReasons(snapshot.reasons ?? [snapshot.reason ?? 'legacy']),
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { version: 2, collection, wishlist, binders, history };
}

/** Identity includes personal valuation so merging never discards one user's evidence. */
export function entryIdentity(entry) {
  return JSON.stringify([
    entry.kind || 'card',
    entry.kind === 'sealed' ? [entry.productType || 'other', entry.edition || '', entry.productCode || '', entry.productUrl || ''] : null,
    entry.id, entry.lang || 'en', entry.variantId || null,
    entry.grading ? [entry.grading.company, entry.grading.grade] : null,
    entry.condition || (entry.kind === 'sealed' ? SEALED_CONDITIONS[0] : CONDITIONS[0]), entry.binderId || 'main',
    entry.manualValuation ? [entry.manualValuation.amount, entry.manualValuation.updatedAt, entry.manualValuation.note || '', entry.manualValuation.url || ''] : null,
  ]);
}

/** Merge identical holdings, preserving their total purchase cost without rounding. */
export function addCard(state, card, details = {}) {
  const metadata = cardMetadata({ ...card, id: card.id || (card.kind === 'sealed' ? `sealed-${uniqueId()}` : card.id), ...Object.fromEntries(['variantId', 'variantLabel', 'grading', 'manualValuation'].filter(key => Object.hasOwn(details, key)).map(key => [key, details[key]])) });
  const fields = entryDetails({ ...details, kind: metadata.kind }, state.binders);
  const identity = entryIdentity({ ...metadata, ...fields });
  const index = state.collection.findIndex(entry => entryIdentity(entry) === identity);
  let collection;
  if (index >= 0) {
    const previous = state.collection[index];
    const quantity = previous.quantity + fields.quantity;
    number(quantity, 'Combined quantity', { integer: true, minimum: 1, maximum: MAX_QUANTITY });
    let merged = { ...previous, ...metadata, ...fields, quantity, cost: (previous.cost * previous.quantity + fields.cost * fields.quantity) / quantity };
    if (metadata.kind === 'sealed') {
      merged.valuationHistory = mergeValuationHistory(previous.valuationHistory, metadata.valuationHistory);
      merged.image = metadata.image || previous.image || '';
    }
    const oldMarket = previous.market || legacyQuote(previous);
    const oldDate = Date.parse(oldMarket.providerUpdatedAt);
    const newDate = Date.parse(metadata.market.providerUpdatedAt);
    if ((metadata.price === null && previous.price !== null) || (Number.isFinite(oldDate) && (!Number.isFinite(newDate) || newDate < oldDate))) {
      merged = { ...merged, market: oldMarket, price: oldMarket.amount, priceUpdated: oldMarket.providerUpdatedAt || '', priceSource: oldMarket.source, lastValidMarket: previous.lastValidMarket || null };
    }
    collection = state.collection.map((entry, position) => position === index ? merged : entry);
  } else {
    if (state.collection.length >= MAX_ROWS) fail('The collection is too large to import safely in this browser.');
    collection = [...state.collection, { ...metadata, uid: uniqueId(), ...fields, addedAt: timestamp(details.addedAt, 'Date added') }];
  }
  return { ...state, version: 2, collection };
}

/** Update editable fields without losing source observations or personal valuations. */
export function updateEntry(state, uid, details = {}) {
  const existing = state.collection.find(entry => entry.uid === uid);
  if (!existing) fail('This collection entry no longer exists.');
  const next = { ...existing, ...details };
  if ((next.kind || 'card') !== (existing.kind || 'card')) fail('An existing entry cannot change between card and sealed product. Create a separate entry.');
  if (existing.kind === 'sealed') next.valuationHistory = mergeValuationHistory(existing.valuationHistory, details.valuationHistory);
  if (Object.hasOwn(details, 'price') && !Object.hasOwn(details, 'market')) {
    next.market = { ...existing.market, amount: details.price, providerUpdatedAt: Object.hasOwn(details, 'priceUpdated') ? details.priceUpdated : existing.market.providerUpdatedAt };
  }
  if (Object.hasOwn(details, 'variantId') && details.variantId !== existing.variantId && !Object.hasOwn(details, 'market')) {
    next.market = { ...existing.market, amount: null, mapping: 'unverified' };
    next.lastValidMarket = null;
  }
  const entry = { ...cardMetadata(next), ...entryDetails(next, state.binders), uid: existing.uid, addedAt: existing.addedAt };
  return { ...state, version: 2, collection: state.collection.map(item => item.uid === uid ? entry : item) };
}

/** A raw market quote never silently values a graded card or an unidentified finish. */
export function effectivePrice(entry) {
  if (entry.manualValuation) return number(entry.manualValuation.amount, 'Personal valuation');
  if (entry.grading) return null;
  const market = entry.market || legacyQuote(entry);
  if (entry.kind === 'sealed' && !usableSealedReference(entry, market)) return null;
  if (market.mapping === 'unverified' || (entry.variantId && market.mapping !== 'matched')) return null;
  return typeof market.amount === 'number' && Number.isFinite(market.amount) && market.amount > 0 ? market.amount : null;
}

/** Counts overlap: a stale generic reference contributes to both respective categories. */
export function priceCoverage(state, now = Date.now()) {
  const result = { quantity: 0, pricedQuantity: 0, manualQuantity: 0, currentQuantity: 0, staleQuantity: 0, genericQuantity: 0, unverifiedQuantity: 0, unpricedQuantity: 0, errorQuantity: 0, manualValue: 0, marketValue: 0 };
  for (const entry of state.collection) {
    const count = entry.quantity;
    const value = effectivePrice(entry);
    result.quantity += count;
    if (value === null) result.unpricedQuantity += count;
    else result.pricedQuantity += count;
    if (entry.manualValuation) {
      result.manualQuantity += count;
      result.manualValue += value * count;
      continue;
    }
    const market = entry.market || legacyQuote(entry);
    const status = quoteStatus(market, now);
    if (status === 'error') result.errorQuantity += count;
    if (market.mapping === 'unverified' || entry.grading || (entry.variantId && market.mapping !== 'matched') || (entry.kind === 'sealed' && !usableSealedReference(entry, market)) || status === 'unverified') result.unverifiedQuantity += count;
    if (value !== null) {
      result.marketValue += value * count;
      if (market.mapping === 'generic') result.genericQuantity += count;
      if (status === 'current') result.currentQuantity += count;
      const sourceDate = Date.parse(market.providerUpdatedAt);
      if (Number.isFinite(sourceDate) && now - sourceDate > 48 * 60 * 60 * 1000) result.staleQuantity += count;
    }
  }
  return result;
}

/** Merge public observations only. Holdings, cost, grading and personal valuation stay local. */
export function applyMarketUpdate(entry, bundle) {
  if (entry.kind === 'sealed') fail('Card market updates cannot be applied to a sealed product.');
  object(bundle, 'Price response');
  if (bundle.cardId !== entry.id) fail('The price response belongs to a different card.');
  const old = entry.market ? quote(entry.market) : legacyQuote(entry);
  const attemptedAt = nullableTimestamp(bundle.lastAttemptAt || bundle.fetchedAt, 'Price attempt date');
  const oldAttempt = Date.parse(old.lastAttemptAt || old.fetchedAt);
  const newAttempt = Date.parse(attemptedAt);
  if (Number.isFinite(oldAttempt) && Number.isFinite(newAttempt) && newAttempt < oldAttempt) return entry;
  const error = bundle.lastError === undefined || bundle.lastError === null ? null : text(bundle.lastError, 'Price error', '', 500);
  if (error) {
    const market = { ...old, lastAttemptAt: attemptedAt || old.lastAttemptAt, lastError: error };
    return { ...entry, market, price: market.amount, priceUpdated: market.providerUpdatedAt || '', priceSource: market.source };
  }
  const options = variants(bundle.variants);
  const selected = entry.variantId ? options.find(item => item.id === entry.variantId) : null;
  let market = quote(entry.variantId ? selected?.quote || { currency: 'EUR', amount: null, mapping: 'unverified', source: 'Cardmarket via TCGdex', metric: 'trend' } : bundle.reference);
  market = { ...market, fetchedAt: market.fetchedAt || nullableTimestamp(bundle.fetchedAt, 'Price fetch date'), lastAttemptAt: attemptedAt || market.lastAttemptAt };
  const oldDate = Date.parse(old.providerUpdatedAt), newDate = Date.parse(market.providerUpdatedAt);
  // A newer HTTP request is not evidence of a newer market observation.
  if (market.amount !== null && old.amount !== null && Number.isFinite(oldDate) && (!Number.isFinite(newDate) || newDate < oldDate)) {
    market = { ...old, lastAttemptAt: attemptedAt || old.lastAttemptAt, lastError: 'The provider returned an older or undated observation; the previous reference was kept.' };
  }
  const previousValid = old.amount !== null ? old : entry.lastValidMarket || null;
  return {
    ...entry, variants: options, market,
    price: market.amount, priceUpdated: market.providerUpdatedAt || '', priceSource: market.source,
    variantLabel: selected?.label || entry.variantLabel || 'Unspecified variant',
    lastValidMarket: market.amount !== null ? market : previousValid,
  };
}

/** Refresh public sealed retail evidence without overwriting the private product record. */
export function applySealedMarketUpdate(entry, product) {
  object(product, 'Sealed price response');
  if (entry.kind !== 'sealed' || product.kind !== 'sealed' || product.id !== entry.id) fail('The price response belongs to a different sealed product.');
  const old = entry.market ? quote(entry.market) : legacyQuote(entry);
  const attemptedAt = nullableTimestamp(product.lastAttemptAt || product.market?.lastAttemptAt || product.fetchedAt || product.market?.fetchedAt, 'Price attempt date');
  const oldAttempt = Date.parse(old.lastAttemptAt || old.fetchedAt);
  const newAttempt = Date.parse(attemptedAt);
  if (Number.isFinite(oldAttempt) && Number.isFinite(newAttempt) && newAttempt < oldAttempt) return entry;
  const error = product.lastError ?? product.market?.lastError ?? null;
  if (error) {
    const market = { ...old, lastAttemptAt: attemptedAt || old.lastAttemptAt, lastError: text(error, 'Price error', '', 500) };
    return { ...entry, market, price: market.amount, priceUpdated: market.providerUpdatedAt || '', priceSource: market.source };
  }
  let market = quote(product.market);
  if (!matchingSealedQuote(entry, market)) fail('The retail reference does not match the sealed product.');
  market = { ...market, fetchedAt: market.fetchedAt || nullableTimestamp(product.fetchedAt, 'Price fetch date'), lastAttemptAt: attemptedAt || market.lastAttemptAt };
  const oldDate = Date.parse(old.providerUpdatedAt), newDate = Date.parse(market.providerUpdatedAt);
  if (market.amount !== null && old.amount !== null && Number.isFinite(oldDate) && (!Number.isFinite(newDate) || newDate < oldDate)) {
    market = { ...old, lastAttemptAt: attemptedAt || old.lastAttemptAt, lastError: 'The provider returned an older or undated observation; the previous reference was kept.' };
  }
  const storesInStock = product.storesInStock === undefined ? entry.storesInStock ?? null : product.storesInStock === null ? null : number(product.storesInStock, 'Stores in stock', { integer: true, maximum: MAX_ROWS });
  return {
    ...entry, market, storesInStock,
    price: market.amount, priceUpdated: market.providerUpdatedAt || '', priceSource: market.source,
    sourceProductType: product.sourceProductType === undefined ? entry.sourceProductType || '' : text(product.sourceProductType, 'Provider product type', '', 120),
    lastValidMarket: market.amount !== null ? market : old.amount !== null ? old : entry.lastValidMarket || null,
  };
}

export function removeEntry(state, uid) {
  return { ...state, collection: state.collection.filter(entry => entry.uid !== uid) };
}

/** value and profit cover priced entries only; cost covers the whole collection. */
export function totals(state) {
  const result = { quantity: 0, unique: 0, value: 0, cost: 0, profit: 0, pricedQuantity: 0, unpricedQuantity: 0, sets: 0 };
  const unique = new Set();
  const sets = new Set();
  for (const entry of state.collection) {
    result.quantity += entry.quantity;
    result.cost += entry.cost * entry.quantity;
    unique.add(`${entry.kind || 'card'}:${entry.lang}:${entry.id}`);
    if (entry.kind !== 'sealed' && entry.setId) sets.add(entry.setId);
    const price = effectivePrice(entry);
    if (price !== null) {
      result.value += price * entry.quantity;
      result.profit += (price - entry.cost) * entry.quantity;
      result.pricedQuantity += entry.quantity;
    } else result.unpricedQuantity += entry.quantity;
  }
  result.unique = unique.size;
  result.sets = sets.size;
  return result;
}

function snapshotReason(value) {
  if (!SNAPSHOT_REASONS.includes(value)) fail('Unsupported snapshot reason.');
  return value;
}
function snapshotReasons(values) {
  if (!Array.isArray(values) || !values.length || values.length > SNAPSHOT_REASONS.length) fail('Snapshot reasons must be a short list.');
  return [...new Set(values.map(snapshotReason))];
}
/** Store one real aggregate per local calendar day, with causes rather than implied returns. */
export function recordSnapshot(state, reason = 'visit') {
  snapshotReason(reason);
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { value, cost, quantity, pricedQuantity } = totals(state);
  const prior = state.history.find(point => point.date === date);
  const reasons = [...new Set([...(prior?.reasons || (prior ? [prior.reason || 'legacy'] : [])), reason])];
  const snapshot = { date, value, cost, quantity, pricedQuantity, reason, reasons };
  return { ...state, history: [...state.history.filter(point => point.date !== date), snapshot].sort((a, b) => a.date.localeCompare(b.date)) };
}

function csvText(value) {
  let valueText = String(value ?? '');
  // Prefix dangerous spreadsheet formulas, and escape literal leading apostrophes reversibly.
  if (/^[\s]*[=+\-@]/.test(valueText) || /^[\t\r\n']/.test(valueText)) valueText = `'${valueText}`;
  return `"${valueText.replaceAll('"', '""')}"`;
}
function decodeCSVText(value) {
  return value.startsWith("'") && (/^'[\s]*[=+\-@]/.test(value) || /^'[\t\r\n']/.test(value)) ? value.slice(1) : value;
}

/** Export collection rows only. Use JSON for a complete backup including wishlist/history. */
export function exportCSV(state) {
  const rows = state.collection.map(entry => {
    const row = { ...entry, binderName: state.binders.find(binder => binder.id === entry.binderId)?.name ?? 'My collection' };
    return CSV_COLUMNS.map(column => csvText(JSON_COLUMNS.includes(column) ? JSON.stringify(row[column] ?? null) : row[column])).join(',');
  });
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

function parseCSV(source) {
  if (typeof source !== 'string' || source.length > 20 * 1024 * 1024) fail('Choose a CSV file smaller than 20 MB.');
  const input = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closedQuote = false;
  function finishField() { row.push(field); field = ''; closedQuote = false; }
  function finishRow() {
    finishField();
    if (row.some(cell => cell !== '')) rows.push(row);
    if (rows.length > MAX_ROWS + 1) fail('The CSV contains too many rows.');
    row = [];
  }
  for (let i = 0; i < input.length; i++) {
    const character = input[i];
    if (quoted) {
      if (character === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
    } else if (character === ',') finishField();
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[i + 1] === '\n') i++;
      finishRow();
    } else if (character === '"' && !field && !closedQuote) quoted = true;
    else {
      if (closedQuote || character === '"') fail('Malformed CSV: unexpected text around a quoted field.');
      field += character;
    }
  }
  if (quoted) fail('Malformed CSV: a quoted field was not closed.');
  if (field || row.length || closedQuote) finishRow();
  return rows;
}

/** Append CSV rows atomically. Invalid rows reject the entire import; existing state is untouched. */
export function importCSV(source, state = emptyState()) {
  const rows = parseCSV(source);
  if (!rows.length) fail('This CSV file is empty.');
  const headers = rows.shift().map(header => header.trim());
  if (new Set(headers).size !== headers.length) fail('CSV column names must be unique.');
  for (const column of ['id', 'name', 'quantity', 'cost']) if (!headers.includes(column)) fail(`CSV is missing the ${column} column. Export a collection to see the supported format.`);
  let result = state;
  for (const [index, values] of rows.entries()) {
    if (values.length !== headers.length) fail(`CSV row ${index + 2} has a different number of columns from the header.`);
    const raw = Object.fromEntries(headers.map((header, column) => [header, decodeCSVText(values[column])]));
    const readNumber = (field, fallback) => {
      if (raw[field] === undefined || raw[field] === '') {
        if (fallback !== undefined) return fallback;
        fail(`CSV row ${index + 2}: ${field} is required.`);
      }
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+\-]?\d+)?$/i.test(raw[field].trim())) fail(`CSV row ${index + 2}: ${field} must be numeric.`);
      return Number(raw[field]);
    };
    const readJSON = field => {
      if (raw[field] === undefined || raw[field] === '') return undefined;
      try { return JSON.parse(raw[field]); } catch { fail(`CSV row ${index + 2}: ${field} must contain valid JSON.`); }
    };
    const card = {
      ...raw,
      ...Object.fromEntries(JSON_COLUMNS.map(field => [field, readJSON(field)])),
      lang: raw.lang || 'en',
      setTotal: readNumber('setTotal', 0),
      storesInStock: readNumber('storesInStock', null),
      price: readNumber('price', null),
    };
    const binderId = raw.binderId || 'main';
    if (!result.binders.some(binder => binder.id === binderId)) {
      requiredText(binderId, 'Binder ID');
      result = { ...result, binders: [...result.binders, { id: binderId, name: requiredText(raw.binderName || binderId, 'Binder name', 100) }] };
    }
    try {
      result = addCard(result, card, {
        quantity: readNumber('quantity'), cost: readNumber('cost'), condition: raw.condition || undefined, binderId, addedAt: raw.addedAt || undefined,
      });
    } catch (error) { fail(`CSV row ${index + 2}: ${error.message}`); }
  }
  return result;
}
