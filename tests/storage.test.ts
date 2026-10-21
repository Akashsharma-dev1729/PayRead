import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, paymentSession, pendingToken, restartPaymentSession } from '../lib/storage';
import { saveAccess, normalizeUtr } from '../lib/payment';
const memory = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v)}});
test('pending identity survives reopening',()=>{
 const a=paymentSession('article');assert.deepEqual(paymentSession('article'),a);
 assert.notEqual(paymentSession('other').token,a.token);
});
test('a rejected purchase can be replaced; pending token is readable for recovery',()=>{
 const a=paymentSession('restart');assert.equal(pendingToken('restart'),a.token);
 const b=restartPaymentSession('restart');assert.notEqual(b.token,a.token);assert.notEqual(b.ref,a.ref);
 assert.deepEqual(paymentSession('restart'),b);assert.equal(pendingToken('nothing'),null);
});
test('UPI transaction IDs are normalised and validated',()=>{
 assert.equal(normalizeUtr('4123 4567-8901'),'412345678901');
 for(const bad of ['','12345','1234567890123','41234567890a']) assert.equal(normalizeUtr(bad),null);
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
 const env=process.env as Record<string,string|undefined>;const saved=env.NODE_ENV;
 env.NODE_ENV='development';assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321'),true);
 env.NODE_ENV='production';assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321'),false);assert.equal(isValidSupabaseUrl('http://example.supabase.co'),false);
 env.NODE_ENV=saved;
 assert.equal(isValidSupabaseUrl('https://example.supabase.co'),true);
 for(const value of ['https://example.supabase.co/rest/v1','https://example.supabase.co?x=1','https://user:pass@example.supabase.co','https://example.supabase.co.evil.test']) assert.equal(isValidSupabaseUrl(value),false);
});
