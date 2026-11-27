import { marketLanguage } from './languages.js';
import { speciesNames } from './pokemon-names.js';

const nativeColumns = { ja: 1, ko: 2, 'zh-tw': 3, 'zh-cn': 4 };
const cardSuffix = /(V-UNION|VSTAR|VMAX|GX|EX|V)$/i;
const searchSuffix = /(?:\s+|\s*\p{Dash_Punctuation}\s*)(V-UNION|VSTAR|VMAX|GX|EX|V)$/iu;
const nameKey = name => name.normalize('NFKD').replace(/\p{M}|[^\p{L}\p{N}♀♂]/gu, '').toLowerCase();
const asianScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const set151Qualifier = [/\s+(?:Pok[eé]mon(?:\s+Card)?\s+)?151$/i, 'sv2a'];
const japaneseSetNames = new Map([
  ['sv4a', 'Shiny Treasure ex'],
  ['sv8a', 'Terastal Festival ex'],
]);
const setQualifiers = {
  ja: [set151Qualifier, [/\s+Shiny\s+Treasure(?:\s+ex)?$/i, 'sv4a'], [/\s+Terastal\s+Festival(?:\s+ex)?$/i, 'sv8a']],
  ko: [set151Qualifier],
};
const cardNameColumns = { ja: 2, ko: 3 };
// Official card titles in English, Italian, Japanese, and Korean.
const localizedCardNames = [
  ['Boss’s Orders', 'Ordini del Capo', 'ボスの指令', '보스의 지령'],
  ['Professor’s Research', 'Ricerca Accademica', '博士の研究', '박사의 연구'],
  ['Rare Candy', 'Caramella Rara', 'ふしぎなアメ', '이상한사탕'],
  ['Ultra Ball', 'Ultra Ball', 'ハイパーボール', '하이퍼볼'],
  ['Switch', 'Scambio', 'ポケモンいれかえ', '포켓몬 교체'],
  ['Nest Ball', 'Minor Ball', 'ネストボール', '네스트볼'],
  ['Counter Catcher', 'Contracchiappa-Pokémon', 'カウンターキャッチャー', '카운터 캐처'],
  ['Basic Grass Energy', 'Energia Erba base', '基本草エネルギー', '기본 풀 에너지'],
  ['Basic Fire Energy', 'Energia Fuoco base', '基本炎エネルギー', '기본 불꽃 에너지'],
  ['Basic Water Energy', 'Energia Acqua base', '基本水エネルギー', '기본 물 에너지'],
  ['Basic Lightning Energy', 'Energia Lampo base', '基本雷エネルギー', '기본 번개 에너지'],
  ['Basic Psychic Energy', 'Energia Psico base', '基本超エネルギー', '기본 초 에너지'],
  ['Basic Fighting Energy', 'Energia Lotta base', '基本闘エネルギー', '기본 격투 에너지'],
  ['Basic Darkness Energy', 'Energia Oscurità base', '基本悪エネルギー', '기본 악 에너지'],
  ['Basic Metal Energy', 'Energia Metallo base', '基本鋼エネルギー', '기본 강철 에너지'],
];
let westernNames, romanizedNames;
const nativeNames = new Map();

function latinNames() {
  if (westernNames) return;
  westernNames = new Map();
  romanizedNames = new Map();
  for (const [id, names] of speciesNames.entries()) {
    if (!names) continue;
    westernNames.set(nameKey(names[0]), id);
    if (names[6]) westernNames.set(nameKey(names[6]), id);
    if (names[5]) romanizedNames.set(nameKey(names[5]), id);
  }
}

function findSpecies(name) {
  const key = nameKey(name);
  if (!/^[\p{Script=Latin}\d♀♂]+$/u.test(key)) return null;
  latinNames();
  const exact = westernNames.get(key) ?? romanizedNames.get(key);
  if (exact) return exact;
  if (key.length < 3) return null;
  const matches = new Set();
  for (const [name, id] of westernNames) if (name.startsWith(key)) matches.add(id);
  return matches.size === 1 ? matches.values().next().value : null;
}

function partialCatalogueNames(input, lang) {
  const key = nameKey(input);
  const column = nativeColumns[lang];
  if (!column || key.length < 2 || !/^[\p{Script=Latin}\d♀♂]+$/u.test(key)) return [];
  latinNames();
  const matches = new Set();
  const matchesName = name => key.length === 2 ? name.startsWith(key) : name.includes(key);
  const cardColumn = cardNameColumns[lang];
  if (cardColumn) {
    for (const names of localizedCardNames) {
      if (names.slice(0, 2).some(name => matchesName(nameKey(name)))) matches.add(names[cardColumn]);
    }
  }
  for (const [name, id] of westernNames) {
    const printed = speciesNames[id][column];
    if (printed && matchesName(name)) matches.add(printed);
    if (matches.size >= 16) break;
  }
  return [...matches];
}

