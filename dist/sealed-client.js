// Only public product identifiers and catalogue filters cross this boundary.
const TTL = 10 * 60_000;
const LIMIT = 100;
const MAX_BYTES = 1_000_000;
const TIMEOUT = 12_000;
const types = new Set(['booster-pack', 'booster-box', 'elite-trainer-box', 'collection-box', 'tin', 'blister', 'bundle', 'other']);
const cache = new Map();
const pending = new Map();
const cooldowns = new Map();
let cacheBytes = 0;

function identifier(value) {
  const match = typeof value === 'string' && /^sealed-tcgp-([1-9]\d{0,14})-eu$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Choose a valid sealed product identifier.');
  return value;
}
function text(value, maximum = 300) { return typeof value === 'string' ? value.slice(0, maximum) : ''; }
function date(value, required = false) {
  if (!required && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || value.length > 50 || !Number.isFinite(Date.parse(value))) throw new Error('The sealed price service returned an invalid date.');
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error('The sealed price service returned an invalid date.');
  return value;
}
function sourceURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'tcgprices.app' && url.pathname.startsWith('/card/') && url.pathname.length > 6 && !url.username && !url.password && !url.port && url.href.length <= 2048) return url.href;
  } catch {}
  throw new Error('The sealed price service returned an invalid product source link.');
}
function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9; }
function product(value, expectedId = null) {
  if (!value || value.kind !== 'sealed' || identifier(value.id) !== (expectedId || value.id)
    || typeof value.name !== 'string' || !value.name.trim() || !types.has(value.productType)
    || value.lang !== 'und' || !['Pokémon', 'Pokémon Japan'].includes(value.game)) throw new Error('The sealed price service returned mismatched product details.');
  const productId = Number(value.id.split('-')[2]);
  const q = value.market;
  if (!q || q.currency !== 'EUR' || q.metric !== 'store-low' || q.mapping !== 'matched'
    || q.productId !== productId || !(q.amount === null || positive(q.amount))
    || typeof q.source !== 'string' || !q.source.trim()
    || String(value.productCode) !== String(productId)) throw new Error('The sealed price service returned an invalid EUR retail reference.');
  const market = {
    amount: q.amount, currency: 'EUR', source: text(q.source, 200), metric: 'store-low', productId,
    providerUpdatedAt: date(q.providerUpdatedAt, q.amount !== null), fetchedAt: date(q.fetchedAt, q.amount !== null),
    lastAttemptAt: date(q.lastAttemptAt), lastError: text(q.lastError, 500) || null, mapping: 'matched',
  };
  if (!Number.isInteger(value.storesInStock) || value.storesInStock < 0 || value.storesInStock > 1e6) throw new Error('The sealed price service returned an invalid store count.');
  return {
    id: value.id, kind: 'sealed', name: text(value.name), setName: text(value.setName), setId: '', lang: 'und',
    productType: value.productType, edition: '', productCode: String(productId), productUrl: sourceURL(value.productUrl),
    game: value.game, market, sourceProductType: text(value.sourceProductType, 100), storesInStock: value.storesInStock,
    fetchedAt: date(value.fetchedAt, true), lastAttemptAt: date(value.lastAttemptAt), lastError: text(value.lastError, 500) || null,
    price: market.amount, priceUpdated: market.providerUpdatedAt || '',
  };
}
function resultList(value, page) {
  if (!value || !Array.isArray(value.items) || value.items.length > 100 || !Number.isInteger(value.total) || value.total < 0
    || value.page !== page || !Number.isInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 100
    || value.items.length > value.pageSize || value.items.length > value.total) throw new Error('The sealed catalogue returned an invalid result page.');
  const items = value.items.map(item => product(item));
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('The sealed catalogue returned duplicate products.');
  return { items, total: value.total, page, pageSize: value.pageSize, fetchedAt: date(value.fetchedAt, items.length > 0),
    lastAttemptAt: date(value.lastAttemptAt), lastError: text(value.lastError, 500) || null,
    source: text(value.source, 200), attributionUrl: 'https://tcgprices.app/data' };
}
function history(value, id) {
  if (!value || value.productId !== id || value.currency !== 'EUR' || !Array.isArray(value.points) || value.points.length > 366) throw new Error('The sealed price service returned mismatched history.');
  const seen = new Set();
  const points = value.points.map(point => {
    if (!point || typeof point.date !== 'string' || point.date.length !== 10 || !positive(point.amount) || seen.has(point.date)) throw new Error('The sealed price service returned invalid history observations.');
    date(point.date, true); seen.add(point.date);
    return { date: point.date, amount: point.amount, providerUpdatedAt: date(point.providerUpdatedAt, true), fetchedAt: date(point.fetchedAt, true) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { productId: id, points, retentionDays: 365, currency: 'EUR', lastError: text(value.lastError, 500) || null,
    source: text(value.source, 200) || 'TCGPrices · EU retail', attributionUrl: 'https://tcgprices.app/data' };
}
function remember(key, value) {
  const bytes = JSON.stringify(value).length;
  if (bytes > MAX_BYTES) return;
  if (cache.has(key)) cacheBytes -= cache.get(key).bytes;
  cache.delete(key); cache.set(key, { value, bytes, savedAt: Date.now() }); cacheBytes += bytes;
  while (cache.size > LIMIT || cacheBytes > MAX_BYTES) {
    const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).bytes; cache.delete(oldest);
  }
}
function checked(value, attemptedAt, error = null) {
  const result = structuredClone(value);
  result.lastAttemptAt = attemptedAt;
  if (error) result.lastError = error.message;
  if (result.market) result.market = { ...result.market, lastAttemptAt: attemptedAt, ...(error ? { lastError: error.message } : {}) };
  if (result.items) result.items = result.items.map(item => checked(item, attemptedAt, error));
  return result;
}
async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(path, { method: 'GET', credentials: 'omit', mode: 'same-origin', redirect: 'error',
      cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (response.ok) return await response.json();
    const error = new Error(response.status === 404 ? 'This sealed product or the sealed price service is unavailable.'
      : response.status === 429 ? 'The sealed price service is busy. Please check again later.'
        : `The sealed price service is unavailable (HTTP ${response.status}).`);
    const retry = response.headers?.get('Retry-After');
    const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    error.retryAt = Date.now() + Math.max(30_000, Number.isFinite(delay) ? delay : 0);
    throw error;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The sealed price service took too long to respond. Saved references are retained.');
    if (error instanceof TypeError) throw new Error('Cannot reach the sealed price service. Saved references are retained.');
    if (error instanceof SyntaxError) throw new Error('The sealed price service returned an unreadable response.');
    throw error;
  } finally { clearTimeout(timer); }
}
async function cachedRequest(key, path, normalize, force = false) {
  const stored = cache.get(key);
  const attemptedAt = new Date().toISOString();
  const cooldown = cooldowns.get(key);
  if (cooldown && cooldown.until > Date.now()) {
    if (stored) return checked(stored.value, cooldown.attemptedAt, cooldown.error);
    throw cooldown.error;
  }
  if (!force && stored && stored.savedAt + TTL > Date.now()) return checked(stored.value, attemptedAt);
  if (pending.has(key)) return structuredClone(await pending.get(key));
  const task = (async () => {
    try {
      const value = normalize(await request(path));
      const oldDate = Date.parse(stored?.value.market?.providerUpdatedAt || stored?.value.fetchedAt);
      const newDate = Date.parse(value.market?.providerUpdatedAt || value.fetchedAt);
      const oldFetch = Date.parse(stored?.value.fetchedAt);
      const newFetch = Date.parse(value.fetchedAt);
      if ((Number.isFinite(oldDate) && (!Number.isFinite(newDate) || newDate < oldDate))
        || (Number.isFinite(oldFetch) && (!Number.isFinite(newFetch) || newFetch < oldFetch))) throw new Error('The sealed service returned an older snapshot. The newer reference is retained.');
      cooldowns.delete(key); remember(key, value);
      return checked(value, attemptedAt);
    } catch (error) {
      cooldowns.set(key, { until: error.retryAt || Date.now() + 30_000, error, attemptedAt });
      while (cooldowns.size > LIMIT) cooldowns.delete(cooldowns.keys().next().value);
      if (stored) return checked(stored.value, attemptedAt, error);
      throw error;
    }
  })();
  pending.set(key, task);
  try { return structuredClone(await task); } finally { pending.delete(key); }
}

export async function searchSealed(query = '', { type = '', page = 1 } = {}) {
  if (typeof query !== 'string' || query.length > 160 || /[\u0000-\u001f]/.test(query)) throw new Error('Use a sealed product search of at most 160 characters.');
  if (type && !types.has(type)) throw new Error('Choose a supported sealed product type.');
  if (!Number.isInteger(page) || page < 1 || page > 10_000) throw new Error('Choose a valid catalogue page.');
  const params = new URLSearchParams({ q: query.trim(), type, page: String(page) });
  const path = `/api/sealed?${params}`;
  return cachedRequest(path, path, value => resultList(value, page));
}
export async function getSealedProduct(id, { force = false } = {}) {
  id = identifier(id);
  const path = `/api/sealed/${encodeURIComponent(id)}`;
  return cachedRequest(path, path, value => product(value, id), force === true);
}
export async function getSealedHistory(id, days = 90) {
  id = identifier(id);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Choose a history period between 1 and 365 days.');
  const path = `/api/sealed/${encodeURIComponent(id)}/history?days=${days}`;
  return cachedRequest(path, path, value => history(value, id));
}
