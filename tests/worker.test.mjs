import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest, refreshScheduled } from '../worker/index.js';

const DAY = 86_400_000;
const START = Date.parse('2026-11-23T12:00:00.000Z');
const rawCard = (id = 'sv03.5-001', price = 12, updated = '2026-11-23T02:00:00Z') => ({ id, pricing: { cardmarket: { unit: 'EUR', idProduct: 123, trend: price, updated } }, variants_detailed: [] });

function harness(t, options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync(new URL('../migrations/0001_public_prices.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_active_price_catalogue.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0004_price_admission.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      const params = [];
      return {
        bind(...values) { params.push(...values); return this; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        runSync() { const result = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(result.changes) } }; },
        async run() { return this.runSync(); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(statement.runSync()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  let time = START;
  let calls = 0;
  let provider = options.provider || (async url => Response.json(rawCard(decodeURIComponent(url.split('/').at(-1)))));
  const deps = { now: () => time, fetch: async (...args) => { calls++; return provider(...args); } };
  const env = { PRICES_DB: db, ...options.env };
  const request = (path = '/api/prices/sv03.5-001', init) => handleRequest(new Request('https://example.test' + path, init), env, {}, deps);
  return { sqlite, env, deps, request, setTime: next => { time = next; }, setProvider: fn => { provider = fn; }, calls: () => calls };
}

test('canonical requests populate latest/history once and forced refresh respects the 24h cache', async t => {
  const h = harness(t);
  const response = await h.request();
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.reference.amount, 12);
  assert.equal(first.reference.mapping, 'generic');
  assert.equal(first.fetchedAt, new Date(START).toISOString());
  await h.request('/api/prices/sv03.5-001?refresh=1');
  assert.equal(h.calls(), 1);
  const history = await (await h.request('/api/prices/sv03.5-001/history?variant=generic&days=90')).json();
  assert.equal(history.points.length, 1);
  assert.equal(history.dateBasis, 'provider');
  assert.equal(history.points[0].date, '2026-11-23');
  assert.equal(history.points[0].amount, 12);
  assert.equal(h.sqlite.prepare('SELECT calls FROM upstream_budget').get().calls, 1);
});

test('re-reading old provider data does not fabricate a new daily observation', async t => {
  const h = harness(t);
  await h.request();
  h.setTime(START + DAY + 1);
  await h.request();
  assert.equal(h.calls(), 2);
  const history = await (await h.request('/api/prices/sv03.5-001/history')).json();
  assert.equal(history.points.length, 1);
  assert.equal(history.points[0].date, '2026-11-23');
  assert.equal(history.points[0].fetchedAt, new Date(START).toISOString());
});

test('Asian catalogue prices, observations and scheduled refreshes are scoped to their printing language', async t => {
  const calls = [];
  const h = harness(t, { provider: async url => {
    const language = new URL(url).pathname.split('/')[2];
    calls.push(language);
    return Response.json(rawCard(language === 'en' ? 'sv2a-025' : 'SV2a-025', { en: 3, ja: 12, 'zh-tw': 15 }[language]));
  } });
  const path = '/api/prices/sv2a-025';
  for (const [query, language, amount] of [['', 'en', 3], ['?lang=ja', 'ja', 12], ['?lang=zh-tw', 'zh-tw', 15]]) {
    const latest = await (await h.request(path + query)).json();
    assert.equal(latest.catalogueLanguage, language);
    assert.equal(latest.reference.amount, amount);
    const history = await (await h.request(path + '/history' + query)).json();
    assert.equal(history.catalogueLanguage, language);
    assert.deepEqual(history.points.map(point => point.amount), [amount]);
  }
  assert.equal((await h.request('/api/prices/SV2a-025?lang=ja')).status, 200);
  assert.equal((await h.request(path + '?lang=xx')).status, 400);
  assert.equal((await h.request(path + '?lang=ja&lang=ko')).status, 400);
  assert.deepEqual(calls, ['en', 'ja', 'zh-tw']);
  h.setTime(START + DAY + 1);
  assert.equal((await refreshScheduled(h.env, h.deps)).refreshed, 3);
  assert.deepEqual(calls.slice(3).sort(), ['en', 'ja', 'zh-tw']);
});

test('provider failures keep the previous quote and respect Retry-After/cooldown', async t => {
  const h = harness(t);
  await h.request();
  h.setTime(START + DAY + 1);
  h.setProvider(async () => new Response('', { status: 429, headers: { 'Retry-After': '7200' } }));
  const response = await h.request();
  assert.equal(response.status, 200);
  const bundle = await response.json();
  assert.equal(bundle.reference.amount, 12);
  assert.equal(bundle.reference.providerUpdatedAt, '2026-11-23T02:00:00.000Z');
  assert.match(bundle.lastError, /busy/);
  assert.equal(Date.parse(bundle.nextRefreshAt), START + DAY + 1 + 7200_000);
  await h.request('/api/prices/sv03.5-001?refresh=1');
  assert.equal(h.calls(), 2);
});

test('a successful missing-price response is distinguished from transport failure', async t => {
  const h = harness(t);
  await h.request();
  h.setTime(START + DAY + 1);
  h.setProvider(async () => Response.json({ id: 'sv03.5-001' }));
  const bundle = await (await h.request()).json();
  assert.equal(bundle.reference.amount, null);
  assert.equal(bundle.lastError, null);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 1);
});

test('older source timestamps cannot replace a newer stored reference', async t => {
  const h = harness(t);
  await h.request();
  h.setTime(START + DAY + 1);
  h.setProvider(async () => Response.json(rawCard('sv03.5-001', 99, '2026-11-21T00:00:00Z')));
  const bundle = await (await h.request()).json();
  assert.equal(bundle.reference.amount, 12);
  assert.equal(bundle.reference.providerUpdatedAt, '2026-11-23T02:00:00.000Z');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 1);
});

test('concurrent requests use a single provider acquisition', async t => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const h = harness(t, { provider: async () => { await barrier; return Response.json(rawCard()); } });
  const one = h.request();
  const two = h.request();
  await new Promise(resolve => setTimeout(resolve, 0));
  release();
  const responses = await Promise.all([one, two]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(h.calls(), 1);
});

test('admission and global upstream budgets are enforced before provider calls', async t => {
  const h = harness(t, { env: { MAX_TRACKED_CARDS: '2', MAX_UPSTREAM_REQUESTS_PER_DAY: '1' } });
  assert.equal((await h.request()).status, 200);
  const exhausted = await h.request('/api/prices/base1-4');
  assert.equal(exhausted.status, 429);
  assert.ok(Number(exhausted.headers.get('Retry-After')) > 0);
  assert.equal((await h.request('/api/prices/base1-5')).status, 429);
  assert.equal(h.calls(), 1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_cards').get().count, 1);
});

test('scheduler only refreshes bounded due, recently requested public cards', async t => {
  const h = harness(t, { env: { REFRESH_BATCH_SIZE: '2' } });
  for (const id of ['base1-1', 'base1-2', 'base1-3', 'base1-4']) await h.request('/api/prices/' + id);
  h.sqlite.prepare('UPDATE price_cards SET last_requested_at = ? WHERE card_id = ?').run('2026-01-01T00:00:00.000Z', 'base1-1');
  h.setTime(START + DAY + 1);
  const result = await refreshScheduled(h.env, h.deps);
  assert.deepEqual(result, { refreshed: 2, failed: 0, configured: true });
  assert.equal(h.calls(), 6);
});

test('unknown routes, invalid IDs, unsupported body submissions and unconfigured service fail safely', async t => {
  const h = harness(t);
  for (const path of ['/api/prices/bad%2Fid', '/api/prices/a..b', '/api/prices/base1-4?url=https://evil.test', '/api/prices/base1-4/history?days=9999']) {
    assert.equal((await h.request(path)).status, 400, path);
  }
  assert.equal((await h.request('/api/unknown')).status, 404);
  assert.equal((await h.request('/api/prices/base1-4', { method: 'POST', body: '{"collection":[]}' })).status, 405);
  assert.equal(h.calls(), 0);
  const missing = await handleRequest(new Request('https://app.test/api/prices/base1-4'), {});
  assert.equal(missing.status, 503);
  const health = await handleRequest(new Request('https://app.test/api/health'), {});
  assert.equal((await health.json()).configured, false);
  const asset = await handleRequest(new Request('https://app.test/'), { ASSETS: { fetch: async () => new Response('asset') } });
  assert.equal(await asset.text(), 'asset');
});

test('mismatched provider IDs cannot poison the cache', async t => {
  const h = harness(t, { provider: async () => Response.json(rawCard('another-card', 999)) });
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /different card/);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 0);
});


