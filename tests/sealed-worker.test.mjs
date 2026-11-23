import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../worker/index.js';
import { parseSealedFeed, refreshSealedScheduled } from '../worker/sealed.js';

const DAY=86400000, START=Date.parse('2026-11-23T12:00:00Z');
const HEADER='tcgplayer_product_id,game,set,product,product_type,market,currency,cheapest_store_price,stores_in_stock,url,date';
const ID='sealed-tcgp-673436-eu';
const raw=(changes={})=>({tcgplayer_product_id:'673436',game:'Pokémon',set:'First Partner Collection 2026',product:'First Partner Illustration Collection (Series 1)',product_type:'Collection',market:'EU',currency:'EUR',cheapest_store_price:'43.90',stores_in_stock:'10',url:'https://tcgprices.app/card/first-partner-illustration-collection-series-1',date:'2026-11-22',...changes});
const csv=(rows=[raw()])=>HEADER+'\n'+rows.map(row=>HEADER.split(',').map(key=>/[",\r\n]/.test(row[key])?'"'+row[key].replaceAll('"','""')+'"':row[key]).join(',')).join('\n')+'\n';

function harness(t, provider) {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of ['0001_public_prices.sql','0002_active_price_catalogue.sql','0003_sealed_prices.sql','0004_price_admission.sql','0005_sealed_catalogue_snapshot.sql']) sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  t.after(()=>sqlite.close());
  const db={prepare(sql){const params=[];return{bind(...values){params.push(...values);return this;},async first(){return sqlite.prepare(sql).get(...params)||null;},async all(){return{results:sqlite.prepare(sql).all(...params)};},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...params).changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  let now=START,calls=0,upstream=provider||(()=>new Response(csv()));
  const deps={now:()=>now,fetch:async(...args)=>{calls++;return upstream(...args);}};
  const env={PRICES_DB:db};
  return{sqlite,env,deps,calls:()=>calls,setTime:time=>{now=time;},setProvider:fn=>{upstream=fn;},request:(path='/api/sealed',init)=>handleRequest(new Request('https://test.example'+path,init),env,{},deps)};
}

test('sealed feed selects EU Pokémon retail references without inventing language or resale prices',()=>{
  const items=parseSealedFeed(csv([raw(),raw({tcgplayer_product_id:'2',game:'Magic'}),raw({tcgplayer_product_id:'3',currency:'USD',market:'US'}),raw({tcgplayer_product_id:'4',game:'Pokémon Japan',product_type:'BoosterBox'})]),START);
  assert.equal(items.length,2);
  assert.equal(items[0].id,ID);
  assert.equal(items[0].lang,'und');
  assert.equal(items[0].market.amount,43.9);
  assert.equal(items[0].market.metric,'store-low');
  assert.equal(items[0].market.mapping,'matched');
  assert.equal(items[0].market.providerUpdatedAt,'2026-11-22T00:00:00.000Z');
  assert.equal(items[0].licence,'CC BY 4.0');
  assert.equal(items[1].productType,'booster-box');
  assert.match(items[0].scope,/language unspecified/);
});

test('sealed CSV handles quoted commas, escaped quotes and line breaks; invalid source identities reject',()=>{
  const name='Collection, "special"\nEdition';
  assert.equal(parseSealedFeed(csv([raw({product:name})]),START)[0].name,name);
  for(const changes of [{url:'https://evil.example/card/test'},{date:'2026-02-30'},{date:'2099-01-01'},{cheapest_store_price:'NaN'},{stores_in_stock:'-1'}]) assert.throws(()=>parseSealedFeed(csv([raw(changes)]),START));
  assert.throws(()=>parseSealedFeed(csv([raw(),raw()]),START),/duplicate/);
  const broken=csv([raw(),raw({tcgplayer_product_id:'2'})]).replace('2,Pokémon,First Partner Collection 2026,','2,Pokémon,First Partner "Collection 2026,');
  assert.throws(()=>parseSealedFeed(broken,START),/malformed CSV/);
  assert.throws(()=>parseSealedFeed(csv([raw(),raw({tcgplayer_product_id:'invalid'})]),START),/invalid product details/);
  assert.throws(()=>parseSealedFeed('wrong,headers\n1,2\n',START),/schema/);
  assert.equal(parseSealedFeed(csv([raw({stores_in_stock:'0'})]),START)[0].market.amount,null);
});

test('quoted multiline text cannot impersonate a supported product or obscure malformed record boundaries',()=>{
  const fake=csv([raw({tcgplayer_product_id:'999'})]).split('\n')[1];
  const unrelated=raw({tcgplayer_product_id:'2',game:'Magic',product:`Unrelated product\n${fake}\ncontinued name`});
  const supported=raw({product:`Collection\n${fake}\ncontinued name`});
  assert.deepEqual(parseSealedFeed(csv([unrelated,raw()]),START).map(product=>product.id),[ID]);
  assert.equal(parseSealedFeed(csv([supported]),START)[0].name,supported.product);
  const broken=csv([unrelated,raw()]).replace('Unrelated product','Unrelated "product');
  assert.throws(()=>parseSealedFeed(broken,START),/malformed CSV/);
  const quoted=HEADER+'\r\n'+HEADER.split(',').map(key=>'"'+raw()[key].replaceAll('"','""')+'"').join(',')+'\r\n';
  assert.equal(parseSealedFeed(quoted,START)[0].id,ID);
});

test('sealed product filters map the full category names published in the real feed',()=>{
  const labels=['Booster Pack','Booster Box','Elite Trainer Box','Collection','Tin','Blister Pack','Bundle','Starter Deck','Prerelease','Case','Other','BoosterBox','ETB','Blister'];
  const expected=['booster-pack','booster-box','elite-trainer-box','collection-box','tin','blister','bundle','other','other','other','other','booster-box','elite-trainer-box','blister'];
  const products=parseSealedFeed(csv(labels.map((product_type,i)=>raw({tcgplayer_product_id:String(i+1),product_type}))),START);
  assert.deepEqual(products.map(product=>product.productType),expected);
  assert.deepEqual(products.map(product=>product.sourceProductType),labels);
});

test('one daily feed populates searchable products and provider-dated history with bounded public endpoints',async t=>{
  let redirect;
  const h=harness(t,(_url,options)=>{redirect=options.redirect;return new Response(csv([raw(),raw({tcgplayer_product_id:'2',product:'Test Booster Box',product_type:'BoosterBox'})]));});
  const search=await(await h.request()).json();
  assert.equal(search.items.length,2);
  assert.equal(search.total,2);
  assert.equal(search.pageSize,24);
  assert.equal(search.attributionUrl,'https://tcgprices.app/data');
  const product=await(await h.request('/api/sealed/'+ID)).json();
  assert.equal(product.market.amount,43.9);
  const history=await(await h.request('/api/sealed/'+ID+'/history')).json();
  assert.equal(history.productId,ID);
  assert.deepEqual(history.points.map(p=>p.date),['2026-11-22']);
  assert.equal((await(await h.request('/api/sealed?q=booster&type=booster-box')).json()).total,1);
  assert.equal((await(await h.request('/api/sealed?page=2')).json()).items.length,0);
  assert.equal(h.calls(),1);
  assert.equal(redirect,'manual');
});

test('re-fetching an unchanged provider day does not manufacture daily history',async t=>{
  const h=harness(t);await h.request();h.setTime(START+DAY+1);await h.request();
  assert.equal(h.calls(),2);
  const history=await(await h.request('/api/sealed/'+ID+'/history')).json();
  assert.equal(history.points.length,1);
  assert.equal(history.points[0].fetchedAt,new Date(START).toISOString());
});

test('provider failures retain earlier quotes, dates, and a global retry cooldown',async t=>{
  const h=harness(t);await h.request();h.setTime(START+DAY+1);
  h.setProvider(()=>new Response(null,{status:429,headers:{'Retry-After':'7200'}}));
  const product=await(await h.request('/api/sealed/'+ID)).json();
  assert.equal(product.market.amount,43.9);
  assert.equal(product.market.fetchedAt,new Date(START).toISOString());
  assert.match(product.market.lastError,/busy/);
  await h.request();assert.equal(h.calls(),2);
  assert.equal(Date.parse(product.nextRefreshAt),START+DAY+1+7200000);
});

test('invalid or oversized initial feeds fail without partially publishing products',async t=>{
  const h=harness(t,()=>new Response(csv([raw(),raw({tcgplayer_product_id:'2',url:'https://evil.example'})])));
  assert.equal((await h.request()).status,503);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_products').get().n,0);
  const tooLarge=harness(t,()=>new Response('x',{headers:{'Content-Length':String(4*1024*1024)}}));
  assert.equal((await tooLarge.request()).status,503);
  const oversizedPayload=Array.from({length:1000},(_,i)=>raw({tcgplayer_product_id:String(i+1),product:'x'.repeat(300),set:'y'.repeat(300),url:'https://tcgprices.app/card/'+'z'.repeat(900)}));
  const tooLargeNormalized=harness(t,()=>new Response(csv(oversizedPayload)));
  const response=await tooLargeNormalized.request();
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/normalized sealed catalogue exceeded/);
  assert.equal(tooLargeNormalized.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_products').get().n,0);
});

test('old feed observations never overwrite newer references; missing current products become unavailable',async t=>{
  const h=harness(t);await h.request();h.setTime(START+DAY+1);
  h.setProvider(()=>new Response(csv([raw({date:'2026-11-20',cheapest_store_price:'999'})])));
  const old=await(await h.request('/api/sealed/'+ID)).json();
  assert.equal(old.market.amount,43.9);
  assert.equal(old.market.fetchedAt,new Date(START).toISOString());
  assert.match(old.market.lastError,/older/);
  h.setTime(START+2*DAY+2);
  h.setProvider(()=>new Response(csv([raw({tcgplayer_product_id:'2',date:'2026-11-25'})])));
  const missing=await(await h.request('/api/sealed/'+ID)).json();
  assert.equal(missing.market.amount,null);assert.equal(missing.unavailable,true);
  assert.equal((await(await h.request()).json()).total,1);
  assert.equal((await(await h.request('/api/sealed/'+ID+'/history')).json()).points.length,1);
});

test('a successful out-of-stock update clears current quote without deleting its history',async t=>{
  const h=harness(t);await h.request();h.setTime(START+DAY+1);
  h.setProvider(()=>new Response(csv([raw({date:'2026-11-24',stores_in_stock:'0'})])));
  assert.equal((await(await h.request('/api/sealed/'+ID)).json()).market.amount,null);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_history').get().n,1);
});

test('concurrent public requests share one acquisition; an external initial lease yields retryable status',async t=>{
  let release;const barrier=new Promise(resolve=>{release=resolve;});
  const h=harness(t,async()=>{await barrier;return new Response(csv());});
  const one=h.request(),two=h.request();await new Promise(resolve=>setTimeout(resolve,0));release();
  assert.deepEqual((await Promise.all([one,two])).map(r=>r.status),[200,200]);assert.equal(h.calls(),1);
  const other=harness(t);other.sqlite.prepare('UPDATE sealed_feed SET lease_until=?').run(new Date(START+60000).toISOString());
  const response=await other.request();assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'2');assert.equal(other.calls(),0);
});

test('a stolen lease cannot publish catalogue or history',async t=>{
  const h=harness(t);h.setProvider(()=>{h.sqlite.prepare('UPDATE sealed_feed SET lease_until=?').run(new Date(START+DAY).toISOString());return new Response(csv());});
  assert.equal((await h.request()).status,503);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_products').get().n,0);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_history').get().n,0);
});

test('scheduled synchronization respects the shared 24h TTL and bounded retention cleanup',async t=>{
  const h=harness(t);
  const first=await refreshSealedScheduled(h.env,h.deps);assert.equal(first.refreshed,true);
  assert.equal((await refreshSealedScheduled(h.env,h.deps)).refreshed,false);assert.equal(h.calls(),1);
  h.sqlite.prepare("INSERT INTO sealed_history VALUES (?,'2020-01-01',1,'EUR','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')").run(ID);
  await refreshSealedScheduled(h.env,h.deps);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_history').get().n,1);
  h.setTime(START+DAY+1);assert.equal((await refreshSealedScheduled(h.env,h.deps)).refreshed,true);assert.equal(h.calls(),2);
});

test('untrusted parameters, methods, redirects and unmigrated stores fail safely',async t=>{
  const h=harness(t);
  for(const path of ['/api/sealed?type=wrong','/api/sealed?page=0','/api/sealed?url=https://evil.test','/api/sealed/bad-id','/api/sealed/'+ID+'?refresh=1','/api/sealed/'+ID+'/history?days=999']) assert.equal((await h.request(path)).status,400,path);
  assert.equal((await h.request('/api/sealed',{method:'POST',body:'private holdings'})).status,405);
  assert.equal(h.calls(),0);
  h.setProvider(()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}}));assert.equal((await h.request()).status,503);assert.equal(h.calls(),1);
  h.sqlite.exec('DROP TABLE sealed_products');assert.equal((await h.request()).status,503);
  const health=await(await h.request('/api/health')).json();assert.equal(health.configured,true);assert.equal(health.sealedConfigured,false);
});

