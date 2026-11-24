import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let fixtureId = 0;
// Exercise the real event handlers and both HTML assignments without a browser
// dependency. The browser smoke separately checks that this output stays text.
async function application(t, catalogueResponse = () => undefined) {
  const handlers = new Map(), nodes = new Map(), stored = new Map(), requests = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', value: '', open: false, classList: { add() {}, remove() {} },
      addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(selector);
  };
  const location = { hash: '#catalog' };
  const globals = {
    document: { querySelector: node, addEventListener: (type, callback) => handlers.set(type, callback) },
    window: { addEventListener() {}, scrollTo() {} }, location,
    history: { replaceState: (_state, _title, hash) => { location.hash = hash; } },
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    fetch: async url => {
      const path = String(url); requests.push(path);
      const cards = [{ id: 'base1-4', name: 'Synthetic card', localId: '4' }];
      const value = path === '/api/health' ? { configured: false } : path === './featured.json' ? []
        : catalogueResponse(path) ?? (path.includes('/sets/') ? { id: 'base1', name: 'Synthetic set', cards } : cards);
      return Response.json(value);
    },
    setTimeout: () => 0,
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const url = new URL('../dist/app.js', import.meta.url);
  const source = (await readFile(url, 'utf8')).replace(/from '(\.\/[^']+)'/g, (_match, relative) => {
    const module = new URL(relative, url);
    if (relative === './catalog.js') module.searchParams.set('fixture', fixtureId);
    return `from '${module.href}'`;
  });
  const app = await import('data:text/javascript;base64,' + Buffer.from(source + `
    export const testState = () => ({ lang, query });
    export function renderLanguage(value) { lang=value; query='Synthetic'; searching=false; searchResults=[{id:'base1-4',name:'Synthetic'}]; render(); updateCatalog(); }
  `).toString('base64') + `#fixture-${fixtureId++}`);
  return { app, handlers, node, stored, requests };
}

test('catalogue language DOM input is canonical before rendering or requesting data', async t => {
  const { app, handlers, node, stored, requests } = await application(t);
  const payload = '<img src=x onerror=alert(1)>';
  node('#catalog-query').value = 'Synthetic';
  const select = { id: 'catalog-lang', value: payload };
  handlers.get('change')({ target: select });
  await new Promise(setImmediate);
  assert.equal(app.testState().lang, 'en');
  assert.equal(select.value, 'en');
  assert.equal(stored.get('pocketvault.lang'), 'en');
  assert.ok(requests.some(url => url.startsWith('https://api.tcgdex.net/v2/en/cards?')));
  assert.ok(node('#catalog-results').innerHTML.includes(' · EN'));
  assert.equal(node('#catalog-results').innerHTML.includes(payload.toUpperCase()), false);

  select.value = 'it'; handlers.get('change')({ target: select });
  await new Promise(setImmediate);
  assert.equal(app.testState().lang, 'it');
  assert.equal(stored.get('pocketvault.lang'), 'it');
  assert.ok(node('#catalog-results').innerHTML.includes(' · IT'));

  await handlers.get('click')({ target: { closest: () => ({ dataset: { set: 'base1', lang: payload } }) } });
  assert.equal(app.testState().lang, 'en');
  assert.ok(requests.includes('https://api.tcgdex.net/v2/en/sets/base1'));
  for (const language of ['ja', 'de']) {
    await handlers.get('click')({ target: { closest: () => ({ dataset: { set: 'base1', lang: language } }) } });
    assert.equal(app.testState().lang, language);
    assert.ok(requests.includes(`https://api.tcgdex.net/v2/${language}/sets/base1`));
  }
});

test('both catalogue HTML sinks encode the language label even if state is corrupted', async t => {
  const { app, node } = await application(t);
  const payload = '<img src=x onerror=alert(1)>';
  app.renderLanguage(payload);
  for (const selector of ['#app', '#catalog-results']) {
    const html = node(selector).innerHTML;
    assert.ok(html.includes('&lt;IMG SRC=X ONERROR=ALERT(1)&gt;'));
    assert.equal(html.includes(payload.toUpperCase()), false);
  }
});

test('choosing Japanese keeps name search in view and opens the selected printing by its number', async t => {
  const charizard = { id: 'SV2a-201', name: 'リザードンex', localId: '201' };
  const set = { id: 'SV2a', name: 'ポケモンカード151', cardCount: { total: 210 } };
  const { app, handlers, node, requests } = await application(t, path => {
    if (path.endsWith('/ja/sets')) return [set];
    if (path.endsWith('/ja/cards/SV2a-201')) return { ...charizard, dexId: [6], set, rarity: 'Special Art Rare' };
    if (path.includes('/ja/cards?')) return [{ ...charizard, id: 'SV2a-006', localId: '006' }, charizard];
  });
  handlers.get('change')({ target: { id: 'catalog-lang', value: 'ja' } });
  assert.equal(app.testState().lang, 'ja');
  assert.match(node('#app').innerHTML, /Printing language/);
  assert.match(node('#catalog-results').innerHTML, /Find Japanese printings/);
  assert.equal(requests.some(url => url.includes('/ja/sets')), false);

  node('#catalog-query').value = 'Charizard ex 151';
  handlers.get('submit')({ target: { id: 'catalog-form' }, preventDefault() {} });
  await new Promise(setImmediate);
  const results = node('#catalog-results').innerHTML;
  assert.match(results, /aria-label="View Charizard ex · SV2a · #006"/);
  assert.match(results, /aria-label="View Charizard ex · SV2a · #201"/);
  assert.match(results, /lang="ja">リザードンex/);
  assert.match(results, /Pokémon Card 151/);

  await handlers.get('click')({ target: { closest: () => ({ dataset: { card: 'SV2a-201', lang: 'ja' } }) } });
  const details = node('#modal').innerHTML;
  assert.match(details, /id="modal-title">Charizard ex</);
  assert.match(details, /#201 · Japanese/);
  assert.match(details, /Add to collection/);
  assert.ok(requests.includes('https://api.tcgdex.net/v2/ja/cards/SV2a-201'));
});

test('set browsing shows identifying codes when a Japanese title has no translation', async t => {
  const set = { id: 'SV7a', name: '楽園ドラゴーナ' };
  const card = { id: 'SV7a-060', name: 'ナイトストレッチャー', localId: '060' };
  const { handlers, node } = await application(t, path => {
    if (path.endsWith('/ja/sets')) return [set];
    if (path.endsWith('/ja/sets/SV7a')) return { ...set, cards: [card] };
  });
  handlers.get('change')({ target: { id: 'catalog-lang', value: 'ja' } });
  await handlers.get('click')({ target: { closest: () => ({ dataset: { action: 'browse-catalogue-sets' } }) } });
  assert.match(node('#catalog-results').innerHTML, /<h3>Set SV7a<\/h3><p lang="ja">楽園ドラゴーナ/);

  await handlers.get('click')({ target: { closest: () => ({ dataset: { set: 'SV7a', lang: 'ja' } }) } });
  assert.match(node('#app').innerHTML, /class="card-name">Card #060</);
  assert.match(node('#app').innerHTML, /lang="ja">ナイトストレッチャー/);
});
