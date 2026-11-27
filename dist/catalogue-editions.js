import { findCardPrintings } from './catalog.js';
import { CATALOGUE_LANGUAGES, marketLanguage } from './languages.js';
import { catalogueCardTitle, westernSearchTitle } from './pokemon-search.js';
import { isRegionalIdentity } from './regional-catalogue.js';

export const EDITION_LABELS = { tcg: 'TCG · Western', ocg: 'OCG · Asian' };

const regionOf = lang => marketLanguage(lang) === 'en' ? 'tcg' : 'ocg';
const numberKey = value => String(value ?? '').toLowerCase().replace(/^0+(?=\d)/, '');
const titleKey = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function editionIdentity(card) {
  const region = regionOf(card.lang);
  if (region === 'tcg') return { key: `tcg:${card.id.toLowerCase()}`, region, lookup: card.id };

  const code = isRegionalIdentity(card.id, card.lang) ? card.editionSetCode : card.setId;
  const number = String(card.localId ?? '');
  if (/^[a-z0-9]+(?:[.+-][a-z0-9]+)*$/i.test(code ?? '') && /^\d+[a-z]?$/i.test(number)) {
    return { key: `ocg:${code.toLowerCase()}:${numberKey(number)}`, region, lookup: `${code}-${number}` };
  }
  return { key: `ocg:${card.lang}:${card.id.toLowerCase()}`, region, lookup: '' };
}

export function groupCardEditions(cards, query) {
  const editions = new Map();
  for (const card of cards) {
    const identity = editionIdentity(card);
    if (!editions.has(identity.key)) editions.set(identity.key, { ...identity, card, printings: new Map() });
    const edition = editions.get(identity.key);
    if (!edition.printings.has(card.lang)) edition.printings.set(card.lang, card);
  }
  const regions = { tcg: [], ocg: [] };
  for (const edition of editions.values()) {
    const copies = [...edition.printings.values()];
    edition.card = edition.printings.get('en') || edition.printings.get('ja') || copies[0];
    edition.art = edition.card.image ? edition.card : copies.find(card => card.image) || edition.card;
    edition.setName = copies.find(card => card.setName && card.setName !== 'Unknown set')?.setName;
    regions[edition.region].push(edition);
  }
  const exact = titleKey(westernSearchTitle(query.replace(/\s+(?:Pok[eé]mon(?:\s+Card)?\s+)?151$/i, ''), 'en'));
  const rank = edition => titleKey(catalogueCardTitle(edition.card)) === exact ? 0 : 1;
  regions.tcg.sort((a, b) => rank(a) - rank(b));
  regions.ocg.sort((a, b) => rank(a) - rank(b));
  const merged = [];
  for (let i = 0; i < Math.max(regions.tcg.length, regions.ocg.length); i++) {
    if (regions.tcg[i]) merged.push(regions.tcg[i]);
    if (regions.ocg[i]) merged.push(regions.ocg[i]);
  }
  return merged;
}

export async function findEditionPrintings(edition) {
  const printings = new Map(edition.printings);
  const remaining = edition.lookup ? CATALOGUE_LANGUAGES.filter(({code}) => regionOf(code) === edition.region && !printings.has(code)) : [];
  const results = await Promise.allSettled(remaining.map(({code}) => findCardPrintings(edition.lookup, code)));
  const unavailable = [];
  for (const [index, result] of results.entries()) {
    const {code} = remaining[index];
    if (result.status === 'rejected') unavailable.push(code);
    else {
      const match = result.value.find(card => editionIdentity(card).key === edition.key);
      if (match) printings.set(code, match);
    }
  }
  return { printings, unavailable };
}
