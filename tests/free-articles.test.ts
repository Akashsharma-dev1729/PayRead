import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const schema = readFileSync('supabase/schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', '');
const migration = readFileSync('supabase/migrations/202610110001_free_articles.sql', 'utf8');
const paid = '10000000-0000-4000-8000-000000000001';
const extra = '10000000-0000-4000-8000-000000000002';
const draft = '10000000-0000-4000-8000-000000000003';
const free = '71000000-0000-4000-8000-000000000001';
const token = '20000000-0000-4000-8000-000000000001';
async function database() {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;`);
 await db.exec(schema);
 return db;
}
test('deployed catalog upgrade: free access, one ₹100 article, old purchases preserved, rerun safe', async () => {
 const db = await database();
 try {
 await db.exec(`alter table articles drop constraint articles_price_paise_check;
 alter table articles add constraint articles_price_paise_check check(price_paise>0);
 insert into articles(id,title,content,price_paise,published,created_at) values
 ('${paid}','Existing paid','PAID SECRET',100,true,'2025-01-01'),
 ('${extra}','Another article','PUBLIC NOW',100,true,'2025-01-02'),
 ('${draft}','Draft','DRAFT SECRET',200,false,'2024-01-01');
 insert into payments(article_id,amount_paise,status,transaction_ref,access_token)
 values('${paid}',100,'completed','PR1234567890','${token}');`);
 await db.exec(migration);
 await db.exec(migration);
 const prices = await db.query<{id:string;price_paise:number}>('select id,price_paise from articles where published');
 assert.equal(prices.rows.length,7);
 assert.deepEqual(prices.rows.filter(a=>a.price_paise>0),[{id:paid,price_paise:10000}]);
 assert.equal((await db.query<{amount_paise:number}>('select amount_paise from payments')).rows[0].amount_paise,100);
 await db.exec('set role anon');
 assert.equal((await db.query(`select * from get_article_content('${free}',null)`)).rows.length,1);
 assert.equal((await db.query(`select * from get_article_content('${paid}',null)`)).rows.length,0);
 assert.equal((await db.query(`select * from get_article_content('${paid}','${token}')`)).rows.length,1);
 assert.equal((await db.query(`select * from get_article_content('${draft}',null)`)).rows.length,0);
 await assert.rejects(db.query('select content from articles'),/permission denied/);
 await assert.rejects(db.query(`select create_payment('${free}','PR1234567899','20000000-0000-4000-8000-000000000009')`),/not available/);
 await db.exec('reset role; set role service_role');
 const order=await db.query<{amount_paise:number}>(`select * from begin_razorpay_payment('${paid}','PR1234567898','20000000-0000-4000-8000-000000000008','rzp_test_123')`);
 assert.equal(order.rows[0].amount_paise,10000);
 } finally { await db.close(); }
});
test('empty catalog gets exactly five free articles and one ₹100 article, without duplicates',async()=>{
 const db=await database();
 try {
 await db.exec(migration); await db.exec(migration);
 const result=await db.query<{price_paise:number}>('select price_paise from articles where published');
 assert.equal(result.rows.length,6);
 assert.equal(result.rows.filter(a=>a.price_paise===0).length,5);
 assert.equal(result.rows.filter(a=>a.price_paise===10000).length,1);
 await assert.rejects(db.exec(`insert into articles(title,content,price_paise) values('bad','bad',-1)`),/check constraint/);
 }finally{await db.close();}
});
