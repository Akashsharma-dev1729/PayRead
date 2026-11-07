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
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
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
 await t.test('UPI: approval needs the buyer\'s transaction ID; bad IDs and other tokens are refused', async () => {
  await db.exec(`set request.jwt.claim.sub = '${admin}'`);
  await assert.rejects(db.query(`select review_payment('${paymentId}','completed')`), /not submitted a UPI transaction ID/);
  await db.exec('reset role; set role anon');
  for (const bad of ['12345', '1234567890123', 'ABCDEFGHIJKL', '']) await assert.rejects(db.query(`select submit_payment_utr('${token}','${bad}')`), /12-digit/);
  await assert.rejects(db.query(`select submit_payment_utr('20000000-0000-4000-8000-000000000099','412345678901')`), /Payment not found/);
  // Mistype, then correct while still pending.
  assert.equal((await db.query<{s:string}>(`select submit_payment_utr('${token}','412345678900') as s`)).rows[0].s,'pending');
  assert.equal((await db.query<{s:string}>(`select submit_payment_utr('${token}','412345678901') as s`)).rows[0].s,'pending');
  const d = (await db.query<{payer_utr:string;claimed_at:unknown}>(`select * from get_payment_details('${token}')`)).rows[0];
  assert.equal(d.payer_utr,'412345678901'); assert.ok(d.claimed_at);
 });
 await t.test('UPI: one transfer cannot back two purchases until the first claim is rejected', async () => {
  await db.exec('reset role; set role anon');
  const t2 = '20000000-0000-4000-8000-000000000002', t3 = '20000000-0000-4000-8000-000000000003';
  await db.query(`select create_payment('${article}','PR2234567890','${t2}')`);
  await db.query(`select create_payment('${article}','PR3234567890','${t3}')`);
  await assert.rejects(db.query(`select submit_payment_utr('${t2}','412345678901')`), /already attached to another purchase/);
  await db.query(`select submit_payment_utr('${t2}','512345678901')`);
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${admin}'`);
  assert.equal((await db.query<{ok:boolean}>(`select review_payment((select id from payments where access_token='${t2}'),'failed') as ok`)).rows[0].ok,true);
  await db.exec('reset role; set role anon');
  // Rejected claim frees its UTR for the genuine payer; a rejected purchase can no longer be claimed.
  assert.equal((await db.query<{s:string}>(`select submit_payment_utr('${t3}','512345678901') as s`)).rows[0].s,'pending');
  assert.equal((await db.query<{s:string}>(`select submit_payment_utr('${t2}','612345678901') as s`)).rows[0].s,'failed');
  assert.equal((await db.query<{payer_utr:string}>(`select payer_utr from get_payment_details('${t2}')`)).rows[0].payer_utr,'512345678901');
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${admin}'`);
  assert.equal((await db.query<{ok:boolean}>(`select review_payment((select id from payments where access_token='${t3}'),'failed') as ok`)).rows[0].ok,true);
 });
 await t.test('admin approval is atomic, server-timestamped, and does not repeat', async () => {
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${admin}'`);
  assert.equal((await db.query<{ok:boolean}>(`select review_payment('${paymentId}','completed') as ok`)).rows[0].ok,true);
  assert.equal((await db.query<{ok:boolean}>(`select review_payment('${paymentId}','failed') as ok`)).rows[0].ok,false);
  assert.ok((await db.query<{completed_at:unknown}>(`select completed_at from payments where id='${paymentId}'`)).rows[0].completed_at);
 });
 await t.test('completed token unlocks only its article', async () => {
  await db.exec('reset role; set role anon');
  assert.equal((await db.query<{content:string}>(`select * from get_article_content('${article}','${token}')`)).rows[0].content,'SECRET');
  assert.equal((await db.query(`select * from get_article_content('${other}','${token}')`)).rows.length,0);
 });
 await t.test('accounts: profiles on sign-up, purchases claimed by token, content on any device', async () => {
  await db.exec('reset role');
  // Every Auth user (including ones created before the migration) has a reader profile.
  assert.equal((await db.query<{n:number}>('select count(*)::int n from profiles')).rows[0].n, 2);
  const stranger = '30000000-0000-4000-8000-000000000003';
  await db.exec(`insert into auth.users values ('${stranger}')`);
  assert.equal((await db.query<{role:string;display_name:string}>(`select role, display_name from profiles where id='${stranger}'`)).rows[0].role, 'reader');

  await db.exec('set role anon');
  await assert.rejects(db.query(`select claim_purchases(array['${token}'::uuid])`), /permission denied/);
  await assert.rejects(db.query('select * from my_purchases()'), /permission denied/);
  await assert.rejects(db.query('select * from profiles'), /permission denied/);

  // The buyer signs in on another device: no token there, so nothing opens yet.
  await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user}'`);
  assert.equal((await db.query(`select * from get_article_content('${article}', null)`)).rows.length, 0);
  assert.equal((await db.query<{n:number}>(`select claim_purchases(array['${token}'::uuid]) n`)).rows[0].n, 1);
  assert.equal((await db.query<{content:string}>(`select * from get_article_content('${article}', null)`)).rows[0].content, 'SECRET');
  const mine = await db.query<{article_title:string;status:string}>('select * from my_purchases()');
  assert.deepEqual(mine.rows.map(r => [r.article_title, r.status]), [['Paid', 'completed']]);
  // Unpaid dialogs (pending, no UPI transaction ID) are not listed as purchases.
  await db.query(`select create_payment('${article}','PR9234567890','20000000-0000-4000-8000-000000000009')`);
  await db.query(`select claim_purchases(array['20000000-0000-4000-8000-000000000009'::uuid])`);
  assert.equal((await db.query('select * from my_purchases()')).rows.length, 1);

  // A claimed purchase never moves to another account, and others see nothing.
  await db.exec(`set request.jwt.claim.sub = '${stranger}'`);
  assert.equal((await db.query<{n:number}>(`select claim_purchases(array['${token}'::uuid]) n`)).rows[0].n, 0);
  assert.equal((await db.query(`select * from get_article_content('${article}', null)`)).rows.length, 0);
  assert.equal((await db.query('select * from my_purchases()')).rows.length, 0);
  assert.equal((await db.query('select * from profiles')).rows.length, 1);

  // Profile edits are validated and can never change the role.
  await db.query(`select update_my_profile('  Daniel  ', 'Writes about focus.')`);
  const me = (await db.query<{display_name:string;role:string;bio:string;is_admin:boolean}>('select * from get_my_profile()')).rows[0];
  assert.deepEqual([me.display_name, me.role, me.bio, me.is_admin], ['Daniel', 'reader', 'Writes about focus.', false]);
  await assert.rejects(db.query(`select update_my_profile('   ')`), /1 to 60/);
  await assert.rejects(db.query(`update profiles set role = 'writer'`), /permission denied/);
  await assert.rejects(db.query(`select claim_purchases(array_fill('${token}'::uuid, array[101]))`), /Too many/);
  await db.exec('reset role');
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