test('an expired or stolen lease cannot append observations after losing ownership', async t => {
  const h = harness(t);
  h.setProvider(async () => {
    h.sqlite.prepare('UPDATE price_cards SET lease_until = ? WHERE card_id = ?').run('2026-11-24T00:00:00.000Z', 'sv03.5-001');
    return Response.json(rawCard());
  });
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '2');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 0);
  assert.equal(h.sqlite.prepare('SELECT payload FROM price_cards').get().payload, null);
});

test('provider timeouts abort and schedule a bounded later retry', async t => {
  let signal;
  const h = harness(t, { provider: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const responsePromise = h.request();
  for (let i = 0; !signal && i < 30; i++) await Promise.resolve();
  assert.ok(signal);
  t.mock.timers.tick(12_000);
  const response = await responsePromise;
  assert.equal(response.status, 503);
  assert.equal(signal.aborted, true);
  assert.match((await response.json()).error, /timed out/);
  const row = h.sqlite.prepare('SELECT failure_count, next_refresh_at FROM price_cards').get();
  assert.equal(row.failure_count, 1);
  assert.equal(Date.parse(row.next_refresh_at), START + 900_000);
});

test('history retention cleanup is incremental and preserves current observations', async t => {
  const h = harness(t);
  await h.request();
  h.sqlite.prepare(`INSERT INTO price_history (card_id,variant_id,date,amount,currency,metric,provider_updated_at,fetched_at,mapping)
    VALUES ('sv03.5-001','generic','2020-01-01',1,'EUR','trend','2020-01-01T00:00:00.000Z','2020-01-01T01:00:00.000Z','generic')`).run();
  await refreshScheduled(h.env, h.deps);
  assert.deepEqual(h.sqlite.prepare('SELECT date FROM price_history').all().map(row => row.date), ['2026-11-23']);
});


test('an undated positive response cannot replace a dated quote for a new browser', async t => {
  const h = harness(t);
  await h.request();
  h.setTime(START + DAY + 1);
  h.setProvider(async () => Response.json(rawCard('sv03.5-001', 999, null)));
  const first = await (await h.request()).json();
  const laterBrowser = await (await h.request()).json();
  for (const bundle of [first, laterBrowser]) {
    assert.equal(bundle.reference.amount, 12);
    assert.equal(bundle.reference.providerUpdatedAt, '2026-11-23T02:00:00.000Z');
    assert.equal(bundle.reference.fetchedAt, new Date(START).toISOString());
    assert.equal(bundle.reference.lastAttemptAt, new Date(START + DAY + 1).toISOString());
    assert.match(bundle.reference.lastError, /undated observation/);
    assert.equal(bundle.lastError, null, 'transport succeeded; quality warning belongs to the retained quote');
  }
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 1);
});

test('an initial fetch owned by another isolate is a retryable error, never a success-shaped error body', async t => {
  const h = harness(t);
  h.sqlite.prepare(`INSERT INTO price_cards (card_id, created_at, last_requested_at, next_refresh_at, lease_until)
    VALUES (?,?,?,?,?)`).run('sv03.5-001', new Date(START).toISOString(), new Date(START).toISOString(),
      new Date(START).toISOString(), new Date(START + 60_000).toISOString());
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.equal(response.ok, false);
  assert.equal(response.headers.get('Retry-After'), '2');
  assert.match((await response.json()).error, /being fetched/);
  assert.equal(h.calls(), 0);
});


test('edge fetch uses manual redirects and never follows an upstream redirect', async t => {
  let redirectMode;
  const h = harness(t, { provider: async (_url, options) => {
    redirectMode = options.redirect;
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/prices' } });
  } });
  assert.equal((await h.request()).status, 503);
  assert.equal(redirectMode, 'manual');
  assert.equal(h.calls(), 1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 0);
});

test('inactive cards release active capacity while archived history remains queryable', async t => {
  const h = harness(t, { env: { MAX_TRACKED_CARDS: '1' } });
  await h.request();
  h.setTime(START + 31 * DAY);
  h.setProvider(async url => Response.json(rawCard(decodeURIComponent(url.split('/').at(-1)), 20, new Date(START + 31 * DAY).toISOString())));
  assert.equal((await h.request('/api/prices/base1-4')).status, 200);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_cards').get().count, 2);
  const archived = await (await h.request('/api/prices/sv03.5-001/history?days=365')).json();
  assert.equal(archived.points.length, 1);
  assert.equal(archived.points[0].amount, 12);
  assert.equal((await h.request()).status, 503, 'reactivation must also honor active capacity');
  h.setTime(START + 62 * DAY);
  assert.equal((await h.request()).status, 200, 'a later inactive slot can reactivate the original card');
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_cards').get().count, 2);
});


test('archive cleanup never cascades away retained observations or an unbounded history batch', async t => {
  const h = harness(t);
  await h.request();
  h.sqlite.prepare('UPDATE price_cards SET last_requested_at = ? WHERE card_id = ?').run('2020-01-01T00:00:00.000Z', 'sv03.5-001');
  await refreshScheduled(h.env, h.deps);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_cards').get().count, 1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 1);
  h.setTime(START + 366 * DAY);
  await refreshScheduled(h.env, h.deps);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_cards').get().count, 0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS count FROM price_history').get().count, 0);
});


