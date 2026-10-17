import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, paymentSession } from '../lib/storage';
import { saveAccess } from '../lib/payment';
const memory = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v)}});
test('pending identity survives reopening',()=>{
 const a=paymentSession('article');assert.deepEqual(paymentSession('article'),a);
 assert.notEqual(paymentSession('other').token,a.token);
});
test('access readers tolerate corrupt and malformed storage',()=>{
 for(const value of ['null','[]','oops','{"article":123}']) {memory.set('payread_access',value);assert.equal(accessToken('article'),null);}
});
test('confirmed access is recoverable',()=>{
 const token=crypto.randomUUID();saveAccess('article',token);assert.equal(accessToken('article'),token);
});
test('blocked storage stops checkout before any payment can be made',()=>{
 Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}}});
 assert.equal(accessToken('article'),null);
 assert.throws(()=>paymentSession('article'),/Enable site storage/);
});

test('Supabase URL must be a project origin, never a REST path', async()=>{
 const {isValidSupabaseUrl}=await import('../lib/supabase');
 assert.equal(isValidSupabaseUrl('https://example.supabase.co'),true);
 for(const value of ['https://example.supabase.co/rest/v1','https://example.supabase.co?x=1','https://user:pass@example.supabase.co','https://example.supabase.co.evil.test']) assert.equal(isValidSupabaseUrl(value),false);
});

test('PaymentSessionStore supports injected storage and deterministic identities', async () => {
  const { PaymentSessionStore } = await import('../lib/storage');
  const records = new Map<string, string>();
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const store = new PaymentSessionStore({
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => { records.set(key, value); },
  }, () => ids.shift()!);
  const session = store.paymentSession('article-1');
  assert.equal(session.token, '11111111-1111-4111-8111-111111111111');
  assert.equal(session.ref, 'PR22222222222242228222222222222222');
  assert.deepEqual(store.paymentSession('article-1'), session);
  store.persist('payread_access', 'article-1', session.token);
  assert.equal(store.accessToken('article-1'), session.token);
  store.persist('payread_access', 'article-1', 'not-a-token');
  assert.equal(store.accessToken('article-1'), null);
});

test('PaymentSessionStore surfaces storage write failures', async () => {
  const { PaymentSessionStore } = await import('../lib/storage');
  const store = new PaymentSessionStore({
    getItem: () => null,
    setItem: () => { throw new Error('storage blocked'); },
  });
  assert.throws(() => store.persist('payread_access', 'article', 'token'), /Enable site storage/);
});
