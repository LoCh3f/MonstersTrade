/** TCGdex public catalogue. Market estimates are Cardmarket trends in EUR. */
import { providerMarketComparison } from './pricing.js';
import { CATALOGUE_LANGUAGES } from './languages.js';
import { catalogueAlias, pokemonNameForIds, printedSearchName, westernSearchTitle } from './pokemon-search.js';

const API = 'https://api.tcgdex.net/v2';
const TIMEOUT_MS = 12_000;
const CACHE_LIMIT = 180;
const cache = new Map();
const pending = new Map();
export const CATALOGUE_PAGE_SIZE = 24;
const PRINTINGS_PER_LANGUAGE = Math.floor(CATALOGUE_PAGE_SIZE / CATALOGUE_LANGUAGES.length);
const catalogueId = /^[a-z0-9.+]+(?:-[a-z0-9.+]+)*-\d+[a-z]?$/i;
class CatalogueNotFound extends Error {}

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
  if (!id || id.length > 100 || id.includes('..') || !/^[a-zA-Z0-9.+-]+$/.test(id)) {
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
        if (response.status === 404) throw new CatalogueNotFound('This card or set is not available in the selected language. Check its catalogue ID.');
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

// These are catalogue choices only, not validated price associations. Labels
// can be translated by TCGdex; identity always comes from card ID + variant ID.
function variantOptions(raw) {
  if (!Array.isArray(raw.variants_detailed)) return [];
  const seen = new Set();
  return raw.variants_detailed.slice(0, 32).flatMap(variant => {
    const id = variant?.variantId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    const type = typeof variant.type === 'string' ? variant.type.slice(0, 80) : 'Unspecified';
    const foil = typeof variant.foil === 'string' ? variant.foil.slice(0, 80) : '';
    const stamp = Array.isArray(variant.stamp) ? variant.stamp.filter(value => typeof value === 'string').slice(0, 8).map(value => value.slice(0, 80)) : [];
    const size = typeof variant.size === 'string' ? variant.size.slice(0, 80) : '';
    const label = [type, foil, ...stamp, size && size.toLowerCase() !== 'standard' ? size : ''].filter(Boolean).join(' · ');
    return [{ id, label, type, foil, stamp }];
  });
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
    pokemonName: pokemonNameForIds(raw.dexId),
    localId: String(raw.localId ?? ''),
    image: imageBase(raw.image),
    setId: typeof raw.set?.id === 'string' ? raw.set.id : '',
    setName: typeof raw.set?.name === 'string' ? raw.set.name : 'Unknown set',
    setTotal: Number.isInteger(setTotal) && setTotal > 0 ? setTotal : null,
    rarity: typeof raw.rarity === 'string' ? raw.rarity : 'Unspecified',
    price,
    priceUpdated: price === null ? null : timestamp,
    priceSource: price === null ? null : 'Cardmarket trend · EUR',
    comparison: providerMarketComparison(raw.pricing),
    variantOptions: variantOptions(raw),
    lang: language(lang),
  };
}

async function cardList(filters, lang, page, pageSize, pokemonName = '') {
  const params = new URLSearchParams({ ...filters, 'pagination:page': String(page), 'pagination:itemsPerPage': String(pageSize) });
  const data = await request(`${lang}/cards?${params}`, { ttl: 600_000 });
  if (!Array.isArray(data)) throw new Error('The catalogue could not return search results. Please try again.');
  return data.filter(card => card && typeof card.id === 'string' && typeof card.name === 'string').map(card => {
    const localId = String(card.localId ?? '');
    return {
      id: card.id, name: card.name, pokemonName, localId, image: imageBase(card.image), lang,
      setId: localId && card.id.endsWith(`-${localId}`) ? card.id.slice(0, -localId.length - 1) : '',
    };
  });
}

