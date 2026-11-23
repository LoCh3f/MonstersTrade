// TCGPrices' public CC BY 4.0 export. Retail asking prices, not resale values.
const FEED_URL = 'https://tcgprices.app/data/sealed-prices.csv';
const ATTRIBUTION_URL = 'https://tcgprices.app/data';
const SOURCE = 'TCGPrices · EU retail';
const DAY = 86_400_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_ROWS = 15000;
const MAX_PRODUCTS = 2000;
const PAGE_SIZE = 24;
const ID = /^sealed-tcgp-([1-9]\d{0,14})-eu$/;
const TYPES = new Set(['booster-pack','booster-box','elite-trainer-box','collection-box','tin','blister','bundle','other']);
const TYPE_MAP = { 'Booster Pack':'booster-pack', 'Booster Box':'booster-box', BoosterBox:'booster-box', 'Elite Trainer Box':'elite-trainer-box', ETB:'elite-trainer-box', Collection:'collection-box', Tin:'tin', 'Blister Pack':'blister', Blister:'blister', Bundle:'bundle' };
const HEADERS = ['tcgplayer_product_id','game','set','product','product_type','market','currency','cheapest_store_price','stores_in_stock','url','date'];
const flights = new WeakMap();
const iso = value => new Date(value).toISOString();

class FeedError extends Error {
  constructor(message, status = 503, retryAfter = 900) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers } });
}
function attribution() { return { source:SOURCE, attributionUrl:ATTRIBUTION_URL, licence:'CC BY 4.0', scope:'Lowest in-stock EU retailer asking price; language unspecified; not a resale valuation.' }; }

