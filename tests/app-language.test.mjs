import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let fixtureId = 0;
// Exercise the real event handlers and both HTML assignments without a browser
// dependency. The browser smoke separately checks that this output stays text.
async function application(t) {
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
        : path.includes('/sets/') ? { id: 'base1', name: 'Synthetic set', cards } : cards;
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
  const source = (await readFile(url, 'utf8')).replace(/from '(\.\/[^']+)'/g, (_match, relative) => `from '${new URL(relative, url).href}'`);
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
  assert.ok(requests.some(url => url === 'https://api.tcgdex.net/v2/en/sets/base1'));
  for (const language of ['ja', 'de']) {
    await handlers.get('click')({ target: { closest: () => ({ dataset: { set: 'base1', lang: language } }) } });
    assert.equal(app.testState().lang, language);
    assert.ok(requests.some(url => url === `https://api.tcgdex.net/v2/${language}/sets/base1`));
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
