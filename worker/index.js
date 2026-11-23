import { normalizePricing, normalizeQuote } from '../dist/pricing.js';
import { handleSealedRequest, refreshSealedScheduled } from './sealed.js';

const DAY = 86_400_000;
const TTL = DAY;
const RETENTION_DAYS = 365;
const REQUEST_TOUCH_INTERVAL = 6 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT = 12_000;
const MAX_BODY_BYTES = 512 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.\-]{0,79}$/;
const VARIANT_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
const inFlight = new Map();

const iso = value => new Date(value).toISOString();
const cap = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
const config = env => ({
  tracked: cap(env.MAX_TRACKED_CARDS, 500, 2000),
  daily: cap(env.MAX_UPSTREAM_REQUESTS_PER_DAY, 1000, 5000),
  batch: cap(env.REFRESH_BATCH_SIZE, 3, 3),
});

class PublicError extends Error {
  constructor(message, status = 503, retryAfter = 900) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
function validId(id) { return ID_PATTERN.test(id) && !id.includes('..'); }

function servedBundle(row) {
  const bundle = JSON.parse(row.payload);
  const decorate = quote => normalizeQuote({ ...quote, lastAttemptAt: row.last_attempt_at || quote.lastAttemptAt, lastError: row.last_error || quote.lastError || null });
  return {
    ...bundle,
    reference: decorate(bundle.reference),
    variants: bundle.variants.map(variant => ({ ...variant, quote: decorate(variant.quote) })),
    lastAttemptAt: row.last_attempt_at || bundle.lastAttemptAt,
    lastError: row.last_error || null,
    nextRefreshAt: row.next_refresh_at,
    scope: 'Market-wide reference; not specific to language, condition or grade',
  };
}

async function admitCard(db, id, now, limit) {
  const activeCutoff = iso(Date.parse(now) - 30 * DAY);
  const capacityError = () => new PublicError('The active shared price catalogue has reached its configured capacity. Saved collections and archived price history are unaffected.', 503, 3600);
  let row = await db.prepare('SELECT * FROM price_cards WHERE card_id = ?1').bind(id).first();
  if (!row) {
    // A catalogue slot expires after 30 days without a request. Archived rows remain
    // available for history until retention cleanup, without reserving active slots.
    await db.prepare(`INSERT INTO price_cards (card_id, created_at, last_requested_at, next_refresh_at)
      SELECT ?1, ?2, ?2, ?2
      WHERE (SELECT COUNT(*) FROM price_cards WHERE last_requested_at >= ?4) < ?3
      ON CONFLICT(card_id) DO NOTHING`).bind(id, now, limit, activeCutoff).run();
    row = await db.prepare('SELECT * FROM price_cards WHERE card_id = ?1').bind(id).first();
    if (!row) throw capacityError();
  }
  if (row.last_requested_at < activeCutoff) {
    const reactivated = await db.prepare(`UPDATE price_cards SET last_requested_at = ?2
      WHERE card_id = ?1 AND (last_requested_at >= ?3 OR
        (SELECT COUNT(*) FROM price_cards WHERE last_requested_at >= ?3) < ?4)
      RETURNING *`).bind(id, now, activeCutoff, limit).first();
    if (!reactivated) throw capacityError();
    row = reactivated;
  } else if (Date.parse(row.last_requested_at) < Date.parse(now) - REQUEST_TOUCH_INTERVAL) {
    await db.prepare('UPDATE price_cards SET last_requested_at = ?2 WHERE card_id = ?1 AND last_requested_at < ?3')
      .bind(id, now, iso(Date.parse(now) - REQUEST_TOUCH_INTERVAL)).run();
  }
  return row;
}

function retryAfterSeconds(response, now) {
  const raw = response.headers.get('Retry-After');
  if (!raw) return null;
  const seconds = /^\d+$/.test(raw.trim()) ? Number(raw) : Math.ceil((Date.parse(raw) - now) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 7 * 86400) : null;
}

async function providerCard(id, now, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
  try {
    // Canonical English identifiers/variant labels only; prices are market-wide.
    const response = await fetchImpl(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`, {
      signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const message = response.status === 404 ? 'This card is not available from the price provider.'
        : response.status === 429 ? 'The price provider is busy. A later retry is scheduled.'
        : 'The price provider is temporarily unavailable.';
      const error = new PublicError(message, response.status === 404 ? 404 : 503, retryAfterSeconds(response, now));
      error.providerStatus = response.status;
      await response.body?.cancel();
      throw error;
    }
    if (Number(response.headers.get('Content-Length')) > MAX_BODY_BYTES) throw new PublicError('The provider response exceeded the supported size.');
    const reader = response.body?.getReader();
    if (!reader) throw new PublicError('The provider returned an empty response.');
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new PublicError('The provider response exceeded the supported size.'); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) { body.set(chunk, position); position += chunk.byteLength; }
    let data;
    try { data = JSON.parse(new TextDecoder().decode(body)); }
    catch { throw new PublicError('The provider returned unreadable price data.'); }
    if (data.id !== id) throw new PublicError('The provider returned a different card. No prices were changed.');
    return normalizePricing(data, iso(now));
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(controller.signal.aborted ? 'The price provider timed out. A later retry is scheduled.' : 'The price provider could not be reached.');
  } finally { clearTimeout(timeout); }
}

/** One row per real provider date. Re-reading yesterday's quote never fabricates today's history. */
function observationStatements(db, bundle, now) {
  const values = [['generic', bundle.reference], ...bundle.variants.map(variant => [variant.id, variant.quote])];
  return values.flatMap(([variantId, quote]) => {
    const updated = Date.parse(quote.providerUpdatedAt || '');
    if (quote.amount === null || quote.mapping === 'unverified' || !Number.isFinite(updated)
        || updated > now + 300_000 || updated < now - RETENTION_DAYS * DAY) return [];
    const date = iso(updated).slice(0, 10);
    return [db.prepare(`INSERT INTO price_history
      (card_id, variant_id, date, amount, currency, metric, product_id, provider_updated_at, fetched_at, mapping)
      SELECT ?1, ?2, ?3, ?4, 'EUR', ?5, ?6, ?7, ?8, ?9
      WHERE EXISTS (SELECT 1 FROM price_cards WHERE card_id = ?1 AND json_extract(payload, '$.fetchedAt') = ?8)
      ON CONFLICT(card_id, variant_id, date) DO UPDATE SET
        amount = excluded.amount, metric = excluded.metric, product_id = excluded.product_id,
        provider_updated_at = excluded.provider_updated_at, fetched_at = excluded.fetched_at, mapping = excluded.mapping
      WHERE excluded.provider_updated_at > price_history.provider_updated_at`)
      .bind(bundle.cardId, variantId, date, quote.amount, quote.metric, quote.productId, quote.providerUpdatedAt, bundle.fetchedAt, quote.mapping)];
  });
}

async function acquireBudget(db, now, maximum) {
  return db.prepare(`INSERT INTO upstream_budget (day, calls) VALUES (?1, 1)
    ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?2 RETURNING calls`)
    .bind(iso(now).slice(0, 10), maximum).first();
}

async function refreshCard(db, id, env, fetchImpl, now) {
  const start = iso(now);
  const lease = iso(now + 60_000);
  const claimed = await db.prepare(`UPDATE price_cards SET lease_until = ?2
    WHERE card_id = ?1 AND lease_until <= ?3 AND next_refresh_at <= ?3 RETURNING *`)
    .bind(id, lease, start).first();
  if (!claimed) return null;
  if (!await acquireBudget(db, now, config(env).daily)) {
    const nextDay = iso(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1));
    await db.prepare('UPDATE price_cards SET lease_until = ?, next_refresh_at = ? WHERE card_id = ? AND lease_until = ?')
      .bind('', nextDay, id, lease).run();
    throw new PublicError('The daily shared price refresh budget is exhausted. Saved prices remain available.', 429, Math.max(1, Math.ceil((Date.parse(nextDay) - now) / 1000)));
  }
  try {
    const bundle = await providerCard(id, now, fetchImpl);
    // A backwards provider timestamp must not overwrite a newer saved reference.
    if (claimed.payload) {
      const previous = JSON.parse(claimed.payload);
      const retainNewer = (old, fresh) => {
        const oldDate = Date.parse(old?.providerUpdatedAt || '');
        const freshDate = Date.parse(fresh?.providerUpdatedAt || '');
        if (old?.amount !== null && old?.amount !== undefined && fresh.amount !== null
            && Number.isFinite(oldDate) && (!Number.isFinite(freshDate) || freshDate < oldDate)) {
          return { ...old, lastAttemptAt: fresh.lastAttemptAt,
            lastError: 'The provider returned an older or undated observation; the previous reference was kept.' };
        }
        return fresh;
      };
      bundle.reference = retainNewer(previous.reference, bundle.reference);
      bundle.variants = bundle.variants.map(variant => ({ ...variant, quote: retainNewer(previous.variants.find(old => old.id === variant.id)?.quote, variant.quote) }));
    }
    const store = db.prepare(`UPDATE price_cards SET payload = ?2, next_refresh_at = ?3,
      failure_count = 0, lease_until = '', last_attempt_at = ?4, last_error = NULL
      WHERE card_id = ?1 AND lease_until = ?5`).bind(id, JSON.stringify(bundle), iso(now + TTL), start, lease);
    // The lease remains valid for 60s; provider requests abort after 12s. A single batch commits latest + history atomically.
    await db.batch([store, ...observationStatements(db, bundle, now)]);
    return bundle;
  } catch (error) {
    const failures = Math.min(claimed.failure_count + 1, 32);
    const backoff = error.providerStatus === 404 ? DAY : Math.min(DAY, 900_000 * 2 ** Math.min(failures - 1, 7));
    const wait = Math.max(backoff, (error.retryAfter || 0) * 1000);
    await db.prepare(`UPDATE price_cards SET lease_until = '', failure_count = ?2,
      next_refresh_at = ?3, last_attempt_at = ?4, last_error = ?5
      WHERE card_id = ?1 AND lease_until = ?6`)
      .bind(id, failures, iso(now + wait), start, error.message.slice(0, 240), lease).run();
    throw error;
  }
}

async function currentPrice(db, id, env, fetchImpl, now) {
  const row = await admitCard(db, id, iso(now), config(env).tracked);
  if (row.next_refresh_at <= iso(now)) {
    const key = `${id}:${row.created_at}`;
    let refresh = inFlight.get(key);
    if (!refresh) {
      refresh = refreshCard(db, id, env, fetchImpl, now);
      inFlight.set(key, refresh);
      refresh.finally(() => { if (inFlight.get(key) === refresh) inFlight.delete(key); }).catch(() => {});
    }
    try { await refresh; }
    catch (error) { if (!row.payload) throw error; }
  }
  const latest = await db.prepare('SELECT * FROM price_cards WHERE card_id = ?').bind(id).first();
  if (!latest.payload) {
    const seconds = Math.max(1, Math.ceil((Date.parse(latest.next_refresh_at) - now) / 1000));
    throw new PublicError(latest.last_error || 'This card is being fetched. Please try again shortly.', 503, latest.last_error ? Math.min(seconds, 86400) : 2);
  }
  return servedBundle(latest);
}

export async function handleRequest(request, env, context = {}, dependencies = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Only public read requests are supported.' }, 405, { Allow: 'GET, HEAD' });
  if (url.pathname === '/api/sealed' || url.pathname.startsWith('/api/sealed/')) return handleSealedRequest(request, env, dependencies);
  if (url.pathname === '/api/health') {
    const info = { configured: false, service: 'public-prices', retentionDays: RETENTION_DAYS, scope: 'public quotes only' };
    if (!env.PRICES_DB) return json(info, 503);
    try {
      // Validate schema readiness with at most one row read from each required table.
      await env.PRICES_DB.prepare(`SELECT
        (SELECT card_id FROM price_cards LIMIT 1) AS cards_ready,
        (SELECT card_id FROM price_history LIMIT 1) AS history_ready,
        (SELECT day FROM upstream_budget LIMIT 1) AS budget_ready`).first();
      let sealedConfigured = false;
      try {
        await env.PRICES_DB.prepare(`SELECT (SELECT id FROM sealed_feed LIMIT 1), (SELECT product_id FROM sealed_products LIMIT 1), (SELECT product_id FROM sealed_history LIMIT 1)`).first();
        sealedConfigured = true;
      } catch {}
      return json({ ...info, configured: true, sealedConfigured });
    } catch { return json(info, 503); }
  }
  const match = url.pathname.match(/^\/api\/prices\/([^/]+)(\/history)?$/);
  if (!match) return json({ error: 'Unknown API route.' }, 404);
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return json({ error: 'Invalid card identifier.' }, 400); }
  if (!validId(id)) return json({ error: 'Invalid card identifier.' }, 400);
  if (!env.PRICES_DB) return json({ error: 'The shared price service is not configured yet.' }, 503);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  const now = dependencies.now?.() ?? Date.now();
  const db = env.PRICES_DB;
  try {
    if (match[2]) {
      if ([...url.searchParams.keys()].some(key => !['variant', 'days'].includes(key))) throw new PublicError('Unsupported history parameter.', 400, null);
      const variantId = url.searchParams.get('variant') || 'generic';
      const daysText = url.searchParams.get('days') || '90';
      if (!VARIANT_PATTERN.test(variantId) || !/^\d+$/.test(daysText) || Number(daysText) < 1 || Number(daysText) > RETENTION_DAYS) throw new PublicError('Choose a valid variant and 1–365 history days.', 400, null);
      const cutoff = iso(now - (Number(daysText) - 1) * DAY).slice(0, 10);
      const result = await db.prepare(`SELECT date, amount, provider_updated_at AS providerUpdatedAt,
        fetched_at AS fetchedAt, mapping, metric, product_id AS productId FROM price_history
        WHERE card_id = ?1 AND variant_id = ?2 AND date >= ?3 AND date <= ?4 ORDER BY date LIMIT 365`)
        .bind(id, variantId, cutoff, iso(now).slice(0, 10)).all();
      return json({ cardId: id, variantId, points: result.results || [], retentionDays: RETENTION_DAYS, dateBasis: 'provider', currency: 'EUR' }, 200, { 'Cache-Control': 'public, max-age=300' });
    }
    if ([...url.searchParams.keys()].some(key => key !== 'refresh') || (url.searchParams.has('refresh') && url.searchParams.get('refresh') !== '1')) throw new PublicError('Unsupported price parameter.', 400, null);
    const bundle = await currentPrice(db, id, env, dependencies.fetch || fetch, now);
    return json(bundle, 200, { 'Cache-Control': bundle.lastError ? 'no-store' : 'public, max-age=300' });
  } catch (error) {
    if (error instanceof PublicError) return json({ error: error.message }, error.status, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    return json({ error: 'The shared price store is temporarily unavailable. Your collection remains on this device.' }, 503);
  }
}

export async function refreshScheduled(env, dependencies = {}) {
  if (!env.PRICES_DB) return { refreshed: 0, failed: 0, configured: false };
  const now = dependencies.now?.() ?? Date.now();
  const db = env.PRICES_DB;
  // Bounded cleanup protects the free-tier CPU budget and avoids a full-table sweep.
  await db.batch([
    db.prepare('DELETE FROM price_history WHERE rowid IN (SELECT rowid FROM price_history WHERE date < ? ORDER BY date LIMIT 100)').bind(iso(now - RETENTION_DAYS * DAY).slice(0, 10)),
    db.prepare('DELETE FROM upstream_budget WHERE day < ?').bind(iso(now - 2 * DAY).slice(0, 10)),
    db.prepare('DELETE FROM price_cards WHERE card_id IN (SELECT card_id FROM price_cards WHERE last_requested_at < ? AND lease_until <= ? AND NOT EXISTS (SELECT 1 FROM price_history WHERE price_history.card_id = price_cards.card_id) ORDER BY last_requested_at LIMIT 10)').bind(iso(now - RETENTION_DAYS * DAY), iso(now)),
    db.prepare('DELETE FROM price_cards WHERE card_id IN (SELECT card_id FROM price_cards WHERE payload IS NULL AND created_at < ? AND lease_until <= ? LIMIT 10)').bind(iso(now - DAY), iso(now)),
  ]);
  const result = await db.prepare(`SELECT card_id FROM price_cards WHERE next_refresh_at <= ?1
    AND lease_until <= ?1 AND last_requested_at >= ?2 ORDER BY next_refresh_at LIMIT ?3`)
    .bind(iso(now), iso(now - 30 * DAY), config(env).batch).all();
  let refreshed = 0, failed = 0;
  for (const row of result.results || []) {
    try { if (await refreshCard(db, row.card_id, env, dependencies.fetch || fetch, now)) refreshed++; }
    catch { failed++; }
  }
  return { refreshed, failed, configured: true };
}

export default {
  fetch: handleRequest,
  async scheduled(_controller, env, context) { const job = Promise.all([refreshScheduled(env), refreshSealedScheduled(env)]); context.waitUntil(job); await job; },
};