function csvFields(record) {
  if (!record.includes('"')) return record.split(',');
  const result = [];
  let value = '', quoted = false, closed = false;
  for (let i = 0; i < record.length; i++) {
    const c = record[i];
    if (quoted) {
      if (c === '"' && record[i+1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else value += c;
    } else if (c === ',') { result.push(value); value = ''; closed = false; }
    else if (c === '"' && !value && !closed) quoted = true;
    else if (c === '"' || closed) throw new FeedError('The sealed price export contains malformed CSV.');
    else value += c;
  }
  if (quoted) throw new FeedError('The sealed price export contains malformed CSV.');
  result.push(value);
  return result;
}

/** Validate complete CSV records in native regexp code before selecting EU Pokémon.
 * Sticky matching never starts inside a quoted multiline field, so embedded text
 * cannot impersonate a product. Only selected records materialize their fields.
 */
export function parseSealedFeed(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new FeedError('The sealed price export exceeded its supported size.');
  text = text.replace(/^\uFEFF/, '');
  const headerEnd = text.indexOf('\n');
  if (headerEnd < 0 || JSON.stringify(csvFields(text.slice(0,headerEnd).replace(/\r$/, ''))) !== JSON.stringify(HEADERS)) throw new FeedError('The sealed price export schema has changed.');
  const field = '(?:"(?:[^"]|"")*"|[^,"\\r\\n]*)';
  const relevant = [field,'"?Pokémon(?: Japan)?"?',field,field,field,'"?EU"?','"?EUR"?',field,field,field,field].join(',');
  const generic = [field,field,field,field,field,field,field,field,field,field,field].join(',');
  const records = new RegExp('(?:('+relevant+')|'+generic+')(?:\\r?\\n|$)', 'y');
  const products = [], seen = new Set(), sourceDates = new Map();
  const fetchedAt = iso(now), sourceInfo = attribution();
  records.lastIndex = headerEnd + 1;
  let rowCount = 0;
  while (records.lastIndex < text.length) {
    const match = records.exec(text);
    if (!match) throw new FeedError('The sealed price export contains malformed CSV.');
    if (++rowCount > MAX_ROWS) throw new FeedError('The sealed price export exceeded its supported row count.');
    if (!match[1]) continue;
    const record = match[1];
    const fields = csvFields(record);
    if (fields.length !== HEADERS.length) throw new FeedError('The sealed price export contains incomplete rows.');
    const [code,game,setName,name,sourceProductType,region,currency,priceText,stockText,url,date] = fields;
    if (!['Pokémon','Pokémon Japan'].includes(game) || region !== 'EU' || currency !== 'EUR') continue;
    if (!/^[1-9]\d{0,14}$/.test(code) || !name.trim() || name.length > 300 || setName.length > 300 || sourceProductType.length > 80 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FeedError('The sealed price export contains invalid product details.');
    let providerUpdatedAt = sourceDates.get(date);
    if (!providerUpdatedAt) {
      const dateTime = Date.parse(date + 'T00:00:00.000Z');
      if (!Number.isFinite(dateTime) || iso(dateTime).slice(0,10) !== date || dateTime > now + 300_000) throw new FeedError('The sealed price export contains an invalid observation date.');
      providerUpdatedAt = iso(dateTime); sourceDates.set(date, providerUpdatedAt);
    }
    if (url.length > 2000 || !/^https:\/\/tcgprices\.app\/card\/[a-z0-9-]+\/?$/.test(url)) throw new FeedError('The sealed price export contains an invalid product link.');
    if (!/^\d+$/.test(stockText) || Number(stockText) > 100000 || (priceText && !/^\d+(?:\.\d{1,6})?$/.test(priceText))) throw new FeedError('The sealed price export contains an invalid retail price.');
    const amount = priceText && Number(priceText) > 0 && Number(stockText) > 0 ? Number(priceText) : null;
    if (amount !== null && amount > 1e9) throw new FeedError('The sealed price export contains an invalid retail price.');
    const id = `sealed-tcgp-${code}-eu`;
    if (seen.has(id)) throw new FeedError('The sealed price export contains duplicate product identifiers.');
    seen.add(id);
    const market = { amount, currency:'EUR', source:SOURCE, metric:'store-low', productId:Number(code), providerUpdatedAt, fetchedAt, lastAttemptAt:fetchedAt, lastError:null, mapping:'matched' };
    products.push({ id, kind:'sealed', name, setName, setId:'', lang:'und', image:'', productType:TYPE_MAP[sourceProductType] || 'other', edition:'', productCode:code, productUrl:url, game, sourceProductType, storesInStock:Number(stockText), market, price:amount, priceUpdated:market.providerUpdatedAt, fetchedAt, lastAttemptAt:fetchedAt, lastError:null, ...sourceInfo });
    if (products.length > MAX_PRODUCTS) throw new FeedError('The sealed catalogue exceeded its supported size.');
  }
  if (!products.length) throw new FeedError('The sealed price export is incomplete or has no supported products.');
  return products;
}

function retryAfter(response, now) {
  const raw = response.headers.get('Retry-After');
  const seconds = raw && /^\d+$/.test(raw.trim()) ? Number(raw) : Math.ceil((Date.parse(raw || '') - now) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 7 * 86400) : 900;
}
async function fetchFeed(fetchImpl, now) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(FEED_URL, { redirect:'manual', signal:controller.signal, headers:{ Accept:'text/csv' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FeedError(response.status === 429 ? 'The sealed price provider is busy. A later retry is scheduled.' : 'The sealed price provider is temporarily unavailable.', 503, retryAfter(response, now));
    }
    if (Number(response.headers.get('Content-Length')) > MAX_BYTES) { await response.body?.cancel(); throw new FeedError('The sealed price export exceeded its supported size.'); }
    const reader = response.body?.getReader();
    if (!reader) throw new FeedError('The sealed price provider returned an empty response.');
    const decoder = new TextDecoder('utf-8', { fatal:true });
    let size = 0, body = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new FeedError('The sealed price export exceeded its supported size.'); }
      body += decoder.decode(value, { stream:true });
    }
    body += decoder.decode();
    return parseSealedFeed(body, now);
  } catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError(controller.signal.aborted ? 'The sealed price provider timed out. A later retry is scheduled.' : 'The sealed price provider could not be read.');
  } finally { clearTimeout(timer); }
}

