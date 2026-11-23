import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeState, addCard, updateEntry, removeEntry, totals, recordSnapshot, exportCSV, importCSV } from '../dist/model.js';

const card = { id: 'sv03.5-199', name: 'Charizard ex', localId: '199', image: 'https://assets.tcgdex.net/en/sv/sv03.5/199', setId: 'sv03.5', setName: '151', setTotal: 207, rarity: 'Special illustration rare', price: 125, priceUpdated: '2026-11-23', lang: 'en' };

test('matching entries merge with weighted unit cost, immutably', () => {
  const initial = emptyState();
  const first = addCard(initial, card, { quantity: 2, cost: 80 });
  const merged = addCard(first, card, { quantity: 3, cost: 100 });
  assert.equal(initial.collection.length, 0);
  assert.equal(first.collection[0].quantity, 2);
  assert.equal(merged.collection.length, 1);
  assert.equal(merged.collection[0].quantity, 5);
  assert.equal(merged.collection[0].cost, 92);
  assert.deepEqual(totals(merged), { quantity: 5, unique: 1, value: 625, cost: 460, profit: 165, pricedQuantity: 5, unpricedQuantity: 0, sets: 1 });
});

test('different language, condition, or binder remains separate', () => {
  let state = emptyState();
  state.binders.push({ id: 'favorites', name: 'Favorites' });
  state = addCard(state, card);
  state = addCard(state, { ...card, lang: 'it' });
  state = addCard(state, card, { condition: 'Played' });
  state = addCard(state, card, { binderId: 'favorites' });
  assert.equal(state.collection.length, 4);
  assert.equal(totals(state).unique, 2);
});

test('unpriced cards are excluded from value and profit, but retain purchase costs', () => {
  let state = addCard(emptyState(), card, { quantity: 2, cost: 100 });
  state = addCard(state, { ...card, id: 'unknown', price: null }, { quantity: 3, cost: 50 });
  assert.deepEqual(totals(state), { quantity: 5, unique: 2, value: 250, cost: 350, profit: 50, pricedQuantity: 2, unpricedQuantity: 3, sets: 1 });
  assert.equal(normalizeState(JSON.parse(JSON.stringify(state))).collection[1].price, null);
});

test('update validates quantities/costs and keeps original input untouched', () => {
  const state = addCard(emptyState(), card);
  const uid = state.collection[0].uid;
  const updated = updateEntry(state, uid, { quantity: 4, cost: 25, price: null });
  assert.equal(state.collection[0].quantity, 1);
  assert.equal(updated.collection[0].quantity, 4);
  assert.equal(updated.collection[0].price, null);
  for (const quantity of [0, -1, 1.5, Infinity, '2']) assert.throws(() => updateEntry(state, uid, { quantity }));
  assert.throws(() => updateEntry(state, uid, { cost: -1 }));
  assert.throws(() => updateEntry(state, uid, { binderId: 'missing' }));
  assert.equal(removeEntry(state, uid).collection.length, 0);
  assert.equal(state.collection.length, 1);
});

test('daily history replaces today and does not fabricate earlier days', () => {
  let state = recordSnapshot(addCard(emptyState(), card));
  assert.equal(state.history.length, 1);
  state = recordSnapshot(addCard(state, card));
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].quantity, 2);
  assert.equal(state.history[0].value, 250);
  assert.deepEqual(normalizeState(state), state);
});

test('JSON rejects unsupported, malformed, ambiguous, or dangerous entries', () => {
  const state = recordSnapshot(addCard(emptyState(), card));
  assert.throws(() => normalizeState({ ...state, version: 3 }));
  assert.throws(() => normalizeState({ ...state, collection: 'bad' }));
  assert.throws(() => normalizeState({ ...state, collection: [...state.collection, state.collection[0]] }));
  assert.throws(() => normalizeState({ ...state, binders: [] }));
  assert.throws(() => normalizeState({ ...state, collection: [{ ...state.collection[0], price: '125' }] }));
  assert.throws(() => normalizeState({ ...state, collection: [{ ...state.collection[0], image: 'javascript:alert(1)' }] }));
  assert.throws(() => normalizeState({ ...state, history: [{ ...state.history[0], date: '2026-02-31' }] }));
});

