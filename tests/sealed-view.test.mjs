import test from 'node:test';
import assert from 'node:assert/strict';
import { sealedFields, sealedIdentity, sealedPricePanel, sealedValuationHistory, sealedPublicHistory, sealedAttribution } from '../dist/sealed-view.js';

const quote = { amount: 43.9, currency: 'EUR', source: 'TCGPrices · EU retail', metric: 'store-low', productId: 673436,
  providerUpdatedAt: '2026-11-22T00:00:00Z', fetchedAt: '2026-11-23T06:00:00Z', lastAttemptAt: '2026-11-23T06:00:00Z', lastError: null, mapping: 'matched' };
const entry = { id: 'sealed-tcgp-673436-eu', kind: 'sealed', name: 'First Partner Collection', lang: 'und', productType: 'collection-box',
  condition: 'Factory sealed', setName: 'Collection 2026', productCode: '673436', productUrl: 'https://tcgprices.app/card/first-partner-collection', market: quote };

test('sealed forms keep canonical identity fixed and editable private valuation fields separate', () => {
  const html = sealedFields({ ...entry, quantity: 2, cost: 40, manualValuation: { amount: 50, updatedAt: '2026-10-31T12:00:00Z', note: 'A comparison', url: 'https://example.com/sale' } }, [{ id: 'main', name: 'My collection' }]);
  assert.match(html, /id="sealed-cost" name="cost" value="40"/);
  assert.match(html, /id="sealed-manualAmount" name="manualAmount" value="50"/);
  assert.match(html, /name="manualDate" value="2026-10-31"/);
  assert.match(html, /name="name"[^>]*readonly/); assert.match(html, /name="productType" disabled/);
  assert.match(html, /name="edition"[^>]*readonly/); assert.doesNotMatch(html, /name="lang"[^>]*disabled/);
  assert.doesNotMatch(html, /name="grading|name="variantId|<form|type="submit"/);
  assert.match(html, /Quantity counts sealed products, not the packs or cards inside/);
  assert.doesNotMatch(sealedFields({ ...entry, id: 'custom-product' }), /readonly| disabled/);
});

test('sealed UI escapes editable text and suppresses unsafe evidence links', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const html = sealedFields({ ...entry, name: payload, edition: '\" onfocus="alert(1)', manualValuation: { amount: 0, note: '</textarea><script>alert(1)</script>', updatedAt: '2026-11-23' } }, [{ id: 'main', name: payload }]);
  assert.ok(html.includes('value="&lt;img src=x onerror=alert(1)&gt;"'));
  assert.ok(html.includes('&lt;/textarea&gt;&lt;script&gt;alert(1)&lt;/script&gt;</textarea>'));
  assert.ok(html.includes('value="&quot; onfocus=&quot;alert(1)"'));
  assert.equal(html.includes(payload), false);
  const history = sealedValuationHistory({ valuationHistory: [{ amount: 0, updatedAt: '2026-11-23', note: payload, url: 'javascript:alert(1)' }] });
  assert.doesNotMatch(history, /javascript:|<img/); assert.match(history, /€0\.00/);
  assert.doesNotMatch(sealedPricePanel({ ...entry, productUrl: 'https://user:secret@example.com', market: { ...quote, lastError: payload } }), /href="https:\/\/user|<img/);
});

test('sealed text encoding preserves mixed-case markup and entities as literal text', () => {
  const note = '</TeXtArEa><SvG/onload=alert(1)>&quot;';
  const html = sealedFields({ ...entry, manualValuation: { amount: 0, updatedAt: '2026-11-23', note } });
  assert.ok(html.includes('&lt;/TeXtArEa&gt;&lt;SvG/onload=alert(1)&gt;&amp;quot;</textarea>'));
  assert.equal(html.includes(note), false);
});

test('retail panel explains currency, asking-price basis and unknown printing language', () => {
  const html = sealedPricePanel(entry);
  assert.match(html, /EU RETAIL REFERENCE · EUR/); assert.match(html, /€43\.90/);
  assert.match(html, /not a resale estimate or a completed sale/); assert.match(html, /Shipping and taxes are excluded/);
  assert.match(html, /Not specified by source/); assert.match(html, /data-action="sealed-price-history"/);
  assert.match(html, /id="sealed-public-history"/); assert.match(html, /https:\/\/tcgprices\.app\/data/);
  const italian = sealedPricePanel({ ...entry, lang: 'it' });
  assert.match(italian, /reference is not used automatically/); assert.match(italian, /€43\.90/);
  const custom = sealedPricePanel({ ...entry, id: 'custom-test', market: null });
  assert.match(custom, /not matched to public prices automatically/); assert.doesNotMatch(custom, /data-action="refresh-sealed-price"/);
});

test('personal history remains distinct from public observations and tables are bounded', () => {
  const personal = sealedValuationHistory({ valuationHistory: Array.from({ length: 25 }, (_, i) => ({ amount: 10 + i, updatedAt: `2026-11-${String(i + 1).padStart(2, '0')}`, note: `note${i}`, url: 'https://example.com/sale' })) });
  assert.match(personal, /Your valuation history/); assert.match(personal, /Stored only in this browser/);
  assert.equal((personal.match(/<tr>/g) || []).length, 21); assert.doesNotMatch(personal, />note0 /);
  const pub = sealedPublicHistory({ points: Array.from({ length: 20 }, (_, i) => ({ amount: 10 + i, date: `2026-11-${String(i + 1).padStart(2, '0')}`, providerUpdatedAt: '2026-11-23' })), lastError: 'Source unavailable' });
  assert.match(pub, /Public retail price history/); assert.match(pub, /independent of your quantity and personal valuations/);
  assert.equal((pub.match(/<tr>/g) || []).length, 16); assert.match(pub, /Source unavailable/);
  assert.match(sealedPublicHistory({ points: [] }), /missing dates are not filled in/);
  assert.match(sealedValuationHistory({}), /No personal observations yet/);
  assert.match(sealedIdentity(entry), /Collection box · Language not specified · Factory sealed/);
  assert.match(sealedAttribution(), /CC BY 4\.0/);
});
