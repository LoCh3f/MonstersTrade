import { normalizeMarketComparison, normalizeQuote } from './pricing.js';
import { marketCardKey, marketLanguage } from './languages.js';

// This cache contains public quotations only. Personal collection fields never
// cross this module's network boundary.
const CACHE_KEY = 'pocketvault.prices.v1';
const CACHE_TTL = 10 * 60_000;
const CACHE_LIMIT = 100;
const CACHE_BYTES = 1_000_000;
const TIMEOUT_MS = 12_000;
const cache = new Map();
const pending = new Map();
const cooldowns = new Map();
const metrics = new Set(['trend', 'trend-holo', 'legacy']);
const mappings = new Set(['generic', 'matched', 'unverified']);

function id(value, label = 'card') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) {
    throw new Error(`Choose a valid ${label} identifier.`);
  }
  return value;
}

function date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 50 || !Number.isFinite(Date.parse(value))) {
    throw new Error('The price service returned an invalid date.');
  }
  return value;
}

function text(value, maximum = 200) {
  return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function quote(value) {
  if (!value || typeof value !== 'object' || value.currency !== 'EUR'
    || !metrics.has(value.metric) || !mappings.has(value.mapping)
    || !(value.amount === null || (typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 && value.amount <= 1e9))
    || typeof value.source !== 'string' || !value.source.trim()
    || !(value.productId === null || value.productId === undefined || (Number.isSafeInteger(value.productId) && value.productId > 0))) {
    throw new Error('The price service returned an invalid EUR quotation.');
  }
  return normalizeQuote({
    amount: value.amount, currency: 'EUR', source: text(value.source),
    metric: value.metric, productId: value.productId ?? null,
    providerUpdatedAt: date(value.providerUpdatedAt), fetchedAt: date(value.fetchedAt),
    lastAttemptAt: date(value.lastAttemptAt), lastError: text(value.lastError, 300) || null,
    mapping: value.mapping,
  });
}

function matchesCard(value, cardId, language) {
  return typeof value?.cardId === 'string' && (value.catalogueLanguage ?? 'en') === language
    && marketCardKey(value.cardId, language) === marketCardKey(cardId, language);
}

function bundle(value, expectedId, language) {
  if (!matchesCard(value, expectedId, language) || !Array.isArray(value.variants) || value.variants.length > 32) {
    throw new Error('The price service returned mismatched card details.');
  }
  const seen = new Set();
  const variants = value.variants.map(variant => {
    if (!variant || seen.has(id(variant.id, 'variant')) || typeof variant.label !== 'string' || !variant.label.trim()) {
      throw new Error('The price service returned invalid variant details.');
    }
    seen.add(variant.id);
    return {
      id: variant.id, label: text(variant.label), type: text(variant.type, 80),
      stamp: (Array.isArray(variant.stamp) ? variant.stamp : variant.stamp ? [variant.stamp] : []).slice(0, 8).map(value => text(value, 80)),
      foil: text(variant.foil, 80), quote: quote(variant.quote),
    };
  });
  return {
    cardId: expectedId, catalogueLanguage: language, reference: quote(value.reference), variants,
    comparison: normalizeMarketComparison(value.comparison),
    fetchedAt: date(value.fetchedAt), lastAttemptAt: date(value.lastAttemptAt),
    lastError: text(value.lastError, 300) || null,
  };
}

function loadCache() {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw || raw.length > CACHE_BYTES) return;
    const stored = JSON.parse(raw);
    if (stored.version !== 1 || !Array.isArray(stored.entries)) return;
    for (const entry of stored.entries.slice(-CACHE_LIMIT)) {
      try {
        const cardId = id(entry.cardId);
        const language = marketLanguage(entry.value?.catalogueLanguage);
        if (!Number.isFinite(entry.savedAt) || entry.savedAt > Date.now() + 60_000) continue;
        cache.set(marketCardKey(cardId, language), { value: bundle(entry.value, cardId, language), savedAt: entry.savedAt });
      } catch { /* One invalid cache record must not hide the other records. */ }
    }
  } catch { /* Restricted/quota-limited browser storage does not disable prices. */ }
}

function persistCache() {
  try {
    let entries = [...cache.values()].map(stored => ({ cardId: stored.value.cardId, ...stored }));
    let serialized = JSON.stringify({ version: 1, entries });
    while (serialized.length > CACHE_BYTES && entries.length) {
      entries.shift();
      serialized = JSON.stringify({ version: 1, entries });
    }
    globalThis.localStorage?.setItem(CACHE_KEY, serialized);
  } catch { /* Keep the in-memory cache when local storage is full or disabled. */ }
}

function remember(cardId, value) {
  cache.delete(cardId);
  cache.set(cardId, { value, savedAt: Date.now() });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  persistCache();
}

loadCache();

function retryDelay(response) {
  const header = response.headers?.get('Retry-After');
  if (!header) return 600;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 600;
}

