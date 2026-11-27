import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Input: cards/<catalogue>.json and sets/<catalogue>.json from CardCorpus
// snapshot ee2eb604dd80b33eddbdb7a300022e2f3d6e36f8 (CC BY 4.0).
const source = process.argv[2];
if (!source) throw new Error('Pass the local directory containing the CardCorpus cards/ and sets/ directories.');
const catalogues = { ko: 'korean', 'zh-cn': 'zh-hans', 'zh-tw': 'zh-hant', th: 'thai', id: 'indonesian' };
const output = new URL('../dist/catalogues/', import.meta.url);
const attribution = {
  author: 'CardCorpus',
  source: 'https://github.com/cardcorpus/pokemon-card-dataset/tree/ee2eb604dd80b33eddbdb7a300022e2f3d6e36f8/v1',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  modification: 'Reduced to searchable regional printing and set metadata with external artwork references.',
};
const read = async path => JSON.parse(await readFile(join(source, path), 'utf8'));
const identifier = /^[a-z0-9.+-]+$/i;

await mkdir(output, { recursive: true });
for (const [language, catalogue] of Object.entries(catalogues)) {
  const [{sets}, {cards}] = await Promise.all([read(`sets/${catalogue}.json`), read(`cards/${catalogue}.json`)]);
  const setIndexes = new Map(sets.map((set, index) => [set.id, index]));
  const compactSets = sets.map(set => [set.id.split('/').at(-1), set.printedCode ?? '', set.englishName ?? set.name, set.actualTotal ?? set.cardCount]);
  const ids = new Set();
  const compactCards = cards.map(card => {
    const setIndex = setIndexes.get(card.set);
    const id = `cc-${language}-${compactSets[setIndex]?.[0]}-${card.id}`;
    if (setIndex === undefined || id.length > 100 || !identifier.test(id) || ids.has(id) || !card.name) {
      throw new Error(`Invalid or duplicate CardCorpus identity: ${id}`);
    }
    ids.add(id);
    const picture = card.picture?.front?.image;
    const name = card.name.normalize('NFC');
    const englishName = card.englishName?.normalize('NFC');
    return [setIndex, card.id, card.number?.short ?? card.id, name,
      englishName && englishName !== name ? englishName : '', /^[a-f0-9]{32}$/.test(picture) ? picture : '', card.rarity ?? ''];
  });
  const lines = rows => rows.map(row => JSON.stringify(row)).join(',\n');
  await writeFile(new URL(`cardcorpus-${language}.json`, output), `{"attribution":${JSON.stringify(attribution)},"sets":[\n${lines(compactSets)}\n],"cards":[\n${lines(compactCards)}\n]}\n`);
  console.log(`${language}: ${cards.length} cards across ${sets.length} sets`);
}
