import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cardImage, getCard, getSet, searchCardPrintings, searchCards } from '../dist/catalog.js';
import { findEditionPrintings, groupCardEditions } from '../dist/catalogue-editions.js';

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
  const secondPage = await searchCards('Pikachu', 'ko', 2, 8);
  const firstIDs = new Set(mixed.cards.map(card => card.id));
  assert.ok(secondPage.length && secondPage.every(card => !firstIDs.has(card.id)));
  assert.equal(calls.filter(url => url === './catalogues/cardcorpus-ko.json').length, 1);

  const korean151 = (await searchCards('Blastoise ex 151', 'ko')).find(card=>card.localId==='202');
  const thai151 = (await searchCards('Blastoise ex 151', 'th')).find(card=>card.localId==='202');
  const chinese151 = (await searchCards('Blastoise ex 151', 'zh-cn')).find(card=>card.localId==='176');
  const english151 = {id:'sv03.5-200',name:'Blastoise ex',setId:'sv03.5',localId:'200',lang:'en'};
  const japanese151 = {id:'SV2a-202',name:'カメックスex',setId:'SV2a',localId:'202',lang:'ja'};
  const editions = groupCardEditions([japanese151,korean151,thai151,chinese151,english151,japanese151], 'Blastoise ex 151');
  assert.deepEqual(editions.map(edition=>edition.key), ['tcg:sv03.5-200','ocg:sv2a:202','ocg:151c:176']);
  assert.deepEqual([...editions[1].printings.keys()], ['ja','ko','th']);
  const {printings} = await findEditionPrintings(editions[1]);
  assert.equal(printings.get('zh-tw').localId, '202');
  assert.equal(printings.has('zh-cn'), false);

  const koreanBase = (await searchCards('Blastoise', 'ko')).find(card=>card.setId==='cc-ko-base-set');
  const chineseBase = (await searchCards('Blastoise', 'zh-tw')).find(card=>card.setId==='cc-zh-tw-base-set');
  assert.equal(groupCardEditions([koreanBase,chineseBase], 'Blastoise').length, 1);
});
