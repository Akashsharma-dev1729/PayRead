import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const sql = readFileSync('supabase/schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', '');
const article = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const token = '20000000-0000-4000-8000-000000000001';
const admin = '30000000-0000-4000-8000-000000000001';
const user = '30000000-0000-4000-8000-000000000002';
test('SQL migration, actual PostgreSQL permissions and purchase lifecycle', async t => {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon, authenticated;
 grant execute on function auth.uid() to anon,authenticated;`);
 await db.exec(sql);
 await db.exec(sql); // migration is re-runnable
 await db.exec(`insert into auth.users values ('${admin}'),('${user}'); insert into public.admin_users(user_id) values ('${admin}');
 insert into public.articles(id,title,content,price_paise,published) values ('${article}','Paid','SECRET',100,true),('${other}','Draft','DRAFT SECRET',200,false);`);
 await t.test('anonymous cannot read content or payment tokens directly', async () => {
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.articles'), /permission denied/);
  await assert.rejects(db.query('select * from public.payments'), /permission denied/);
  const previews = await db.query<Record<string,unknown>>('select * from public.list_published_articles()');
  assert.equal(previews.rows.length,1); assert.equal('content' in previews.rows[0],false);
 });
 let paymentId: string;
 await t.test('creation is idempotent and database-priced, conflicting identities rejected', async () => {
  const create = () => db.query<{id:string}>(`select public.create_payment('${article}','PR1234567890','${token}') as id`);
  paymentId = (await create()).rows[0].id;
  assert.equal((await create()).rows[0].id,paymentId);
  assert.equal((await db.query<{amount_paise:number}>(`select * from get_payment_details('${token}')`)).rows[0].amount_paise,100);
  await assert.rejects(db.query(`select create_payment('${other}','PR1234567890','${token}')`), /identity conflict/);
  await assert.rejects(db.query(`select create_payment('${other}','PR1234567891','20000000-0000-4000-8000-000000000002')`), /not available/);
  await assert.rejects(db.query(`select create_payment('${article}',null,'${token}')`), /Invalid/);
 });
 await t.test('pending and wrong-token requests cannot unlock content', async () => {
  assert.equal((await db.query(`select * from get_article_content('${article}','${token}')`)).rows.length,0);
  assert.equal((await db.query(`select * from get_article_content('${article}','20000000-0000-4000-8000-000000000099')`)).rows.length,0);
 });
 await t.test('ordinary signed-in account cannot approve or enumerate purchases', async () => {
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user}';`);
  assert.equal((await db.query('select * from payments')).rows.length,0);
  await assert.rejects(db.query(`select review_payment('${paymentId}','completed')`), /Admin access required/);
  await assert.rejects(db.query(`update payments set status='completed'`), /permission denied/);
 });
 await t.test('admin approval is atomic, server-timestamped, and does not repeat', async () => {
  await db.exec(`set request.jwt.claim.sub = '${admin}'`);
  assert.equal((await db.query<{ok:boolean}>(`select review_payment('${paymentId}','completed') as ok`)).rows[0].ok,true);
  assert.equal((await db.query<{ok:boolean}>(`select review_payment('${paymentId}','failed') as ok`)).rows[0].ok,false);
  assert.ok((await db.query<{completed_at:unknown}>('select completed_at from payments')).rows[0].completed_at);
 });
 await t.test('completed token unlocks only its article', async () => {
  await db.exec('reset role; set role anon');
  assert.equal((await db.query<{content:string}>(`select * from get_article_content('${article}','${token}')`)).rows[0].content,'SECRET');
  assert.equal((await db.query(`select * from get_article_content('${other}','${token}')`)).rows.length,0);
 });
 await t.test('unknown legacy permissive policies are removed on upgrade', async () => {
  await db.exec('reset role; create policy legacy_leak on articles for select to authenticated using (true); grant select(content) on articles to anon;');
  await db.exec(sql);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}'`);
  assert.equal((await db.query('select * from articles')).rows.length,0);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select content from articles'), /permission denied/);
 });
 await db.close();
});
