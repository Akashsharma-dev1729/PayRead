import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createOrder,verifyPayment,processWebhook} from '../lib/server/payment-service';
import {validSignature} from '../lib/server/razorpay';

const article='10000000-0000-4000-8000-000000000001';
const token='20000000-0000-4000-8000-000000000001';
const sign=(body:string,secret='test-secret')=>createHmac('sha256',secret).update(body).digest('hex');

test('Razorpay service with real SQL and a simulated gateway',async t=>{
 process.env.RAZORPAY_KEY_ID='rzp_test_1234';process.env.RAZORPAY_KEY_SECRET='test-secret';process.env.RAZORPAY_WEBHOOK_SECRET='webhook-secret';
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to anon,authenticated,service_role;`);
 await db.exec(readFileSync('supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`insert into articles(id,title,content,price_paise,published) values('${article}','Test article','Paid content',100,true)`);
 // Translate the small Supabase API surface used by production into real SQL.
 const adapter={
  rpc:async(name:string,args:Record<string,unknown>)=>{
   try {const keys=Object.keys(args);const r=await db.query<Record<string,unknown>>(`select * from public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')})`,Object.values(args));
    return {data:name==='begin_razorpay_payment'?r.rows:r.rows[0]?.[name],error:null};
   }catch(error){return {data:null,error};}
  },
  from:(table:string)=>{
   let columns='*';let update:Record<string,unknown>|null=null;const filters:[string,unknown][]=[];
   const query={select:(c:string)=>{columns=c;return query;},update:(v:Record<string,unknown>)=>{update=v;return query;},eq:(k:string,v:unknown)=>{filters.push([k,v]);return query;},is:(k:string,v:unknown)=>{filters.push([k,v]);return query;},single:()=>run(false),maybeSingle:()=>run(true)};
   async function run(optional:boolean){try{
    const values:unknown[]=[];let sql='';
    if(update){sql=`update ${table} set `+Object.entries(update).map(([k,v])=>{values.push(v);return `${k}=$${values.length}`}).join(',');}else sql=`select ${columns} from ${table}`;
    sql+=' where '+filters.map(([k,v])=>{if(v===null)return `${k} is null`;values.push(v);return `${k}=$${values.length}`}).join(' and ');
    if(update)sql+=` returning ${columns}`;
    const result=await db.query(sql,values);
    if(!optional&&result.rows.length!==1)throw Error('Expected one row');
    return {data:result.rows[0]||null,error:null};
   }catch(error){return {data:null,error};}}
   return query;
  }
 } as unknown as SupabaseClient;
 const originalFetch=globalThis.fetch;let created=0;let failOrders=false;
 let payment:Record<string,unknown>={id:'pay_123',order_id:'order_1',amount:100,currency:'INR',status:'captured',captured:true,amount_refunded:0};
 globalThis.fetch=async(input,init)=>{
  const path=String(input);
  if(path.endsWith('/orders')){created++;if(failOrders)throw Error('timeout');const body=JSON.parse(init?.body as string);assert.equal(body.amount,100);assert.equal(body.partial_payment,false);return Response.json({id:`order_${created}`,amount:100,currency:'INR'});}
  return Response.json(payment);
 };
 const body={articleId:article,token,ref:'PR1234567890',amount:1};
 const verify={token,orderId:'order_1',paymentId:'pay_123',signature:sign('order_1|pay_123')};
 const status=async()=> (await db.query<{status:string}>(`select status from payments where access_token='${token}'`)).rows[0].status;
 try{
 await t.test('server price wins and retries reuse the saved order',async()=>{
  const first=await createOrder(adapter,body);assert.equal(first.amount,100);assert.equal(first.orderId,'order_1');
  assert.equal((await createOrder(adapter,body)).orderId,'order_1');assert.equal(created,1);
 });
 await t.test('anonymous cannot create/complete/revoke gateway records directly',async()=>{
  await db.exec('set role anon');
  await assert.rejects(db.query(`select complete_razorpay_payment('order_1','pay_123',100,'INR')`),/permission denied/);
  await assert.rejects(db.query(`select begin_razorpay_payment('${article}','PR1234567890','${token}','rzp_test_1234')`),/permission denied/);
  await assert.rejects(db.query(`select revoke_razorpay_payment('order_1','pay_123')`),/permission denied/);
  await assert.rejects(db.query('select * from razorpay_orders'),/permission denied/);await db.exec('reset role');
 });
 await t.test('manual admin cannot approve gateway purchases',async()=>{
  const admin='30000000-0000-4000-8000-000000000001';await db.exec(`insert into auth.users values('${admin}');insert into admin_users(user_id) values('${admin}');set request.jwt.claim.sub='${admin}';`);
  const result=await db.query<{ok:boolean}>(`select review_payment((select id from payments where access_token='${token}'),'completed') as ok`);
  assert.equal(result.rows[0].ok,false);assert.equal(await status(),'pending');
 });
 await t.test('forged signature and substituted order do not grant access',async()=>{
  await assert.rejects(verifyPayment(adapter,{...verify,signature:'0'.repeat(64)}),/signature/);
  await assert.rejects(verifyPayment(adapter,{...verify,orderId:'order_else'}),/signature/);assert.equal(await status(),'pending');
 });
 await t.test('authorized-only and wrong-amount payments do not unlock',async()=>{
  payment.status='authorized';payment.captured=false;await assert.rejects(verifyPayment(adapter,verify),/awaiting capture/);
  payment.status='captured';payment.captured=true;payment.amount=1;await assert.rejects(verifyPayment(adapter,verify),/does not match/);
  payment.amount=100;assert.equal(await status(),'pending');
 });
 await t.test('captured verified payment unlocks exactly once',async()=>{
  assert.deepEqual(await verifyPayment(adapter,verify),{completed:true});
  assert.deepEqual(await verifyPayment(adapter,verify),{completed:true});
  assert.equal(await status(),'completed');
  const rows=await db.query<{content:string}>(`select * from get_article_content('${article}','${token}')`);assert.equal(rows.rows[0].content,'Paid content');
 });
 const raw=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_123'}}}});
 await t.test('invalid or mutated raw webhook is rejected',async()=>{
  await assert.rejects(processWebhook(adapter,raw,'invalid'),/signature/);
  await assert.rejects(processWebhook(adapter,raw+' ',sign(raw,'webhook-secret')),/signature/);
 });
 await t.test('duplicate webhook delivery is idempotent',async()=>{
  await processWebhook(adapter,raw,sign(raw,'webhook-secret'));await processWebhook(adapter,raw,sign(raw,'webhook-secret'));assert.equal(await status(),'completed');
 });
 await t.test('refund revokes access; late captured delivery cannot restore it',async()=>{
  payment.amount_refunded=100;payment.status='refunded';
  const refund=JSON.stringify({event:'refund.processed',payload:{refund:{entity:{payment_id:'pay_123'}}}});
  await processWebhook(adapter,refund,sign(refund,'webhook-secret'));
  await processWebhook(adapter,raw,sign(raw,'webhook-secret'));assert.equal(await status(),'failed');
  assert.equal((await db.query(`select * from get_article_content('${article}','${token}')`)).rows.length,0);
 });
 await t.test('webhook confirms a second purchase even without browser callback',async()=>{
  const other='20000000-0000-4000-8000-000000000002';await createOrder(adapter,{...body,token:other,ref:'PR1234567891'});
  payment={id:'pay_234',order_id:'order_2',amount:100,currency:'INR',status:'captured',captured:true,amount_refunded:0};
  const raw2=JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_234'}}}});
  await processWebhook(adapter,raw2,sign(raw2,'webhook-secret'));
  assert.equal((await db.query(`select * from get_article_content('${article}','${other}')`)).rows.length,1);
 });
 await t.test('uncertain order creation never blindly creates a second order',async()=>{
  failOrders=true;const pending={...body,token:'20000000-0000-4000-8000-000000000003',ref:'PR1234567892'};
  await assert.rejects(createOrder(adapter,pending),/could not be reached/);const count=created;
  await assert.rejects(createOrder(adapter,pending),/being prepared/);assert.equal(created,count);
 });
 await t.test('signature validation rejects missing and malformed values',()=>{
  assert.equal(validSignature('x',null,'s'),false);assert.equal(validSignature('x','aa','s'),false);assert.equal(validSignature('x',sign('x'),'test-secret'),true);
 });
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
