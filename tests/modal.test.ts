import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

test('payment dialog Strict Mode, authoritative amount, UPI link, UTR claim, reopen, keyboard, completed and rejected purchase', {timeout:20000}, async () => {
 const dom = new JSDOM('<html><body><button id="origin">Buy</button></body></html>',{url:'https://payread.test'});
 for (const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true})) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-public-key';
 process.env.NEXT_PUBLIC_UPI_ID='test@upi';
 process.env.NEXT_PUBLIC_MERCHANT_NAME='Pay Read';
 const {supabase} = await import('../lib/supabase');
 const {default:Modal}=await import('../components/ManualPayModal');
 const {render,waitFor,fireEvent,cleanup}=await import('@testing-library/react');
 const article={id:'10000000-0000-4000-8000-000000000001',title:'Article',excerpt:'',price_paise:999,published:true};
 const calls: {name:string;args:Record<string,string>}[]=[];
 let state='pending';let ref='';let unlocks=0;let closes=0;let utr:string|null=null;
 Object.defineProperty(supabase,'rpc',{value:async(name:string,args:Record<string,string>)=>{
  calls.push({name,args});
  if(name==='create_payment'){ref=args.p_transaction_ref;return {data:'payment-id',error:null};}
  if(name==='get_payment_details')return {data:[{article_id:article.id,amount_paise:100,transaction_ref:ref,status:state,payer_utr:utr,claimed_at:utr?'2026-10-20T08:00:00Z':null}],error:null};
  if(name==='submit_payment_utr'){utr=args.p_utr;return {data:state,error:null};}
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
 // UPI apps decode values as URIs: spaces must be %20, never '+'. The payee-visible
 // note carries the reference; the merchant-only tr field is not sent.
 assert.match(href,/^upi:\/\/pay\?pa=test@upi&pn=Pay%20Read&/);
 assert.equal(href.includes('+'),false);
 assert.equal(new URL(href).searchParams.get('tn'),`PayRead ${ref}`);
 assert.equal(new URL(href).searchParams.has('tr'),false);
 // Buyer reports the UTR; a malformed one is refused before any request.
 const input=rendered.getByLabelText(/12-digit UPI transaction ID/) as HTMLInputElement;
 fireEvent.change(input,{target:{value:'12345'}});fireEvent.click(rendered.getByRole('button',{name:"I've paid"}));
 await waitFor(()=>assert.ok(rendered.getByText(/Enter the 12-digit/)));
 assert.equal(calls.some(x=>x.name==='submit_payment_utr'),false);
 fireEvent.change(input,{target:{value:'4123 4567 8901'}});fireEvent.click(rendered.getByRole('button',{name:"I've paid"}));
 await waitFor(()=>assert.ok(rendered.getByText('412345678901')));
 assert.deepEqual(calls.find(x=>x.name==='submit_payment_utr')!.args,{p_access_token:requests[0].args.p_access_token,p_utr:'412345678901'});
 assert.equal(rendered.queryByRole('link',{name:'Pay with UPI'}),null);
 fireEvent.keyDown(document,{key:'Escape'});assert.equal(closes,1);
 rendered.unmount();assert.equal(document.activeElement?.id,'origin');
 state='completed';rendered=render(view());
 await waitFor(()=>assert.equal(unlocks,1));
 const tokens=calls.filter(x=>x.name==='create_payment').map(x=>x.args.p_access_token);
 assert.equal(new Set(tokens).size,1);
 assert.equal(JSON.parse(localStorage.getItem('payread_access')!)[article.id],tokens[0]);
 rendered.unmount();
 // A rejected purchase is not a dead end: the buyer can start a fresh one.
 state='failed';rendered=render(view());
 await waitFor(()=>assert.ok(rendered.getByRole('button',{name:'Start a new payment'})));
 assert.ok(rendered.getByText(/412345678901/));
 state='pending';utr=null;
 fireEvent.click(rendered.getByRole('button',{name:'Start a new payment'}));
 await waitFor(()=>assert.ok(rendered.getByRole('link',{name:'Pay with UPI'})));
 const fresh=calls.filter(x=>x.name==='create_payment').at(-1)!.args;
 assert.notEqual(fresh.p_access_token,tokens[0]);assert.notEqual(fresh.p_transaction_ref,requests[0].args.p_transaction_ref);
 assert.equal(JSON.parse(localStorage.getItem('payread_pending')!)[article.id].token,fresh.p_access_token);
 cleanup();supabase!.auth.stopAutoRefresh();
 (supabase!.auth as unknown as { broadcastChannel?: BroadcastChannel }).broadcastChannel?.close();
 dom.window.close();
});
