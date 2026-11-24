import { marketLanguage } from './languages.js';
import { speciesNames } from './pokemon-names.js';

const nativeColumns = { ja: 1, ko: 2, 'zh-tw': 3, 'zh-cn': 4 };
const cardSuffix = /(V-UNION|VSTAR|VMAX|GX|EX|V)$/i;
const searchSuffix = /\s+(V-UNION|VSTAR|VMAX|GX|EX|V)$/i;
const nameKey = name => name.normalize('NFKD').replace(/\p{M}|[^\p{L}\p{N}♀♂]/gu, '').toLowerCase();
// Common Trainer and Basic Energy names present in TCGdex's Japanese catalogue.
const japaneseCardNames = [
  ['ボスの指令', 'Boss’s Orders', 'Ordini del Capo'],
  ['博士の研究', 'Professor’s Research', 'Ricerca Accademica'],
  ['ふしぎなアメ', 'Rare Candy', 'Caramella Rara'],
  ['ハイパーボール', 'Ultra Ball'],
  ['ポケモンいれかえ', 'Switch', 'Scambio'],
  ['ネストボール', 'Nest Ball', 'Minor Ball'],
  ['基本草エネルギー', 'Basic Grass Energy', 'Energia Erba base'],
  ['基本炎エネルギー', 'Basic Fire Energy', 'Energia Fuoco base'],
  ['基本水エネルギー', 'Basic Water Energy', 'Energia Acqua base'],
  ['基本雷エネルギー', 'Basic Lightning Energy', 'Energia Lampo base'],
  ['基本超エネルギー', 'Basic Psychic Energy', 'Energia Psico base'],
  ['基本闘エネルギー', 'Basic Fighting Energy', 'Energia Lotta base'],
  ['基本悪エネルギー', 'Basic Darkness Energy', 'Energia Oscurità base'],
  ['基本鋼エネルギー', 'Basic Metal Energy', 'Energia Metallo base'],
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

export function catalogueAlias(term, lang) {
  if (marketLanguage(lang) === 'en') return null;
  const set = term.match(/^(.+)\s+(151|[a-z]+\d[a-z0-9.+-]*)$/i);
  const input = set?.[1] ?? term;
  const setCode = set?.[2] ?? '';
  if (lang === 'ja') {
    const key = nameKey(input);
    const trainer = japaneseCardNames.find(([, ...names]) => names.some(name => nameKey(name) === key));
    if (trainer) return { name: trainer[1], nativeName: trainer[0], setCode };
  }
  // Check the complete name first to preserve species such as Porygon-Z and Type: Null.
  const suffix = input.match(searchSuffix)?.[1] ?? '';
  const id = findSpecies(input) ?? (suffix ? findSpecies(input.slice(0, -suffix.length).trim()) : null);
  if (!id) return null;
  const names = speciesNames[id];
  return { id, name: names[0], nativeName: names[nativeColumns[lang]] || '', suffix, setCode };
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
  if (lang === 'ja') {
    const trainer = japaneseCardNames.find(([name]) => card.name === name || card.name.startsWith(`${name}（`));
    if (trainer) return trainer[1];
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

export function catalogueSetName(name, id, lang) {
  return lang === 'ja' && id?.toLowerCase() === 'sv2a' ? 'Pokémon Card 151' : name;
}