test('health verifies all required tables and hides unmigrated database details', async t => {
  const h = harness(t);
  const ready = await h.request('/api/health');
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).configured, true);
  h.sqlite.exec('DROP TABLE price_history');
  const unready = await h.request('/api/health');
  assert.equal(unready.status, 503);
  assert.deepEqual(await unready.json(), { configured: false, service: 'public-prices', retentionDays: 365, scope: 'public quotes only', deployCommit: null });
  assert.equal(h.calls(), 0);
});

test('failed lookups beyond the former capacity keep bounded negatives and leave confirmed slots available', async t => {
  const h = harness(t, { env: { MAX_TRACKED_CARDS: '2', MAX_UPSTREAM_REQUESTS_PER_DAY: '5000', MAX_NEW_CARD_REQUESTS_PER_DAY: '1000' },
    provider: async url => url.includes('missing-') ? new Response(null, { status: 404 }) : Response.json(rawCard(url.split('/').at(-1))) });
  for (let i = 0; i < 510; i++) assert.equal((await h.request('/api/prices/missing-' + i)).status, 404);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_cards WHERE payload IS NULL').get().n, 256);
  assert.equal((await h.request('/api/prices/missing-509')).status, 503);
  assert.equal(h.calls(), 510, 'negative cache avoids another provider acquisition');
  assert.equal((await h.request('/api/prices/base1-1')).status, 200);
  assert.equal((await h.request('/api/prices/base1-2')).status, 200);
  assert.equal((await h.request('/api/prices/base1-3')).status, 503);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_cards WHERE payload IS NOT NULL').get().n, 2);
});

