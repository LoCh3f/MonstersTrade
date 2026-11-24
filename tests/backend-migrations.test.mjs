import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
test('security migrations preserve confirmed prices/history and backfill a usable current sealed index',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  for(const name of ['0001_public_prices.sql','0002_active_price_catalogue.sql','0003_sealed_prices.sql'])db.exec(migration(name));
  db.prepare("INSERT INTO price_cards(card_id,payload,created_at,last_requested_at,next_refresh_at) VALUES ('saved','{}','2020','2020','2020')").run();
  db.prepare("INSERT INTO price_history VALUES ('saved','generic','2020-01-01',12,'EUR','trend',1,'2020-01-01T00:00:00Z','2020-01-01T01:00:00Z','generic')").run();
  const insert=db.prepare("INSERT INTO price_cards(card_id,created_at,last_requested_at,next_refresh_at) VALUES (?,'2020','2020','2020')");
  for(let i=0;i<510;i++)insert.run('negative-'+i);
  db.prepare("UPDATE sealed_feed SET fetched_at='2026-11-23T00:00:00Z'").run();
  db.prepare("INSERT INTO sealed_products VALUES ('sealed-tcgp-1-eu','Box','box set','collection-box','{}','2026-11-23','2026-11-23T00:00:00Z')").run();
  const before={card:db.prepare("SELECT * FROM price_cards WHERE card_id='saved'").get(),history:db.prepare('SELECT * FROM price_history').all(),product:db.prepare('SELECT * FROM sealed_products').all()};
  db.exec(migration('0004_price_admission.sql'));db.exec(migration('0005_sealed_catalogue_snapshot.sql'));
  assert.deepEqual(db.prepare("SELECT * FROM price_cards WHERE card_id='saved'").get(),before.card);
  assert.deepEqual(db.prepare('SELECT * FROM price_history').all(),before.history);
  assert.deepEqual(db.prepare('SELECT * FROM sealed_products').all(),before.product);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM price_cards WHERE payload IS NULL').get().n,256);
  const snapshot=db.prepare('SELECT * FROM sealed_catalogue').get();
  assert.equal(snapshot.fetched_at,'2026-11-23T00:00:00Z');
  assert.deepEqual(JSON.parse(snapshot.payload),[['sealed-tcgp-1-eu','box set','collection-box']]);
  assert.throws(()=>db.prepare('UPDATE sealed_catalogue SET payload=?').run(JSON.stringify(['😀'.repeat(500000)])),/CHECK constraint/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