export function catalogueQuery(term, lang) {
  const match = term.match(/^(.+?)\s+(?:in\s+)?(giappones[ei]|[ck]orean[aeio]|japanese|korean)$/i);
  if (!match) return { term, lang };
  const printing = match[2].toLowerCase();
  return { term: match[1], lang: printing.startsWith('giappones') || printing === 'japanese' ? 'ja' : 'ko' };
}

export function catalogueAlias(term, lang) {
  if (marketLanguage(lang) === 'en') return null;
  let input = term;
  let setCode = '';
  for (const [pattern, code] of setQualifiers[lang] ?? []) {
    const match = term.match(pattern);
    if (!match || !match.index) continue;
    input = term.slice(0, match.index);
    setCode = code;
    break;
  }
  if (!setCode) {
    const set = term.match(/^(.+)\s+(151|[a-z]+\d[a-z0-9.+-]*)$/i);
    input = set?.[1] ?? term;
    setCode = set?.[2] ?? '';
  }
  const cardColumn = cardNameColumns[lang];
  if (cardColumn) {
    const key = nameKey(input);
    const card = localizedCardNames.find(([english, italian]) => nameKey(english) === key || nameKey(italian) === key);
    if (card) return { name: card[0], nativeName: card[cardColumn], suffix: '', setCode };
  }
  // Check the complete name first to preserve species such as Porygon-Z and Type: Null.
  const ending = input.match(searchSuffix);
  const suffix = ending?.[1] ?? '';
  const title = ending ? input.slice(0, ending.index) : input;
  const id = findSpecies(input) ?? (ending ? findSpecies(title) : null);
  const column = nativeColumns[lang];
  if (id) {
    const names = speciesNames[id];
    return { id, name: names[0], nativeName: names[column] || '', suffix, setCode };
  }
  const partners = title.split(/\s+e\s+|\s*&\s*/i);
  if (cardColumn && partners.length === 2) {
    const names = partners.map(partner => speciesNames[findSpecies(partner)]);
    if (names.every(row => row?.[column])) {
      return { name: names.map(row => row[0]).join(' & '), nativeName: names.map(row => row[column]).join('&'), suffix, setCode };
    }
  }
  const nativeNames = partialCatalogueNames(title, lang);
  if (nativeNames.length === 1) return { nativeName: nativeNames[0], suffix, setCode };
  return nativeNames.length ? { nativeNames, suffix, setCode } : null;
}

export function printedSearchName(pokemon, lang) {
  if (!pokemon.nativeName || !pokemon.suffix || (lang !== 'ja' && lang !== 'ko')) return pokemon.nativeName;
  const suffix = pokemon.suffix.toUpperCase();
  const printedSuffix = suffix === 'EX' && pokemon.suffix !== 'EX' ? 'ex' : suffix;
  return [pokemon.nativeName, printedSuffix].join(lang === 'ko' ? ' ' : '');
}

function namesInPrint(name, lang) {
  const column = nativeColumns[lang];
  if (!column) return [];
  if (!nativeNames.has(lang)) {
    const names = new Map(speciesNames.filter(row => row?.[column]).map(row => [row[column], row[0]]));
    const escaped = [...names.keys()].sort((a, b) => b.length - a.length)
      .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    nativeNames.set(lang, { names, pattern: new RegExp(escaped.join('|'), 'gu') });
  }
  const { names, pattern } = nativeNames.get(lang);
  return [...name.matchAll(pattern)].map(match => names.get(match[0]));
}

export function latinCardName(card) {
  const lang = marketLanguage(card.lang);
  if (card.kind === 'sealed' || !card.name || lang === 'en') return '';
  const cardColumn = cardNameColumns[lang];
  if (cardColumn) {
    const printed = nameKey(card.name.split(/[（(]/u, 1)[0]);
    const known = localizedCardNames.find(names => nameKey(names[cardColumn]) === printed);
    if (known) return known[0];
  }
  const names = namesInPrint(card.name, lang);
  const alias = [...new Set(names)].join(' & ') || card.pokemonName;
  if (!alias) return '';
  const suffix = card.name.match(cardSuffix)?.[1];
  const name = suffix ? `${alias} ${suffix}` : alias;
  return nameKey(name) === nameKey(card.name) ? '' : name;
}

export function pokemonNameForIds(ids) {
  if (!Array.isArray(ids)) return '';
  return [...new Set(ids.map(id => speciesNames[id]?.[0]).filter(Boolean))].join(' & ');
}

export function catalogueCardTitle(card) {
  const alias = latinCardName(card);
  if (alias) return alias;
  if (card.kind === 'sealed' || marketLanguage(card.lang) === 'en' || !asianScript.test(card.name)) return card.name;
  return card.localId ? `Card #${card.localId}` : `Card ${card.id}`;
}

export function catalogueSetName(name, id, lang) {
  if ((lang === 'ja' || lang === 'ko') && id?.toLowerCase() === 'sv2a') return 'Pokémon Card 151';
  const known = lang === 'ja' && id ? japaneseSetNames.get(id.toLowerCase()) : '';
  if (known) return known;
  if (marketLanguage(lang) !== 'en' && id && asianScript.test(name)) return `Set ${id}`;
  return name;
}
