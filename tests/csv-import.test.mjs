import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { emptyState, addCard, importCSV, exportCSV, entryIdentity } from '../dist/model.js';

const date = '2026-11-23T12:00:00Z';
const card = { id: 'sv03.5-001', name: 'Synthetic card', lang: 'en', price: 20, priceUpdated: date };
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function sameEntries(left, right) {
  assert.deepEqual(left.collection.map(({ uid, ...entry }) => entry), right.collection.map(({ uid, ...entry }) => entry));
  assert.deepEqual(left.binders, right.binders);
}

test('batch CSV keeps sequential merge semantics, first existing identity, costs and quotes', () => {
  const initial = addCard(emptyState(), card, { quantity: 2, cost: 7, addedAt: date });
  // JSON backups may contain distinct row IDs with the same holding identity.
  initial.collection.push({ ...initial.collection[0], uid: 'second-row', quantity: 4 });
  frozen(initial);
  const incoming = [
    { card: { ...card, price: 10, priceUpdated: '2026-11-20' }, quantity: 3, cost: 12 },
    { card: { ...card, price: null }, quantity: 1, cost: 2 },
    { card: { ...card, id: 'sv03.5-002', name: '=formula' }, quantity: 1, cost: 5 },
  ];
  let expected = initial;
  const csvRows = [];
  for (const item of incoming) {
    const details = { quantity: item.quantity, cost: item.cost, addedAt: date };
    expected = addCard(expected, item.card, details);
    csvRows.push(exportCSV(addCard(emptyState(), item.card, details)).split('\r\n')[1]);
  }
  const csv = exportCSV(emptyState()) + '\r\n' + csvRows.join('\r\n');
  const result = importCSV(csv, initial);
  sameEntries(result, expected);
  assert.equal(result.collection[0].uid, initial.collection[0].uid);
  assert.equal(result.collection[1], initial.collection[1]);
  assert.equal(result.collection[0].price, 20);
  assert.equal(result.collection[0].quantity, 6);
});

test('batch CSV indexes existing identities once instead of rescanning for every row', () => {
  const initial = addCard(emptyState(), card, { addedAt: date });
  let identityReads = 0;
  initial.collection = Array.from({ length: 1000 }, (_, i) => ({
    ...initial.collection[0], uid: `existing-${i}`,
    get id() { identityReads++; return `old-${i}`; },
  }));
  const csv = 'id,name,quantity,cost,binderId,binderName\n' + Array.from({ length: 1000 }, (_, i) => `new-${i},Synthetic,1,0,b-${i},Binder ${i}`).join('\n');
  const result = importCSV(csv, initial);
  assert.equal(result.collection.length, 2000);
  assert.equal(result.binders.length, 1001);
  assert.equal(identityReads, 1000);
  assert.equal(new Set(result.collection.map(entryIdentity)).size, 2000);
});

test('invalid final rows discard all private batch changes including new binders', () => {
  const initial = frozen(addCard(emptyState(), card, { addedAt: date }));
  const before = JSON.stringify(initial);
  for (const row of ['bad,Bad,0,0,new,New binder', 'bad,Bad,1,0,new,"unterminated']) {
    assert.throws(() => importCSV(`id,name,quantity,cost,binderId,binderName\nnew,New,1,2,new,New binder\n${row}`, initial));
    assert.equal(JSON.stringify(initial), before);
  }
});

function importer() {
  // Exercise the browser worker module in an actual isolated worker thread.
  const url = new URL('../dist/import-worker.js', import.meta.url).href;
  return new Worker(`import { parentPort } from 'node:worker_threads';
    globalThis.self = { addEventListener: (type, listener) => parentPort.on(type, data => listener({ data })), postMessage: value => parentPort.postMessage(value) };
    await import(${JSON.stringify(url)});`, { eval: true, type: 'module' });
}
async function checkFile(t, data) {
  const worker = importer(); t.after(() => worker.terminate());
  return new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); worker.postMessage(data); });
}

test('import worker validates CSV and legacy JSON without accessing browser storage', async t => {
  const current = addCard(emptyState(), card, { quantity: 2, cost: 7, addedAt: date });
  const csv = await checkFile(t, { format: 'csv', source: exportCSV(current), current });
  assert.equal(csv.quantity, 4); assert.equal(csv.state.collection[0].quantity, 4);
  assert.equal(current.collection[0].quantity, 2);
  const json = await checkFile(t, { format: 'json', source: JSON.stringify({ ...current, version: 1 }) });
  assert.equal(json.quantity, 2); assert.equal(json.state.version, 2);
});

test('import worker returns only an error for invalid or oversized input', async t => {
  for (const data of [
    { format: 'json', source: '{invalid' },
    { format: 'csv', source: 'id,name,quantity,cost\nnew,New,0,2', current: emptyState() },
    { format: 'json', source: 'x'.repeat(20 * 1024 * 1024 + 1) },
  ]) {
    const result = await checkFile(t, data);
    assert.equal(typeof result.error, 'string'); assert.equal(result.state, undefined);
  }
});