test('new-card failures cannot spend the reserved budget for confirmed refreshes', async t => {
  const h = harness(t, { env: { MAX_UPSTREAM_REQUESTS_PER_DAY: '8' } });
  await h.request();
  h.setTime(START + DAY + 1);
  h.setProvider(async url => url.includes('missing-') ? new Response(null, { status: 404 }) : Response.json(rawCard(url.split('/').at(-1), 18, '2026-11-24T02:00:00Z')));
  assert.equal((await h.request('/api/prices/missing-one')).status, 404);
  assert.equal((await h.request('/api/prices/missing-two')).status, 404);
  assert.equal((await h.request('/api/prices/missing-three')).status, 429);
  assert.equal((await (await h.request()).json()).reference.amount, 18);
  assert.equal(h.sqlite.prepare("SELECT calls FROM upstream_budget WHERE day='2026-11-24'").get().calls, 3);
  assert.equal(h.sqlite.prepare("SELECT calls FROM price_admission_budget WHERE day='2026-11-24'").get().calls, 2);
});

test('concurrent provisional cards cannot over-promote the confirmed capacity', async t => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const h = harness(t, { env: { MAX_TRACKED_CARDS: '1' }, provider: async url => {
    await barrier; return Response.json(rawCard(url.split('/').at(-1)));
  } });
  const one = h.request('/api/prices/race-one'), two = h.request('/api/prices/race-two');
  await new Promise(resolve => setTimeout(resolve, 0));
  release();
  assert.deepEqual((await Promise.all([one, two])).map(response => response.status).sort(), [200, 503]);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_cards WHERE payload IS NOT NULL').get().n, 1);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_history').get().n, 1);
});

