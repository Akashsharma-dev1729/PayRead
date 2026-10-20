import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

test('admin loads automatically, detects review conflict, and discards role check after signout', {timeout:15000}, async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://payread.test'});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-public-key';
 const {supabase}=await import('../lib/supabase');
 const {default:Admin}=await import('../app/admin/page');
 const {render,waitFor,fireEvent,act,cleanup}=await import('@testing-library/react');
 const session={user:{id:'admin'},access_token:'test'};
 let callback: (event:string, session:unknown)=>void=()=>{};
 let resolveRole: ((value:unknown)=>void)|undefined;
 let slow=false; const reviews:unknown[]=[]; const filters:unknown[][]=[];
 Object.defineProperty(supabase!.auth,'getSession',{value:async()=>({data:{session},error:null})});
 Object.defineProperty(supabase!.auth,'onAuthStateChange',{value:(fn:typeof callback)=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}}}});
 Object.defineProperty(supabase,'rpc',{value:async(name:string,args:unknown)=>{
  if(name==='is_admin')return slow ? new Promise(resolve=>{resolveRole=resolve}) : {data:true,error:null};
  reviews.push(args);return {data:false,error:null};
 }});
 Object.defineProperty(supabase,'from',{value:(table:string)=>({select:()=> table==='payments'?{eq:()=>({eq:()=>({not:(column:string,op:string,value:unknown)=>{filters.push([column,op,value]);return {order:async()=>({data:[{id:'p1',article_id:'a1',amount_paise:100,transaction_ref:'PR123',status:'pending',payer_utr:'412345678901',claimed_at:'2026-10-20T08:00:00Z'}],error:null})};}})})}:{in:async()=>({data:[{id:'a1',title:'Paid article'}],error:null})}})});
 const view=render(React.createElement(Admin));
 await waitFor(()=>assert.ok(view.getByText('Paid article')));
 // Only claimed purchases are queued, and the admin sees the UTR to match.
 assert.deepEqual(filters,[['payer_utr','is',null]]);
 assert.ok(view.getByText('412345678901'));
 fireEvent.click(view.getByText('Approve'));
 await waitFor(()=>assert.ok(view.getByText(/already reviewed/)));
 assert.deepEqual(reviews,[{p_payment_id:'p1',p_status:'completed'}]);
 slow=true;
 await act(async()=>callback('TOKEN_REFRESHED',{...session}));
 await waitFor(()=>assert.ok(resolveRole));
 await act(async()=>callback('SIGNED_OUT',null));
 await act(async()=>resolveRole!({data:true,error:null}));
 assert.equal(view.queryByText('Pending payments'),null);
 assert.ok(view.getByText('Sign in'));
 cleanup();supabase!.auth.stopAutoRefresh();
 (supabase!.auth as unknown as {broadcastChannel?:BroadcastChannel}).broadcastChannel?.close();dom.window.close();
});