test('CSV roundtrip preserves commas, quotes, newlines, leading zeros and null prices', () => {
  let state = emptyState();
  state.binders.push({ id: 'special', name: 'A, "special"\nbinder' });
  state = addCard(state, { ...card, name: 'Pikachu, "Ash"\nEdition', id: 'sv03.5-001', localId: '001', price: null }, { binderId: 'special', quantity: 3, cost: 12.95 });
  const imported = importCSV(exportCSV(state));
  const original = state.collection[0];
  const actual = imported.collection[0];
  assert.deepEqual({ ...actual, uid: original.uid }, original);
  assert.deepEqual(imported.binders, state.binders);
});

test('CSV neutralizes spreadsheet formulas and restores names on import', () => {
  for (const name of ['=HYPERLINK("bad")', '+formula', '-formula', '@formula', '  =formula', '\tformula', "'=literal", "'normal"]) {
    const state = addCard(emptyState(), { ...card, name });
    const csv = exportCSV(state);
    assert.match(csv, /"'/);
    assert.equal(importCSV(csv).collection[0].name, name);
  }
});

test('CSV import rejects malformed or invalid rows atomically', () => {
  const state = addCard(emptyState(), card);
  const before = JSON.stringify(state);
  for (const input of ['id,name,quantity,cost\na,A,1,0\nb,B,-1,0', 'id,name,quantity,cost\na,"unclosed,1,2', 'id,name,quantity,cost\na,A,1', 'id,id,name,quantity,cost\na,b,A,1,0', 'id,name,quantity,cost\na,A,1,Infinity', 'id,name,quantity,cost\na,A,,0']) {
    assert.throws(() => importCSV(input, state));
    assert.equal(JSON.stringify(state), before);
  }
});

test('CSV append merges into existing rows and supports a BOM and empty export', () => {
  const state = addCard(emptyState(), card, { quantity: 2, cost: 50 });
  const imported = importCSV('\uFEFF' + exportCSV(state), state);
  assert.equal(imported.collection.length, 1);
  assert.equal(imported.collection[0].quantity, 4);
  assert.equal(state.collection[0].quantity, 2);
  assert.deepEqual(importCSV(exportCSV(emptyState())), emptyState());
});

function replaceCrypto(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  });
}

test('new collection row IDs prefer native cryptographic UUIDs', t => {
  const expected = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  replaceCrypto(t, { randomUUID: () => expected, getRandomValues: () => { throw new Error('Fallback should not run'); } });
  assert.equal(addCard(emptyState(), card).collection[0].uid, expected);
});

test('secure random bytes generate version-four UUIDs when randomUUID is unavailable', t => {
  let offset = 0;
  const crypto = { getRandomValues(bytes) {
    assert.equal(this, crypto);
    assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.length, 16);
    for (let i = 0; i < bytes.length; i++) bytes[i] = offset++;
    return bytes;
  } };
  replaceCrypto(t, crypto);
  const first = addCard(emptyState(), card);
  const second = addCard(first, { ...card, id: 'another-card' });
  assert.equal(first.collection[0].uid, '00010203-0405-4607-8809-0a0b0c0d0e0f');
  assert.match(second.collection[1].uid, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(second.collection[1].uid, first.collection[0].uid);
});

test('missing secure randomness blocks new IDs while preserving existing stored IDs and state', t => {
  const state = addCard(emptyState(), card);
  state.collection[0].uid = 'card-existing-legacy-id';
  const before = structuredClone(state);
  replaceCrypto(t, undefined);
  assert.throws(() => addCard(state, { ...card, id: 'new-card' }), /Secure randomness is required/);
  assert.deepEqual(state, before);
  assert.equal(normalizeState(state).collection[0].uid, 'card-existing-legacy-id');
  assert.equal(addCard(state, card).collection[0].uid, 'card-existing-legacy-id');
});
