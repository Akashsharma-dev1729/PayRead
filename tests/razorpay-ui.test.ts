import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import type {CheckoutOptions} from '../lib/razorpay-checkout';

test('checkout cancellation and unverified callback never unlock; server-confirmed payment does', {timeout:15000},async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://payread.test'});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-key';
 const {supabase}=await import('../lib/supabase');
 const {default:Payment}=await import('../components/RazorpayPayment');
 const {render,waitFor,fireEvent,act,cleanup}=await import('@testing-library/react');
 let paymentStatus='pending';
 Object.defineProperty(supabase,'rpc',{value:async()=>({data:paymentStatus,error:null})});
 let options:CheckoutOptions|undefined;let opens=0;let closes=0;let unlocks=0;let verification=false;let active=false;
 window.Razorpay=class{constructor(o:CheckoutOptions){options=o;}open(){opens++;}close(){closes++;}on(){}};
 const original=globalThis.fetch;
 globalThis.fetch=async(input)=>String(input).endsWith('/order')?Response.json({orderId:'order_1',keyId:'rzp_test_123',amount:100,currency:'INR'}):verification?Response.json({completed:true}):Response.json({error:'Signature invalid'},{status:400});
 const article={id:'10000000-0000-4000-8000-000000000001',title:'Article',excerpt:'',price_paise:999,published:true};
 try{
 const view=render(React.createElement(Payment,{article,onUnlocked:()=>{unlocks++},onActive:(value:boolean)=>{active=value}}));
 fireEvent.click(view.getByText('Pay with Razorpay'));
 assert.equal(active,true,'parent dialog must be locked while order creation is in flight');
 await waitFor(()=>assert.equal(opens,1));assert.equal(options!.amount,100);assert.equal(options!.order_id,'order_1');
 await act(async()=>options!.modal.ondismiss());assert.equal(unlocks,0);assert.equal(localStorage.getItem('payread_access'),null);
 fireEvent.click(view.getByText('Pay with Razorpay'));await waitFor(()=>assert.equal(opens,2));
 await act(async()=>options!.handler({razorpay_order_id:'order_1',razorpay_payment_id:'pay_1',razorpay_signature:'forged'}));
 await waitFor(()=>assert.ok(view.getByText(/Signature invalid/)));assert.equal(unlocks,0);assert.equal(localStorage.getItem('payread_access'),null);
 verification=true;fireEvent.click(view.getByText('Pay with Razorpay'));await waitFor(()=>assert.equal(opens,3));
 await act(async()=>options!.handler({razorpay_order_id:'order_1',razorpay_payment_id:'pay_1',razorpay_signature:'verified-by-mock-server'}));
 await waitFor(()=>assert.equal(unlocks,1));assert.ok(JSON.parse(localStorage.getItem('payread_access')!)[article.id]);
 assert.ok(closes>0,'successful confirmation closes the gateway overlay');assert.equal(active,false);
 fireEvent.click(view.getByText('Pay with Razorpay'));assert.equal(opens,3,'completed checkout cannot be opened again');
 cleanup();
 let finishOrder:((response:Response)=>void)|undefined;
 globalThis.fetch=async()=>new Promise<Response>(resolve=>{finishOrder=resolve;});
 const recovery=render(React.createElement(Payment,{article,onUnlocked:()=>{unlocks++},onActive:(value:boolean)=>{active=value}}));
 fireEvent.click(recovery.getByText('Pay with Razorpay'));
 await waitFor(()=>assert.ok(finishOrder));
 paymentStatus='completed';
 await waitFor(()=>assert.equal(unlocks,2),{timeout:4500});
 await act(async()=>finishOrder!(Response.json({orderId:'order_1',keyId:'rzp_test_123',amount:100,currency:'INR'})));
 assert.equal(opens,3,'a late order response must not reopen checkout after polling confirms payment');
 assert.equal(active,false);
 }finally{cleanup();globalThis.fetch=original;supabase!.auth.stopAutoRefresh();(supabase!.auth as unknown as {broadcastChannel?:BroadcastChannel}).broadcastChannel?.close();dom.window.close();}
});