async function synchronize(db, dependencies, now) {
  const start = iso(now), lease = iso(now + 120000);
  const row = await db.prepare(`UPDATE sealed_feed SET lease_until = ?1 WHERE id = 1 AND lease_until <= ?2 AND next_refresh_at <= ?2 RETURNING *`).bind(lease,start).first();
  if (!row) return false;
  try {
    const products = await fetchFeed(dependencies.fetch || fetch, now);
    // A single SQL bulk insertion avoids hundreds of subrequests. All writes share
    // the lease guard and one D1 transaction; observers never see a partial feed.
    const payload = JSON.stringify(products.map(product => ({ ...product, searchText:`${product.name} ${product.setName} ${product.game} ${product.productCode}`.toLowerCase() })));
    // D1 limits a single bound text value to 2 MiB; leave headroom for SQL/driver overhead.
    if (new TextEncoder().encode(payload).byteLength > 1800000) throw new FeedError('The normalized sealed catalogue exceeded its supported size.');
    await db.batch([
      db.prepare(`INSERT INTO sealed_products (product_id,name,search_text,product_type,payload,provider_date,seen_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.searchText'),json_extract(value,'$.productType'),
          json_remove(value,'$.searchText'),substr(json_extract(value,'$.market.providerUpdatedAt'),1,10),?2
        FROM json_each(?1) WHERE EXISTS (SELECT 1 FROM sealed_feed WHERE id = 1 AND lease_until = ?3)
        ON CONFLICT(product_id) DO UPDATE SET name=excluded.name,search_text=excluded.search_text,product_type=excluded.product_type,
          payload=CASE WHEN excluded.provider_date >= sealed_products.provider_date THEN excluded.payload ELSE sealed_products.payload END,
          provider_date=MAX(excluded.provider_date,sealed_products.provider_date),seen_at=excluded.seen_at`).bind(payload,start,lease),
      db.prepare(`INSERT INTO sealed_history (product_id,date,amount,currency,provider_updated_at,fetched_at)
        SELECT product_id,provider_date,json_extract(payload,'$.market.amount'),'EUR',json_extract(payload,'$.market.providerUpdatedAt'),json_extract(payload,'$.market.fetchedAt')
        FROM sealed_products WHERE seen_at = ?1 AND provider_date >= ?2 AND provider_date <= ?3 AND json_extract(payload,'$.market.amount') > 0
          AND EXISTS (SELECT 1 FROM sealed_feed WHERE id = 1 AND lease_until = ?4)
        ON CONFLICT(product_id,date) DO NOTHING`).bind(start,iso(now - 364*DAY).slice(0,10),start.slice(0,10),lease),
      db.prepare(`UPDATE sealed_feed SET fetched_at=?1,next_refresh_at=?2,lease_until='',last_attempt_at=?1,last_error=NULL,failure_count=0 WHERE id=1 AND lease_until=?3`).bind(start,iso(now+DAY),lease),
    ]);
    const latest = await db.prepare('SELECT fetched_at, lease_until FROM sealed_feed WHERE id=1').first();
    return latest?.fetched_at === start && latest.lease_until === '';
  } catch (error) {
    const failures = Math.min(row.failure_count+1,32);
    const delay = Math.max(Math.min(DAY,900000*2**Math.min(failures-1,7)),(error.retryAfter||0)*1000);
    await db.prepare(`UPDATE sealed_feed SET lease_until='',next_refresh_at=?1,last_attempt_at=?2,last_error=?3,failure_count=?4 WHERE id=1 AND lease_until=?5`)
      .bind(iso(now+delay),start,error.message.slice(0,240),failures,lease).run();
    throw error;
  }
}
async function ensureFeed(db, dependencies, now) {
  let feed = await db.prepare('SELECT * FROM sealed_feed WHERE id=1').first();
  if (!feed) throw new FeedError('The sealed price database needs its migration.');
  if (feed.next_refresh_at <= iso(now)) {
    let flight = flights.get(db);
    if (!flight) {
      flight = synchronize(db, dependencies, now);
      flights.set(db, flight);
      flight.finally(() => { if (flights.get(db) === flight) flights.delete(db); }).catch(() => {});
    }
    try { await flight; } catch (error) { if (!feed.fetched_at) throw error; }
    feed = await db.prepare('SELECT * FROM sealed_feed WHERE id=1').first();
  }
  if (!feed.fetched_at) throw new FeedError(feed.last_error || 'The sealed catalogue is being fetched. Please try again shortly.',503,feed.last_error?Math.max(1,Math.ceil((Date.parse(feed.next_refresh_at)-now)/1000)):2);
  return feed;
}
function serveProduct(row, feed) {
  const product = JSON.parse(row.payload);
  const absent = row.seen_at !== feed.fetched_at;
  const older = product.market.fetchedAt !== row.seen_at;
  const error = feed.last_error || (older ? 'The provider returned an older observation; the previous reference was kept.' : null);
  const market = { ...product.market, amount:absent?null:product.market.amount, lastAttemptAt:feed.last_attempt_at, lastError:error };
  return { ...product, market, price:market.amount, storesInStock:absent?0:product.storesInStock, lastAttemptAt:feed.last_attempt_at, lastError:feed.last_error, nextRefreshAt:feed.next_refresh_at, unavailable:absent };
}

