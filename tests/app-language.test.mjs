import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let fixtureId = 0;
// Exercise the real event handlers and both HTML assignments without a browser
// dependency. The browser smoke separately checks that this output stays text.
async function application(t, catalogueResponse = () => undefined) {
  const handlers = new Map(), nodes = new Map(), stored = new Map(), requests = [];
  const timers = new Map();
  let time = 0, nextTimer = 0;
  const tick = elapsed => {
    time += elapsed;
    for (const [id, timer] of timers) {
      if (timer.due > time) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', value: '', open: false, classList: { add() {}, remove() {} },
      addEventListener() {}, setAttribute() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; } });
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
        : (await catalogueResponse(path)) ?? (path.startsWith('./catalogues/') ? {sets:[],cards:[]}
          : path.includes('/sets/') ? { id: 'base1', name: 'Synthetic set', cards } : cards);
      return value instanceof Response ? value : Response.json(value);
    },
    setTimeout: (callback, delay) => {
      timers.set(++nextTimer, { callback, due: time + delay });
      return nextTimer;
    },
    clearTimeout: id => timers.delete(id),
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
    export const testState = () => ({ lang: catalogueViewLanguage(), query });
    export function renderLanguage(value) { searchLanguage=value; query='Synthetic'; searching=false; searchResults=[{id:'base1-4',name:'Synthetic'}]; render(); updateCatalog(); }
  `).toString('base64') + `#fixture-${fixtureId++}`);
  return { app, handlers, node, stored, requests, tick };
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
  assert.match(node('#app').innerHTML, /Find Japanese printings/);
  assert.equal(requests.some(url => url.includes('/ja/sets')), false);

  node('#catalog-query').value = 'Charizard ex 151';
  handlers.get('submit')({ target: { id: 'catalog-form' }, preventDefault() {} });
  await new Promise(setImmediate);
  const results = node('#catalog-results').innerHTML;
  assert.match(results, /aria-label="View Charizard ex · SV2a · #006 · Japanese"/);
  assert.match(results, /aria-label="View Charizard ex · SV2a · #201 · Japanese"/);
  assert.match(results, /lang="ja">リザードンex/);
  assert.match(results, /Pokémon Card 151/);

  await handlers.get('click')({ target: { closest: () => ({ dataset: { card: 'SV2a-201', lang: 'ja' } }) } });
  const details = node('#modal').innerHTML;
  assert.match(details, /id="modal-title">Charizard ex</);
  assert.match(details, /#201 · Japanese/);
  assert.match(details, /Add to collection/);
  assert.ok(requests.some(url => url === 'https://api.tcgdex.net/v2/ja/cards/SV2a-201'));
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

test('an Italian printing-language qualifier selects Korean and links to the official fallback', async t => {
  const { app, handlers, node, stored, requests, tick } = await application(t, path => {
    if (path.endsWith('/ko/sets')) return [{ id: 'SV2a', name: '포켓몬 카드 151' }];
    if (path.includes('/ko/cards?')) return [];
  });
  const input = node('#catalog-query');
  input.id = 'catalog-query';
  input.value = 'Pikachu 151 in coreano';
  handlers.get('input')({ target: input });
  tick(300);
  await new Promise(setImmediate);

  assert.deepEqual(app.testState(), { lang: 'ko', query: 'Pikachu 151' });
  assert.equal(input.value, 'Pikachu 151 in coreano');
  assert.equal(node('#catalog-lang').value, 'ko');
  assert.equal(stored.has('pocketvault.lang'), false);
  const searches = requests.filter(url => url.includes('/ko/cards?')).map(url => new URL(url).searchParams);
  assert.deepEqual(searches.map(params => params.get('set.id')), ['eq:SV2a', 'eq:SV2a']);
  assert.equal(searches.at(-1).get('name'), '피카츄');

  const results = node('#catalog-results').innerHTML;
  assert.match(results, /Search the official Pokémon Korea catalogue/);
  const link = new URL(results.match(/href="([^"]+)"/)[1]);
  assert.equal(link.origin, 'https://pokemoncard.co.kr');
  assert.equal(link.searchParams.get('s'), '피카츄');

  input.value = 'Pikachu';
  handlers.get('input')({ target: input });
  tick(300);
  await new Promise(setImmediate);
  assert.equal(app.testState().lang, 'all');
});

test('a name searches across languages by default and the filter keeps the same query', async t => {
  const { app, handlers, node, requests, tick } = await application(t, path => {
    if (path.includes('/en/cards?')) return [{id:'sv4-1',name:'Iron Hands ex',localId:'1'}];
    if (path.includes('/it/cards?')) return [{id:'sv4-1',name:'Manoferrea-ex',localId:'1'}];
    if (path.includes('/ja/cards?')) return [{id:'SV4M-027',name:'テツノカイナex',localId:'027'}];
    if (path.includes('/ko/cards?')) return [{id:'SV4M-027',name:'무쇠손 ex',localId:'027'}];
    if (path.includes('/id/cards?')) return new Response(null, {status: 503});
    if (path.includes('/cards?')) return [];
  });
  assert.match(node('#app').innerHTML, /<option value="all" selected>All languages/);
  const input = node('#catalog-query');
  input.id = 'catalog-query';
  input.value = 'Manoferrea-ex';
  handlers.get('input')({ target: input });
  tick(300);
  await new Promise(setImmediate);
  const results = () => node('#catalog-results').innerHTML;
  assert.match(results(), /Results for “Manoferrea-ex” · All languages/);
  for (const language of ['English', 'Italian', 'Japanese', 'Korean']) assert.match(results(), new RegExp(`· ${language}"`));
  assert.match(results(), /Couldn’t search Indonesian/);
  assert.match(results(), /data-printing-language="ko">Korean/);
  assert.ok(requests.some(url => url.includes('/en/cards?name=Iron+Hands+ex')));

  await handlers.get('click')({target:{closest:()=>({dataset:{printingLanguage:'ko'}})}});
  assert.deepEqual(app.testState(), { lang: 'ko', query: 'Manoferrea-ex' });
  assert.match(results(), /· Korean"/);
  assert.doesNotMatch(results(), /· (English|Italian|Japanese)"/);
  assert.equal(input.value, 'Manoferrea-ex');
});

test('catalogue typing debounces requests, waits for a composed name, and clears results immediately', async t => {
  const { app, handlers, node, requests, tick } = await application(t);
  handlers.get('change')({ target: { id: 'catalog-lang', value: 'en' } });
  const input = node('#catalog-query');
  input.id = 'catalog-query';
  const type = (value, isComposing = false) => {
    input.value = value;
    handlers.get('input')({ target: input, isComposing });
  };
  const searches = () => requests.filter(url => url.includes('/cards?'));

  type('P');
  assert.match(node('#catalog-results').innerHTML, /Keep typing/);
  type('Pi');
  tick(200);
  type('Pik');
  tick(299);
  assert.equal(searches().length, 0);
  tick(1);
  await new Promise(setImmediate);
  assert.deepEqual(searches().map(url => new URL(url).searchParams.get('name')), ['Pik']);
  assert.match(node('#catalog-results').innerHTML, /Results for “Pik”/);

  type('ピカチュウ', true);
  tick(300);
  assert.equal(searches().length, 1);
  handlers.get('compositionend')({ target: input });
  tick(300);
  await new Promise(setImmediate);
  assert.equal(new URL(searches()[1]).searchParams.get('name'), 'ピカチュウ');

  type('');
  assert.equal(app.testState().query, '');
  assert.doesNotMatch(node('#catalog-results').innerHTML, /Results for “ピカチュウ”/);
});

test('an older catalogue response is ignored while a new search waits for its pause', async t => {
  const earlier = Promise.withResolvers();
  const { handlers, node, requests, tick } = await application(t, url => {
    if (new URL(url).searchParams.get('name') === 'Char') return earlier.promise;
  });
  handlers.get('change')({ target: { id: 'catalog-lang', value: 'en' } });
  const input = node('#catalog-query');
  input.id = 'catalog-query';
  input.value = 'Char';
  handlers.get('input')({ target: input });
  tick(300);

  input.value = 'Pika';
  handlers.get('input')({ target: input });
  earlier.resolve([{ id: 'old-4', name: 'Earlier result', localId: '4' }]);
  await new Promise(setImmediate);
  assert.doesNotMatch(node('#catalog-results').innerHTML, /Earlier result/);

  handlers.get('submit')({ target: { id: 'catalog-form' }, preventDefault() {} });
  await new Promise(setImmediate);
  assert.match(node('#catalog-results').innerHTML, /Results for “Pika”/);
  tick(300);
  assert.equal(requests.filter(url => url.includes('name=Pika')).length, 1);
});

test('mobile navigation reaches secondary sections from its menu', async t => {
  const { handlers, node } = await application(t);
  const shell = node('#app').innerHTML;
  assert.match(shell, /aria-label="Mobile navigation"/);
  assert.match(shell, /data-page="catalog" class="active" aria-current="page"/);
  assert.doesNotMatch(shell, /class="avatar"|class="profile"/);

  await handlers.get('click')({ target: { closest: () => ({ dataset: { action: 'more-navigation' } }) } });
  assert.equal(node('#modal').open, true);
  assert.match(node('#modal').innerHTML, /data-page="settings".*Data & backups/);
  await handlers.get('click')({
    preventDefault() {},
    target: { closest: () => ({ dataset: { page: 'settings' }, closest: selector => selector === '.more-pages' }) },
  });
  assert.equal(node('#modal').open, false);
  assert.match(node('#app').innerHTML, /<h1>Your collection\. Your data\.<\/h1>/);
});
