import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cardImage, getCard, getSet, searchCardPrintings, searchCards } from '../dist/catalog.js';

test('real snapshots fill gaps across the five regional catalogues and keep printing details', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async path => {
    calls.push(path);
    if (path.startsWith('./catalogues/')) return new Response(await readFile(new URL(`../dist/${path.slice(2)}`, import.meta.url)));
    if (path.endsWith('/ko/sets')) return Response.json([]);
    return Response.json([]);
  });
  const mixed = await searchCardPrintings('Pikachu', 1);
  assert.deepEqual([...new Set(mixed.cards.map(card => card.lang))], ['ko', 'zh-tw', 'zh-cn', 'th', 'id']);
  assert.deepEqual(mixed.unavailable, []);
  assert.equal(mixed.hasMore, true);
  const korean = mixed.cards.find(card => card.lang === 'ko');
  assert.match(korean.name, /피카츄/);
  const detail = await getCard(korean.id, 'ko');
  assert.equal(detail.id, korean.id);
  assert.equal(detail.localId, korean.localId);
  assert.match(cardImage(detail), /^https:\/\/img\.cardcorpus\.com\/s1\/240\//);
  const set = await getSet(detail.setId, 'ko');
  assert.ok(set.cards.some(card => card.id === detail.id));

  const [charizard] = await searchCards('Charizard ex 151', 'ko');
  assert.equal(charizard.pokemonName, 'Charizard ex');
  assert.equal(charizard.setCode, 'SV2a');
  const [eevee] = await searchCards('Eevee', 'ko');
  assert.match(eevee.name, /이브이/);
  const secondPage = await searchCards('Pikachu', 'ko', 2, 3);
  const firstIDs = new Set(mixed.cards.map(card => card.id));
  assert.ok(secondPage.length && secondPage.every(card => !firstIDs.has(card.id)));
  assert.equal(calls.filter(url => url === './catalogues/cardcorpus-ko.json').length, 1);
});
