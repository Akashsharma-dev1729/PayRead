import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('deployed manual schema with free catalog upgrades to Razorpay without changing existing payments', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(readFileSync('supabase/migrations/202610010001_payread_repair.sql','utf8').replace('create extension if not exists pgcrypto;',''));
  await db.exec(readFileSync('supabase/migrations/202610110001_free_articles.sql','utf8'));
  const article = (await db.query<{id:string}>('select id from articles where price_paise=10000')).rows[0].id;
  await db.query(`insert into payments(article_id,amount_paise,status,transaction_ref,access_token) values($1,10000,'completed','PRUPGRADETEST',gen_random_uuid())`,[article]);
  const fields = 'id,article_id,amount_paise,status,transaction_ref,access_token,created_at,completed_at';
  const before = await db.query(`select ${fields} from payments`);
  const migration = readFileSync('supabase/migrations/202610020001_razorpay.sql','utf8');
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual((await db.query(`select ${fields} from payments`)).rows,before.rows);
  assert.equal((await db.query<{provider:string}>('select provider from payments')).rows[0].provider,'manual_upi');
  await db.exec('set role service_role');
  const result = await db.query<{amount_paise:number}>(`select * from begin_razorpay_payment($1,'PRUPGRADETEST2',gen_random_uuid(),'rzp_test_validation')`,[article]);
  assert.equal(result.rows[0].amount_paise,10000);
 } finally { await db.close(); }
});