test('a stalled sealed feed aborts after twelve seconds and schedules a retry',async t=>{
  let signal;
  const h=harness(t,async(_url,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));});
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=h.request();for(let i=0;!signal&&i<30;i++)await Promise.resolve();assert.ok(signal);
  t.mock.timers.tick(12000);
  assert.equal((await pending).status,503);assert.equal(signal.aborted,true);
  assert.equal(h.sqlite.prepare('SELECT failure_count FROM sealed_feed').get().failure_count,1);
});

test('search retries a concurrent feed replacement without mixing generations',async t=>{
  const h=harness(t);await h.request();
  const prepare=h.env.PRICES_DB.prepare.bind(h.env.PRICES_DB);
  let replaced=false;
  h.env.PRICES_DB.prepare=sql=>{
    const statement=prepare(sql);
    if(sql.includes('CROSS JOIN sealed_products')){
      const all=statement.all.bind(statement);
      statement.all=async()=>{
        if(!replaced){
          replaced=true;h.setTime(START+DAY+1);
          h.setProvider(()=>new Response(csv([raw({product:'Replacement Box',date:'2026-11-24',cheapest_store_price:'99'})])));
          await refreshSealedScheduled(h.env,h.deps);
        }
        return all();
      };
    }
    return statement;
  };
  const response=await h.request();assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.total,1);assert.deepEqual(result.items.map(item=>item.id),[ID]);
  assert.equal(result.items[0].market.amount,99);
  assert.equal(result.fetchedAt,new Date(START+DAY+1).toISOString());
  assert.equal(result.items[0].unavailable,false);
});