export async function handleSealedRequest(request, env, dependencies = {}) {
  const url = new URL(request.url);
  if (!['GET','HEAD'].includes(request.method)) return json({error:'Only public read requests are supported.'},405,{Allow:'GET, HEAD'});
  const route = url.pathname.match(/^\/api\/sealed(?:\/([^/]+)(\/history)?)?$/);
  if (!route) return json({error:'Unknown sealed API route.'},404);
  try {
    let id = null;
    try { if (route[1]) id = decodeURIComponent(route[1]); } catch { throw new FeedError('Invalid sealed product identifier.',400,null); }
    if (id && !ID.test(id)) throw new FeedError('Invalid sealed product identifier.',400,null);
    const keys = [...url.searchParams.keys()];
    let query='',type='',page=1,days=90;
    if (!id) {
      query = (url.searchParams.get('q') || '').trim(); type = url.searchParams.get('type') || '';
      const pageText = url.searchParams.get('page') || '1';
      if (keys.some(key=>!['q','type','page'].includes(key)) || query.length > 100 || query.includes('\u0000') || (type && !TYPES.has(type)) || !/^[1-9]\d{0,3}$/.test(pageText)) throw new FeedError('Choose a valid sealed search, type and page.',400,null);
      page=Number(pageText);
    } else if (route[2]) {
      const text = url.searchParams.get('days') || '90';
      if (keys.some(key=>key!=='days') || !/^\d+$/.test(text) || Number(text)<1 || Number(text)>365) throw new FeedError('Choose 1–365 history days.',400,null);
      days=Number(text);
    } else if (keys.length) throw new FeedError('Unsupported sealed product parameter.',400,null);
    if (!env.PRICES_DB) throw new FeedError('The sealed price service is not configured yet.');
    if (request.method === 'HEAD') return new Response(null,{status:200,headers:{'Cache-Control':'no-store'}});
    const db=env.PRICES_DB, now=dependencies.now?.() ?? Date.now();
    if (route[2]) {
      const result=await db.prepare(`SELECT date,amount,provider_updated_at AS providerUpdatedAt,fetched_at AS fetchedAt FROM sealed_history WHERE product_id=?1 AND date>=?2 AND date<=?3 ORDER BY date LIMIT 365`)
        .bind(id,iso(now-(days-1)*DAY).slice(0,10),iso(now).slice(0,10)).all();
      return json({productId:id,points:result.results||[],currency:'EUR',retentionDays:365,dateBasis:'provider',...attribution()},200,{'Cache-Control':'public, max-age=300'});
    }
    const feed=await ensureFeed(db,dependencies,now);
    if (id) {
      const product=await db.prepare('SELECT * FROM sealed_products WHERE product_id=?').bind(id).first();
      if (!product) throw new FeedError('This sealed product is not available in the shared catalogue.',404,null);
      return json(serveProduct(product,feed),200,{'Cache-Control':feed.last_error?'no-store':'public, max-age=300'});
    }
    const term=query.toLowerCase();
    const where='seen_at=?1 AND (?2=\'\' OR instr(search_text,?2)>0) AND (?3=\'\' OR product_type=?3)';
    const count=await db.prepare(`SELECT COUNT(*) AS total FROM sealed_products WHERE ${where}`).bind(feed.fetched_at,term,type).first();
    const result=await db.prepare(`SELECT * FROM sealed_products WHERE ${where} ORDER BY name,product_id LIMIT ?4 OFFSET ?5`).bind(feed.fetched_at,term,type,PAGE_SIZE,(page-1)*PAGE_SIZE).all();
    return json({items:(result.results||[]).map(row=>serveProduct(row,feed)),total:count?.total||0,page,pageSize:PAGE_SIZE,fetchedAt:feed.fetched_at,lastAttemptAt:feed.last_attempt_at,lastError:feed.last_error,nextRefreshAt:feed.next_refresh_at,...attribution()},200,{'Cache-Control':feed.last_error?'no-store':'public, max-age=300'});
  } catch (error) {
    if (error instanceof FeedError) return json({error:error.message},error.status,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});
    return json({error:'The sealed price store is temporarily unavailable. Your collection remains on this device.'},503);
  }
}

export async function refreshSealedScheduled(env, dependencies = {}) {
  if (!env.PRICES_DB) return {configured:false,refreshed:false};
  const now=dependencies.now?.() ?? Date.now(), db=env.PRICES_DB;
  try {
    await db.batch([
      db.prepare('DELETE FROM sealed_history WHERE rowid IN (SELECT rowid FROM sealed_history WHERE date < ? ORDER BY date LIMIT 100)').bind(iso(now-364*DAY).slice(0,10)),
      db.prepare('DELETE FROM sealed_products WHERE product_id IN (SELECT product_id FROM sealed_products WHERE seen_at < ? AND NOT EXISTS (SELECT 1 FROM sealed_history WHERE sealed_history.product_id=sealed_products.product_id) LIMIT 10)').bind(iso(now-365*DAY)),
    ]);
    const before=await db.prepare('SELECT fetched_at FROM sealed_feed WHERE id=1').first();
    const feed=await ensureFeed(db,dependencies,now);
    return {configured:true,refreshed:before?.fetched_at!==feed.fetched_at,failed:Boolean(feed.last_error)};
  } catch { return {configured:true,refreshed:false,failed:true}; }
}
