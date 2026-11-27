import { catalogueAlias, printedSearchName, westernSearchTitle } from './pokemon-search.js';

const supportedLanguages = new Set(['ko', 'zh-cn', 'zh-tw', 'th', 'id']);
const catalogues = new Map();
const key = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const regId = (lang, setSlug) => `cc-${lang}-${setSlug}`;
const printedSetCode = value => value.split(' ')[0].toLowerCase();
const printingPosition = (code, localId) => `${code}:${String(localId).toLowerCase().replace(/^0+(?=\d)/, '')}`;
function editionCode(slug, code, lang) {
  // The Korean and Traditional Chinese Base Set share the 102-card numbering.
  if (slug === 'base-set' && (lang === 'ko' || lang === 'zh-tw')) return slug;
  return printedSetCode(code);
}

export function hasRegionalCatalogue(lang) {
  return supportedLanguages.has(lang);
}

export function isRegionalIdentity(id, lang) {
  return hasRegionalCatalogue(lang) && typeof id === 'string' && id.startsWith(`cc-${lang}-`);
}

async function regionalCatalogue(lang) {
  if (!hasRegionalCatalogue(lang)) throw new Error('This regional catalogue is unavailable.');
  if (!catalogues.has(lang)) {
    const promise = (async () => {
      const response = await fetch(`./catalogues/cardcorpus-${lang}.json`, { credentials: 'omit', signal: AbortSignal.timeout?.(8000) });
      if (!response.ok) throw new Error('The supplementary catalogue could not be loaded.');
      const { sets, cards } = await response.json();
      if (!Array.isArray(sets) || !Array.isArray(cards)) throw new Error('The supplementary catalogue could not be read.');
      const setCodes = new Map();
      for (const [slug, code] of sets) {
        const key = editionCode(slug, code, lang);
        if (key) setCodes.set(key, (setCodes.get(key) || 0) + 1);
      }
      const positions = new Map(), byCardId = new Map();
      for (const row of cards) {
        const [index, id, localId] = row;
        const [slug, code] = sets[index];
        byCardId.set(`${regId(lang, slug)}-${id}`, row);
        const key = printingPosition(editionCode(slug, code, lang), localId);
        positions.set(key, (positions.get(key) || 0) + 1);
      }
      return { sets, cards, byCardId, setCodes, positions };
    })().catch(error => {
      catalogues.delete(lang);
      throw error;
    });
    catalogues.set(lang, promise);
  }
  return catalogues.get(lang);
}

function cardFromRow(row, catalogue, lang) {
  const [setIndex, id, localId, name, englishName, picture, rarity] = row;
  const [slug, setCode, setName, setTotal] = catalogue.sets[setIndex];
  const setId = regId(lang, slug);
  const code = editionCode(slug, setCode, lang);
  const uniquePosition = catalogue.setCodes.get(code) === 1 && catalogue.positions.get(printingPosition(code, localId)) === 1;
  return {
    id: `${setId}-${id}`, name, pokemonName: englishName, localId: String(localId), setId, setName, setCode,
    editionSetCode: uniquePosition ? code : '',
    setTotal: Number.isInteger(setTotal) && setTotal > 0 ? setTotal : null, rarity: rarity || 'Unspecified', lang,
    image: picture ? `https://img.cardcorpus.com/s1/480/${picture}.avif` : '',
    variantOptions: [],
  };
}

export async function searchRegionalCards(term, lang, page, pageSize, exactId) {
  const catalogue = await regionalCatalogue(lang);
  if (isRegionalIdentity(term, lang)) {
    const match = catalogue.byCardId.get(term);
    return match && page === 1 ? [cardFromRow(match, catalogue, lang)] : [];
  }
  const alias = catalogueAlias(term, lang);
  const setCode = alias?.setCode?.toLowerCase();
  const translated = alias?.name && [alias.name, alias.suffix].filter(Boolean).join(' ');
  const native = alias?.nativeNames ?? (alias?.nativeName ? [alias.nativeName] : []);
  const printedNames = native.map(nativeName => lang === 'ko' ? printedSearchName({nativeName, suffix: alias.suffix}, lang) : [nativeName, alias.suffix].filter(Boolean).join(' '));
  const terms = [term, westernSearchTitle(term, 'en'), translated, ...printedNames]
    .filter(Boolean).map(key).filter(Boolean);
  if (!terms.length) return [];

  const exact = [], partial = [];
  const idTerm = term.toLowerCase();
  for (const row of catalogue.cards) {
    const [setIndex, id, localId, name, englishName] = row;
    const [slug, printedCode, setName] = catalogue.sets[setIndex];
    const code = printedSetCode(printedCode);
    if (exactId) {
      if ([code, slug].filter(Boolean).some(set => {
        if (!idTerm.startsWith(`${set}-`)) return false;
        const number = idTerm.slice(set.length + 1);
        return number === id.toLowerCase() || printingPosition(set, number) === printingPosition(set, localId);
      })) exact.push(row);
      continue;
    }
    if (setCode && setCode !== code && setCode !== slug && !(setCode === '151' && setName.includes('151'))) continue;
    const titles = [key(name), key(englishName)].filter(Boolean);
    if (titles.some(title => terms.includes(title))) exact.push(row);
    else if (titles.some(title => terms.some(term => title.includes(term)))) partial.push(row);
  }
  return [...exact, ...partial].slice((page - 1) * pageSize, page * pageSize).map(row => cardFromRow(row, catalogue, lang));
}

export async function getRegionalCard(id, lang) {
  const catalogue = await regionalCatalogue(lang);
  const row = catalogue.byCardId.get(id);
  if (!row) throw new Error('This card is unavailable in the regional catalogue.');
  return cardFromRow(row, catalogue, lang);
}

export async function getRegionalSet(id, lang) {
  const catalogue = await regionalCatalogue(lang);
  const index = catalogue.sets.findIndex(([slug]) => regId(lang, slug) === id);
  if (index === -1) throw new Error('This set is unavailable in the regional catalogue.');
  return { id, name: catalogue.sets[index][2], cards: catalogue.cards.filter(row => row[0] === index).map(row => cardFromRow(row, catalogue, lang)) };
}
