import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync,readdirSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('distinct sealed queries have bounded real D1 row cost, including a cold index and empty pages',async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const temp=mkdtempSync(join(tmpdir(),'monstertrade-runtime-'));
  const source=`import { handleRequest } from ${JSON.stringify(root+'worker/index.js')};
    export default {async fetch(request,env,ctx){
      const stats=[];
      const db={prepare(sql){const wrap=stmt=>({inner:stmt,bind(...args){return wrap(stmt.bind(...args));},async first(){const r=await stmt.all();stats.push(r.meta);return r.results[0]||null;},async all(){const r=await stmt.all();stats.push(r.meta);return r;},async run(){const r=await stmt.run();stats.push(r.meta);return r;}});return wrap(env.PRICES_DB.prepare(sql));},async batch(stmts){const r=await env.PRICES_DB.batch(stmts.map(s=>s.inner));r.forEach(x=>stats.push(x.meta));return r;}};
      const response=await handleRequest(request,{...env,PRICES_DB:db},ctx,{now:()=>Date.parse('2026-11-23T12:00:00Z'),fetch:async url=>{if(url!=='https://tcgprices.app/data/sealed-prices.csv')throw Error('Unexpected provider');return new Response(env.FEED);}});
      const headers=new Headers(response.headers);headers.set('x-test-rows',String(stats.reduce((n,m)=>n+m.rows_read,0)));
      return new Response(response.body,{status:response.status,headers});
    }};`;
  const bundle=await build({stdin:{contents:source,resolveDir:root,sourcefile:'runtime-test.js'},bundle:true,format:'esm',platform:'browser',write:false});
  const feed='tcgplayer_product_id,game,set,product,product_type,market,currency,cheapest_store_price,stores_in_stock,url,date\n'+
    Array.from({length:1200},(_,i)=>`${i+1},Pokémon,Set,Box ${'x'.repeat(252)}${String(i).padStart(4,'0')},Collection,EU,EUR,12,1,https://tcgprices.app/card/test-${i},2026-11-23`).join('\n')+'\n';
  let outbound=0;
  const options=convertV4MiniflareOptions({port:0,host:'127.0.0.1',cf:false,workers:[{name:'row-cost-test',script:bundle.outputFiles[0].text,modules:true,compatibilityDate:'2026-11-23',d1Databases:['PRICES_DB'],bindings:{FEED:feed},outboundService:()=>{outbound++;throw Error('Network forbidden');}}]});
  Object.assign(options,{resourceTmpPath:join(temp,'tmp'),resourcePersistencePath:join(temp,'data'),enableDevRegistry:false,telemetry:{enabled:false}});
  const mf=new Miniflare(options);
  t.after(async()=>{await mf.dispose();rmSync(temp,{recursive:true,force:true});});
  const db=await mf.getD1Database('PRICES_DB');
  for(const file of readdirSync(root+'migrations').filter(name=>name.endsWith('.sql')).sort()){
    for(const sql of readFileSync(root+'migrations/'+file,'utf8').split(';').map(text=>text.trim()).filter(Boolean))await db.prepare(sql).run();
  }
  const populated=await mf.dispatchFetch('https://local.test/api/sealed');
  assert.equal(populated.status,200,await populated.clone().text());assert.equal((await populated.json()).total,1200);
  const measured=[];
  for(const path of ['/api/sealed','/api/sealed?q=Box','/api/sealed?page=9999','/api/sealed?type=booster-box',...Array.from({length:20},(_,i)=>'/api/sealed?q=unique-miss-'+i)]){
    const response=await mf.dispatchFetch('https://local.test'+path);
    assert.equal(response.status,200,path);
    const value=await response.json(),rows=Number(response.headers.get('x-test-rows'));
    assert.ok(rows<=80,`${path} read ${rows} rows for ${value.items.length} results`);
    if(value.items.length===0)assert.ok(rows<=3,`${path} scanned products despite an empty selection`);
    measured.push({path,rows,returned:value.items.length});
  }
  const plan=await db.prepare(`EXPLAIN QUERY PLAN SELECT product.* FROM json_each(?1) AS selected CROSS JOIN sealed_products AS product ON product.product_id=selected.value WHERE product.seen_at=?2`).bind('["sealed-tcgp-1-eu"]','2026-11-23T12:00:00.000Z').all();
  assert.ok(plan.results.some(row=>/SEARCH product USING INDEX sqlite_autoindex_sealed_products_1/.test(row.detail)),JSON.stringify(plan.results));
  assert.equal(outbound,0);
  t.diagnostic(JSON.stringify({products:1200,measurements:measured,queryPlan:plan.results}));
});
