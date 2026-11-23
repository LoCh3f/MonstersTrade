/** TCGdex public catalogue. Market estimates are Cardmarket trends in EUR. */
const API = 'https://api.tcgdex.net/v2';
const TIMEOUT_MS = 12_000;
const CACHE_LIMIT = 180;
const cache = new Map();
const pending = new Map();

export const FEATURED_IDS = Object.freeze([
  'swsh7-215', 'sv08-238', 'sv03.5-199',
  'sv03.5-198', 'sv03.5-200', 'sv03.5-205',
]);

function language(value) {
  if (typeof value !== 'string' || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(value)) {
    throw new Error('Choose a valid catalogue language, such as en or it.');
  }
  return value;
}

function cardId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 100 || !/^[a-zA-Z0-9.\-]+$/.test(id)) {
    throw new Error('Enter a valid TCGdex card or set ID.');
  }
  return id;
}

function remember(key, value, ttl) {
  cache.delete(key);
  cache.set(key, { value, expires: Date.now() + ttl });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

async function request(path, { force = false, ttl = 3_600_000 } = {}) {
  const url = `${API}/${path}`;
  const stored = cache.get(url);
  if (!force && stored && stored.expires > Date.now()) {
    cache.delete(url);
    cache.set(url, stored);
    return structuredClone(stored.value);
  }
  if (pending.has(url)) return structuredClone(await pending.get(url));
  const task = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) {
        if (response.status === 404) throw new Error('This card or set is not available in the selected language. Try English or check its ID.');
        if (response.status === 429) throw new Error('The card catalogue is busy. Wait a moment before searching or refreshing again.');
        throw new Error(`The card catalogue is unavailable (HTTP ${response.status}). Please try again later.`);
      }
      const data = await response.json();
      remember(url, data, ttl);
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('The card catalogue took too long to respond. Check your connection and try again.');
      if (error instanceof TypeError) throw new Error('Cannot reach the card catalogue. Check your internet connection and try again.');
      if (error instanceof SyntaxError) throw new Error('The catalogue returned an unreadable response. Please try again later.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  pending.set(url, task);
  try {
    return structuredClone(await task);
  } finally {
    pending.delete(url);
  }
}

function imageBase(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'assets.tcgdex.net' ? url.href : '';
  } catch {
    return '';
  }
}

/** No price is invented when the source has no usable EUR trend. */
export function normalizeCard(raw, lang = 'en') {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new Error('The catalogue returned incomplete card details. Please try another card.');
  }
  const market = raw.pricing?.cardmarket;
  const price = market?.unit === 'EUR' && typeof market.trend === 'number' && Number.isFinite(market.trend) && market.trend > 0
    ? market.trend : null;
  const timestamp = typeof market?.updated === 'string' && Number.isFinite(Date.parse(market.updated))
    ? market.updated : null;
  const setTotal = raw.set?.cardCount?.total;
  return {
    id: raw.id,
    name: raw.name,
    localId: String(raw.localId ?? ''),
    image: imageBase(raw.image),
    setId: typeof raw.set?.id === 'string' ? raw.set.id : '',
    setName: typeof raw.set?.name === 'string' ? raw.set.name : 'Unknown set',
    setTotal: Number.isInteger(setTotal) && setTotal > 0 ? setTotal : null,
    rarity: typeof raw.rarity === 'string' ? raw.rarity : 'Unspecified',
    price,
    priceUpdated: price === null ? null : timestamp,
    priceSource: price === null ? null : 'Cardmarket trend · EUR',
    lang: language(lang),
  };
}

export async function searchCards(query, lang = 'en', page = 1) {
  const term = String(query ?? '').trim().slice(0, 100);
  if (!term) return [];
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('Choose a valid catalogue page.');
  const params = new URLSearchParams({ name: term, 'pagination:page': String(pageNumber), 'pagination:itemsPerPage': '24' });
  const data = await request(`${language(lang)}/cards?${params}`, { ttl: 600_000 });
  if (!Array.isArray(data)) throw new Error('The catalogue could not return search results. Please try again.');
  return data.filter(card => card && typeof card.id === 'string' && typeof card.name === 'string').map(card => ({
    id: card.id,
    name: card.name,
    localId: String(card.localId ?? ''),
    image: imageBase(card.image),
    lang,
  }));
}

export async function getCard(id, lang = 'en', force = false) {
  const data = await request(`${language(lang)}/cards/${encodeURIComponent(cardId(id))}`, { force });
  return normalizeCard(data, lang);
}

export async function getSet(id, lang = 'en') {
  const data = await request(`${language(lang)}/sets/${encodeURIComponent(cardId(id))}`, { ttl: 86_400_000 });
  if (!data || typeof data.id !== 'string' || !Array.isArray(data.cards)) {
    throw new Error('The catalogue returned incomplete set details. Please try another set.');
  }
  return data;
}

export async function getSets(lang = 'en') {
  const data = await request(`${language(lang)}/sets`, { ttl: 86_400_000 });
  if (!Array.isArray(data)) throw new Error('The catalogue could not return the set list. Please try again later.');
  return data;
}

export function cardImage(card, quality = 'low') {
  const local = card?.localImage;
  if (typeof local === 'string' && /^\.?\/?assets\/[a-zA-Z0-9._-]+\.(?:webp|png|jpg)$/.test(local)) return local;
  const base = imageBase(card?.image);
  if (!base) return '';
  if (/\.(?:webp|png|jpg)$/i.test(base)) return base;
  return `${base.replace(/\/$/, '')}/${quality === 'high' ? 'high' : 'low'}.webp`;
}