test('snapshot and products roll back together when publication fails',async t=>{
  const h=harness(t);await h.request();
  const before=h.sqlite.prepare('SELECT * FROM sealed_catalogue').get();
  h.setTime(START+DAY+1);h.setProvider(()=>new Response(csv([raw({tcgplayer_product_id:'2',date:'2026-11-24'})])));
  h.sqlite.exec("CREATE TRIGGER reject_snapshot BEFORE UPDATE ON sealed_catalogue BEGIN SELECT RAISE(ABORT,'private-database-detail'); END");
  const response=await h.request();assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.items[0].id,ID);
  assert.ok(!JSON.stringify(result).includes('private-database-detail'));
  assert.deepEqual(h.sqlite.prepare('SELECT * FROM sealed_catalogue').get(),before);
  assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM sealed_products').get().n,1);
});

test('a feed published by the old Worker after migration repairs once without another provider fetch',async t=>{
  const h=harness(t);await h.request();
  const replacement=new Date(START+1000).toISOString();
  // Previous code updates products/feed but knows nothing about sealed_catalogue.
  h.sqlite.prepare('UPDATE sealed_products SET seen_at=?,name=?,search_text=?').run(replacement,'Old writer replacement','old writer replacement');
  h.sqlite.prepare('UPDATE sealed_feed SET fetched_at=?,next_refresh_at=?').run(replacement,new Date(START+DAY).toISOString());
  const prepare=h.env.PRICES_DB.prepare.bind(h.env.PRICES_DB);
  let scans=0;
  h.env.PRICES_DB.prepare=sql=>{if(sql.includes('UPDATE sealed_catalogue SET fetched_at=') && sql.includes('json_group_array'))scans++;return prepare(sql);};
  const responses=await Promise.all(Array.from({length:10},()=>h.request('/api/sealed?q=old%20writer')));
  for(const response of responses){assert.equal(response.status,200);assert.equal((await response.json()).total,1);}
  assert.equal(scans,1);assert.equal(h.calls(),1);
  assert.equal(h.sqlite.prepare('SELECT fetched_at FROM sealed_catalogue').get().fetched_at,replacement);
});

