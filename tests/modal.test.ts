import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

test('payment dialog Strict Mode, authoritative amount, reopen, keyboard and completed purchase', {timeout:15000}, async () => {
 const dom = new JSDOM('<html><body><button id="origin">Buy</button></body></html>',{url:'https://payread.test'});
 for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-public-key';
 process.env.NEXT_PUBLIC_UPI_ID='test@upi';
 const {supabase} = await import('../lib/supabase');
 const {default:Modal}=await import('../components/PayModal');
 const {render,waitFor,fireEvent,cleanup}=await import('@testing-library/react');
 const article={id:'10000000-0000-4000-8000-000000000001',title:'Article',excerpt:'',price_paise:999,published:true};
 const calls: {name:string;args:Record<string,string>}[]=[];
 let state='pending';let ref='';let unlocks=0;let closes=0;
 Object.defineProperty(supabase,'rpc',{value:async(name:string,args:Record<string,string>)=>{
  calls.push({name,args});
  if(name==='create_payment'){ref=args.p_transaction_ref;return {data:'payment-id',error:null};}
  if(name==='get_payment_details')return {data:[{article_id:article.id,amount_paise:100,transaction_ref:ref,status:state}],error:null};
  return {data:state,error:null};
 }});
 const view=()=>React.createElement(React.StrictMode,null,React.createElement(Modal,{article,onClose:()=>{closes++},onUnlocked:()=>{unlocks++}}));
 (document.getElementById('origin') as HTMLElement).focus();
 let rendered=render(view());
 await waitFor(()=>assert.ok(rendered.getByRole('link',{name:'Pay with UPI'})));
 const href=rendered.getByRole('link',{name:'Pay with UPI'}).getAttribute('href')!;
 assert.equal(new URL(href).searchParams.get('am'),'1.00');
 const requests=calls.filter(x=>x.name==='create_payment');assert.equal(requests.length,2);
 assert.deepEqual(requests[0].args,requests[1].args);
 fireEvent.keyDown(document,{key:'Escape'});assert.equal(closes,1);
 rendered.unmount();assert.equal(document.activeElement?.id,'origin');
 state='completed';rendered=render(view());
 await waitFor(()=>assert.equal(unlocks,1));
 const tokens=calls.filter(x=>x.name==='create_payment').map(x=>x.args.p_access_token);
 assert.equal(new Set(tokens).size,1);
 assert.equal(JSON.parse(localStorage.getItem('payread_access')!)[article.id],tokens[0]);
 cleanup();supabase!.auth.stopAutoRefresh();
 (supabase!.auth as unknown as { broadcastChannel?: BroadcastChannel }).broadcastChannel?.close();
 dom.window.close();
});