test('rate limiting runs before database work, uses transient hashed keys and fails closed when required', async t => {
  let key;
  const h = harness(t, { env: { REQUIRE_RATE_LIMITERS: 'true', PUBLIC_API_RATE_LIMITER: { limit: async value => { key = value.key; return { success: false }; } }, PRICE_ADMISSION_RATE_LIMITER: { limit: async () => ({ success: true }) } } });
  const denied = await h.request('/api/prices/base1-4', { headers: { 'CF-Connecting-IP': '192.0.2.10' } });
  assert.equal(denied.status, 429); assert.equal(denied.headers.get('Retry-After'), '60');
  assert.match(key, /^[a-f0-9]{64}$/); assert.ok(!key.includes('192.0.2.10'));
  assert.equal(h.calls(), 0); assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_cards').get().n, 0);
  delete h.env.PUBLIC_API_RATE_LIMITER;
  assert.equal((await h.request()).status, 503);
  assert.equal((await h.request('/api/health')).status, 503);
});

test('admission rate limits do not deny cached confirmed cards and separate clients share no key', async t => {
  const seen = [];
  let allow = true;
  const h = harness(t, { env: { PRICE_ADMISSION_RATE_LIMITER: { limit: async ({ key }) => { seen.push(key); return { success: allow }; } } } });
  assert.equal((await h.request('/api/prices/base1-4', { headers: { 'CF-Connecting-IP': '192.0.2.1' } })).status, 200);
  allow = false;
  assert.equal((await h.request('/api/prices/base1-4')).status, 200);
  assert.equal((await h.request('/api/prices/base1-5', { headers: { 'CF-Connecting-IP': '192.0.2.2' } })).status, 429);
  assert.equal(seen.length, 2); assert.notEqual(seen[0], seen[1]);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_cards').get().n, 1);
});

test('health exposes only a validated deployment commit', async t => {
  const h = harness(t, { env: { DEPLOY_COMMIT: 'AB'.repeat(20) } });
  assert.equal((await (await h.request('/api/health')).json()).deployCommit, 'ab'.repeat(20));
  h.env.DEPLOY_COMMIT = 'secret-or-untrusted-environment-value';
  assert.equal((await (await h.request('/api/health')).json()).deployCommit, null);
});

test('exhausted admission allowance rejects distinct IDs without further database writes', async t => {
  const h = harness(t, { env: { MAX_UPSTREAM_REQUESTS_PER_DAY: '8' }, provider: async () => new Response(null, {status:404}) });
  assert.equal((await h.request('/api/prices/missing-one')).status,404);
  assert.equal((await h.request('/api/prices/missing-two')).status,404);
  const before=h.sqlite.prepare('SELECT total_changes() AS n').get().n;
  for(let i=0;i<100;i++)assert.equal((await h.request('/api/prices/exhausted-'+i)).status,429);
  assert.equal(h.sqlite.prepare('SELECT total_changes() AS n').get().n,before);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM price_cards').get().n,2);
  assert.equal(h.calls(),2);
});