async function requestJSON(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(path, {
        method: 'GET', credentials: 'omit', mode: 'same-origin', redirect: 'error',
        cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (response.ok) return await response.json();
      const retryable = response.status === 429 || response.status === 503;
      const delay = retryable ? retryDelay(response) : 0;
      // Do not keep a page waiting for a long Retry-After, or retry too early.
      if (retryable && attempt === 0 && delay <= 3000) {
        try { await response.body?.cancel(); } catch {}
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(wait); reject(new DOMException('Aborted', 'AbortError')); };
          const wait = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, delay);
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) abort();
        });
        continue;
      }
      const message = response.status === 404
        ? 'The public price service or this card is unavailable on this deployment.'
        : response.status === 429
          ? 'The public price service is busy. Wait before checking again.'
          : `The public price service is unavailable (HTTP ${response.status}).`;
      const error = new Error(message);
      if (retryable) error.retryAt = Date.now() + Math.max(delay, 30_000);
      throw error;
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The public price service took too long to respond. Previous references are retained.');
    if (error instanceof TypeError) throw new Error('Cannot reach the public price service. Previous references are retained.');
    if (error instanceof SyntaxError) throw new Error('The public price service returned an unreadable response. Previous references are retained.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function previousWithError(stored, error, attemptedAt) {
  const previous = structuredClone(stored.value);
  const update = old => ({ ...old, lastAttemptAt: attemptedAt, lastError: error.message });
  return {
    ...previous, lastAttemptAt: attemptedAt, lastError: error.message,
    reference: update(previous.reference),
    variants: previous.variants.map(variant => ({ ...variant, quote: update(variant.quote) })),
  };
}

// A browser check and a provider acquisition are different events. The Worker
// may legitimately return yesterday's shared cache after this browser recovers
// from an error. Mark the local check without re-dating the underlying quote.
function checkedBundle(value, checkedAt) {
  const result = structuredClone(value);
  result.lastAttemptAt = checkedAt;
  result.reference.lastAttemptAt = checkedAt;
  result.variants = result.variants.map(variant => ({
    ...variant, quote: { ...variant.quote, lastAttemptAt: checkedAt },
  }));
  return result;
}

/** Fetches only public prices for an identifier; never accepts collection rows. */
export async function getPrices(cardId, { force = false, lang = 'en' } = {}) {
  cardId = id(cardId);
  const language = marketLanguage(lang);
  const key = marketCardKey(cardId, language);
  const stored = cache.get(key);
  const cooldown = cooldowns.get(key);
  const forCard = value => ({ ...value, cardId });
  if (cooldown && cooldown.until > Date.now()) {
    if (stored) return forCard(previousWithError(stored, cooldown.error, cooldown.attemptedAt));
    throw cooldown.error;
  }
  if (!force && stored && stored.savedAt + CACHE_TTL > Date.now()) return forCard(checkedBundle(stored.value, new Date().toISOString()));
  if (pending.has(key)) return forCard(structuredClone(await pending.get(key)));
  const attemptedAt = new Date().toISOString();
  const task = (async () => {
    try {
      const params = new URLSearchParams();
      if (language !== 'en') params.set('lang', language);
      if (force) params.set('refresh', '1');
      const value = checkedBundle(bundle(await requestJSON(`/api/prices/${encodeURIComponent(cardId)}${params.size ? `?${params}` : ''}`), cardId, language), attemptedAt);
      // A replica returning an older cached bundle must not roll the browser back.
      const previousDate = Date.parse(stored?.value.fetchedAt);
      const nextDate = Date.parse(value.fetchedAt);
      if (Number.isFinite(previousDate) && (!Number.isFinite(nextDate) || nextDate < previousDate)) {
        const error = new Error('The price service returned an older snapshot. The newer reference is retained.');
        return previousWithError(stored, error, attemptedAt);
      }
      cooldowns.delete(key);
      remember(key, value);
      return value;
    } catch (error) {
      cooldowns.set(key, { until: error.retryAt || Date.now() + 30_000, error, attemptedAt });
      while (cooldowns.size > CACHE_LIMIT) cooldowns.delete(cooldowns.keys().next().value);
      if (stored) return previousWithError(stored, error, attemptedAt);
      throw error;
    }
  })();
  pending.set(key, task);
  try { return forCard(structuredClone(await task)); }
  finally { pending.delete(key); }
}

/** Server history contains public observations, not personal portfolio values. */
export async function getPriceHistory(cardId, variantId = null, days = 90, lang = 'en') {
  cardId = id(cardId);
  const language = marketLanguage(lang);
  const selected = variantId === null ? 'generic' : id(variantId, 'variant');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Choose a history period between 1 and 365 days.');
  const params = new URLSearchParams({ variant: selected, days: String(days) });
  if (language !== 'en') params.set('lang', language);
  const value = await requestJSON(`/api/prices/${encodeURIComponent(cardId)}/history?${params}`);
  if (!matchesCard(value, cardId, language) || (value.variantId ?? 'generic') !== selected || !Array.isArray(value.points) || value.points.length > 366) {
    throw new Error('The price service returned mismatched history.');
  }
  const seen = new Set();
  const points = value.points.map(point => {
    if (!point || typeof point.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(point.date)
      || !Number.isFinite(Date.parse(point.date)) || new Date(`${point.date}T00:00:00Z`).toISOString().slice(0, 10) !== point.date
      || seen.has(point.date) || typeof point.amount !== 'number' || !Number.isFinite(point.amount) || point.amount <= 0
      || !mappings.has(point.mapping)) throw new Error('The price service returned invalid history observations.');
    seen.add(point.date);
    return { date: point.date, amount: point.amount, providerUpdatedAt: date(point.providerUpdatedAt), fetchedAt: date(point.fetchedAt), mapping: point.mapping };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { cardId, variantId: variantId === null ? null : selected, points, retentionDays: 365 };
}

export async function priceServiceHealth() {
  const health = await requestJSON('/api/health');
  if (!health || typeof health !== 'object' || typeof health.configured !== 'boolean') {
    throw new Error('The public price service returned an invalid status.');
  }
  return { configured: health.configured, status: text(health.status, 80) || (health.configured ? 'ready' : 'unconfigured'), retentionDays: 365 };
}
