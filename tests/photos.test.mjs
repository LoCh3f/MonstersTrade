import test from 'node:test';
import assert from 'node:assert/strict';
import { safePhotoURL, productImage, productPhotoSource } from '../dist/photos.js';
import { emptyState, addCard, updateEntry, normalizeState, exportCSV, importCSV, applySealedMarketUpdate } from '../dist/model.js';

const photo = 'https://example.com/photos/box.webp?size=600&view=front';
const product = (extra = {}) => ({ id:'sealed-tcgp-673436-eu', kind:'sealed', name:'First Partner Illustration Collection', productType:'collection-box', lang:'und', ...extra });
const market = (amount = 43.9) => ({ amount, currency:'EUR', source:'TCGPrices · EU retail', metric:'store-low', productId:673436, providerUpdatedAt:'2026-11-22T00:00:00.000Z', fetchedAt:'2026-11-23T12:00:00.000Z', lastAttemptAt:'2026-11-23T12:00:00.000Z', lastError:null, mapping:'matched' });

test('photo URLs allow HTTPS queries and normalize hosts while rejecting active or credentialed URLs', () => {
  assert.equal(safePhotoURL('  https://EXAMPLE.com/a b.webp?size=600  '), 'https://example.com/a%20b.webp?size=600');
  assert.equal(safePhotoURL(photo), photo);
  for (const value of ['', null, {}, 'http://example.com/x.jpg', 'data:image/png;base64,abc', 'javascript:alert(1)', '//example.com/x.jpg', 'https://user:secret@example.com/x.jpg', 'https://example.com/x\n.jpg', `https://example.com/${'a'.repeat(2000)}`]) {
    assert.equal(safePhotoURL(value), '', String(value));
  }
});

test('catalogue photos derive only from exact validated sealed identity, with custom overrides taking priority', () => {
  assert.equal(productImage(product()), 'https://tcgplayer-cdn.tcgplayer.com/product/673436_400w.jpg');
  assert.equal(productImage(product(), 'high'), 'https://tcgplayer-cdn.tcgplayer.com/product/673436_in_1000x1000.jpg');
  assert.equal(productPhotoSource(product()), 'TCGplayer catalogue image');
  assert.equal(productImage(product({ image:photo }), 'high'), photo);
  assert.equal(productImage(product({ id:'sealed-custom', image:photo })), photo);
  assert.equal(productPhotoSource(product({ image:photo })), 'Custom image');
  for (const id of ['sealed-custom', 'sealed-tcgp-0-eu', 'sealed-tcgp-0673436-eu', 'sealed-tcgp-9007199254740992-eu', 'sealed-tcgp-673436-us', '673436', 'sealed-tcgp-673436-eu/other']) {
    const entry = product({ id, productCode:'673436' });
    assert.equal(productImage(entry), '');
    assert.equal(productPhotoSource(entry), '');
  }
  assert.equal(productImage({ ...product(), kind:'card', image:photo }), '');
});

test('sealed photo imports reject invalid URLs without changing existing card-image support', () => {
  for (const image of ['http://example.com/x.jpg', 'https://user@example.com/x.jpg', 'assets/photo.jpg', 'javascript:alert(1)']) {
    assert.throws(() => addCard(emptyState(), product({ image })), /Product photo/);
  }
  const card = addCard(emptyState(), { id:'sv03.5-199', name:'Charizard ex', image:'assets/card.webp' });
  assert.equal(card.collection[0].image, 'assets/card.webp');
});

test('sealed photos survive JSON, CSV, daily price refresh and duplicate catalogue adds', () => {
  const initial = addCard(emptyState(), product({ image:photo, market:market() }), { quantity:2, cost:30 });
  assert.equal(normalizeState(JSON.parse(JSON.stringify(initial))).collection[0].image, photo);
  assert.equal(importCSV(exportCSV(initial), emptyState()).collection[0].image, photo);
  const refreshed = applySealedMarketUpdate(initial.collection[0], product({ image:'', market:market(45) }));
  assert.equal(refreshed.image, photo);
  const merged = addCard(initial, product({ image:'', market:market(45) }), { quantity:1, cost:40 });
  assert.equal(merged.collection.length, 1);
  assert.equal(merged.collection[0].image, photo);
  assert.equal(merged.collection[0].quantity, 3);
  const cleared = updateEntry(merged, merged.collection[0].uid, { image:'' });
  assert.equal(cleared.collection[0].image, '');
  assert.equal(productPhotoSource(cleared.collection[0]), 'TCGplayer catalogue image');
  assert.equal(initial.collection[0].image, photo);
});