export async function searchCards(query, lang = 'en', page = 1, pageSize = CATALOGUE_PAGE_SIZE) {
  const term = String(query ?? '').trim().slice(0, 100);
  if (!term) return [];
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('Choose a valid catalogue page.');
  lang = language(lang);
  if (catalogueId.test(term)) return pageNumber === 1 ? [await getCard(term, lang)] : [];
  const westernSet = (lang === 'en' || lang === 'it') && term.match(/^(.+?)\s+(?:Pok[eé]mon(?:\s+Card)?\s+)?151$/i);
  if (westernSet) return cardList({ name: westernSearchTitle(westernSet[1], lang), 'set.id': 'eq:sv03.5' }, lang, pageNumber, pageSize);
  const pokemon = catalogueAlias(term, lang);
  if (!pokemon) return cardList({ name: westernSearchTitle(term, lang) }, lang, pageNumber, pageSize);

  const filters = {};
  if (pokemon.setCode) {
    const code = pokemon.setCode.toLowerCase();
    const set = (await getSets(lang)).find(row => typeof row?.id === 'string' && row.id.toLowerCase() === code);
    if (!set) return [];
    filters['set.id'] = `eq:${set.id}`;
  }
  if (pokemon.nativeNames) {
    const exactEx = (lang === 'ja' || lang === 'ko') && pokemon.suffix.toUpperCase() === 'EX';
    const names = pokemon.nativeNames.map(nativeName => printedSearchName({ nativeName, suffix: pokemon.suffix }, lang));
    if (pokemon.suffix && lang !== 'ja' && lang !== 'ko') filters.suffix = `eq:${pokemon.suffix.toUpperCase()}`;
    return cardList({ ...filters, name: `${exactEx ? 'eq:' : 'like:'}${names.join('|')}` }, lang, pageNumber, pageSize);
  }
  const printedName = printedSearchName(pokemon, lang);
  if (!pokemon.id) return cardList({ ...filters, name: printedName }, lang, pageNumber, pageSize);
  const suffix = pokemon.suffix.toUpperCase();
  if ((lang === 'ja' || lang === 'ko') && suffix === 'EX' && pokemon.nativeName) {
    // TCGdex groups ex and EX under the same suffix. The printed title distinguishes those eras.
    return cardList({ ...filters, name: `eq:${printedName}` }, lang, pageNumber, pageSize, pokemon.name);
  }
  if (suffix) filters.suffix = `eq:${suffix}`;
  const dexFilters = { ...filters, dexId: `eq:${pokemon.id}` };
  if (!pokemon.nativeName) return cardList(dexFilters, lang, pageNumber, pageSize, pokemon.name);

  // Base the fallback on page one so all pages use the same query strategy.
  const first = await cardList(dexFilters, lang, 1, pageSize, pokemon.name);
  if (first.length) return pageNumber === 1 ? first : cardList(dexFilters, lang, pageNumber, pageSize, pokemon.name);
  return cardList({ ...filters, name: printedName }, lang, pageNumber, pageSize, pokemon.name);
}

export async function searchCardPrintings(query, page, onFirstResults) {
  const term = String(query ?? '').trim().slice(0, 100);
  const exact = catalogueId.test(term);
  const batches = CATALOGUE_LANGUAGES.map(({code}) => ({ code, cards: [] }));
  let previewShown = false;
  await Promise.all(batches.map(async batch => {
    try {
      batch.cards = (await searchCards(term, batch.code, page, PRINTINGS_PER_LANGUAGE)).slice(0, PRINTINGS_PER_LANGUAGE);
    } catch (error) {
      if (!(exact && error instanceof CatalogueNotFound)) batch.error = error;
    }
    if (batch.cards.length && !previewShown && onFirstResults) {
      previewShown = true;
      onFirstResults(batch.cards);
    }
  }));
  if (batches.every(batch => batch.error)) throw batches[0].error;
  // Interleave results so that a common printing language cannot fill the page.
  const cards = [], seen = new Set();
  for (let i = 0; i < PRINTINGS_PER_LANGUAGE; i++) {
    for (const {code, cards: rows} of batches) {
      const card = rows[i];
      const key = card && `${code}:${card.id.toLowerCase()}`;
      if (card && !seen.has(key)) {
        seen.add(key);
        cards.push(card);
      }
    }
  }
  return {
    cards,
    hasMore: !exact && batches.some(batch => batch.cards.length === PRINTINGS_PER_LANGUAGE),
    unavailable: batches.filter(batch => batch.error).map(batch => batch.code),
  };
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
