import { CARD_OFFER_CONDITIONS, cardOfferBlueprint } from '../dist/card-offers.js';
import { operationalEvent } from './security.js';

const DAY = 86_400_000;
const RETRY = 15 * 60_000;
const MAX_BODY_BYTES = 1024 * 1024;

export function lowestOffers(value, blueprintId, language) {
  const offers = value?.[blueprintId];
  if (!offers && value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return {};
  if (!Array.isArray(offers)) throw new Error('Unexpected CardTrader catalogue response.');
  const prices = {};
  for (const offer of offers) {
    const properties = offer?.properties_hash;
    const price = offer?.price;
    if (offer?.blueprint_id !== blueprintId || !Number.isSafeInteger(offer.quantity) || offer.quantity < 1
      || offer.graded !== false || offer.bundle_size !== 1 || properties?.pokemon_language !== language
      || properties.signed || properties.altered || properties.pokemon_reverse || properties.first_edition
      || !CARD_OFFER_CONDITIONS.includes(properties.condition) || price?.currency !== 'EUR'
      || !Number.isSafeInteger(price.cents) || price.cents <= 0 || price.cents > 1e11) continue;
    const condition = properties.condition;
    if (!prices[condition] || price.cents < prices[condition]) prices[condition] = price.cents;
  }
  return prices;
}

async function fetchOffers(blueprintId, language, token, fetchImpl) {
  const url = new URL('https://api.cardtrader.com/api/v2/marketplace/products');
  url.search = new URLSearchParams({ blueprint_id: String(blueprintId), language });
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok || Number(response.headers.get('Content-Length')) > MAX_BODY_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error('CardTrader offers unavailable.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('CardTrader response exceeded the supported size.');
    }
    body += decoder.decode(value, { stream: true });
  }
  return lowestOffers(JSON.parse(body + decoder.decode()), blueprintId, language);
}

export async function handleCardOffers(url, env, dependencies = {}) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const language = url.searchParams.get('lang');
  const id = url.pathname.slice('/api/card-offers/'.length);
  const blueprintId = cardOfferBlueprint(id, language);
  if (!blueprintId || url.searchParams.size !== 1) return Response.json({ error: 'No reviewed CardTrader mapping for this card and language.' }, { status: 404, headers });
  if (!env.PRICES_DB || !env.CARDTRADER_MARKET_TOKEN) return new Response(null, { status: 204, headers });

  const db = env.PRICES_DB;
  const now = dependencies.now?.() ?? Date.now();
  const current = () => db.prepare('SELECT payload, next_refresh_at FROM card_offers WHERE blueprint_id=?1 AND language=?2').bind(blueprintId, language).first();
  const respond = row => row?.payload
    ? new Response(row.payload, { headers: { ...headers, 'Content-Type': 'application/json' } })
    : Response.json({ error: 'CardTrader offers are temporarily unavailable.' }, { status: 503, headers: { ...headers, 'Retry-After': '900' } });
  try {
    const row = await current();
    if (row?.next_refresh_at > now) return respond(row);
    const leaseUntil = now + RETRY;
    const lease = await db.prepare(`INSERT INTO card_offers (blueprint_id, language, next_refresh_at) VALUES (?1, ?2, ?3)
      ON CONFLICT(blueprint_id, language) DO UPDATE SET next_refresh_at=excluded.next_refresh_at
      WHERE card_offers.next_refresh_at<=?4 RETURNING payload`).bind(blueprintId, language, leaseUntil, now).first();
    if (!lease) return respond(await current());
    try {
      const prices = await fetchOffers(blueprintId, language, env.CARDTRADER_MARKET_TOKEN, dependencies.fetch || fetch);
      const payload = JSON.stringify({ blueprintId, language, currency: 'EUR', observedAt: new Date(now).toISOString(), prices });
      await db.prepare('UPDATE card_offers SET payload=?3, next_refresh_at=?4 WHERE blueprint_id=?1 AND language=?2 AND next_refresh_at=?5')
        .bind(blueprintId, language, payload, now + DAY, leaseUntil).run();
      return respond({ payload });
    } catch {
      operationalEvent('cardtrader', 'refresh_failure', { status: 503 });
      return respond(lease);
    }
  } catch {
    operationalEvent('cardtrader', 'request_failure', { status: 503 });
    return respond(null);
  }
}