test('a failed generation repair retains its cooldown instead of rescanning on every distinct query',async t=>{
  const h=harness(t);await h.request();
  h.sqlite.prepare('UPDATE sealed_feed SET fetched_at=?').run(new Date(START+1000).toISOString());
  h.sqlite.exec("CREATE TRIGGER reject_repair BEFORE UPDATE OF payload ON sealed_catalogue BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  const prepare=h.env.PRICES_DB.prepare.bind(h.env.PRICES_DB);let scans=0;
  h.env.PRICES_DB.prepare=sql=>{if(sql.includes('UPDATE sealed_catalogue SET fetched_at=') && sql.includes('json_group_array'))scans++;return prepare(sql);};
  for(let i=0;i<10;i++)assert.equal((await h.request('/api/sealed?q=unique-'+i)).status,503);
  assert.equal(scans,1);assert.equal(h.calls(),1);
});

test('a stale reader cannot reserve the repair lease of an already-current generation',async t=>{
  const h=harness(t);await h.request();
  const original=h.env.PRICES_DB,prepare=original.prepare.bind(original),replacement=new Date(START+1000).toISOString();
  let replaced=false;
  h.env.PRICES_DB={...original,prepare(sql){
    if(!replaced && sql.startsWith('SELECT fetched_at,payload FROM sealed_catalogue')){
      replaced=true;
      h.sqlite.prepare('UPDATE sealed_feed SET fetched_at=?').run(replacement);
      h.sqlite.prepare('UPDATE sealed_products SET seen_at=?').run(replacement);
      h.sqlite.prepare('UPDATE sealed_catalogue SET fetched_at=?').run(replacement);
    }
    return prepare(sql);
  }};
  const response=await h.request();assert.equal(response.status,200);
  assert.equal((await response.json()).fetchedAt,replacement);
  assert.equal(h.sqlite.prepare('SELECT lease_until FROM sealed_catalogue').get().lease_until,'');
});
