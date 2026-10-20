import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {PathParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

test('article page picks up a UPI approval made while the payment dialog was closed', {timeout:15000}, async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://payread.test'});
 for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-key';
 const {supabase}=await import('../lib/supabase');
 const {default:ArticlePage}=await import('../app/article/[id]/page');
 const {render,waitFor,cleanup}=await import('@testing-library/react');
 const paid={id:'10000000-0000-4000-8000-000000000001',title:'Paid read',excerpt:'An excerpt',price_paise:10000,published:true};
 const token='20000000-0000-4000-8000-000000000001';
 // The buyer paid and submitted the UTR, then closed the dialog; the admin approved later.
 localStorage.setItem('payread_pending',JSON.stringify({[paid.id]:{method:'manual_upi',token,ref:'PR1234567890ABCDEF'}}));
 let approved=false;const tokensSeen:unknown[]=[];
 Object.defineProperty(supabase,'rpc',{value:async(name:string,args?:{p_article_id:string;p_access_token?:string|null})=>{
  if(name==='get_article_preview')return {data:[paid],error:null};
  if(name==='get_article_content'){tokensSeen.push(args!.p_access_token);return {data:approved&&args!.p_access_token===token?[{...paid,content:'Paid body'}]:[],error:null};}
  throw new Error(`Unexpected call: ${name}`);
 }});
 try {
  let reader=render(React.createElement(PathParamsContext.Provider,{value:{id:paid.id}},React.createElement(ArticlePage)));
  await waitFor(()=>assert.ok(reader.getByText('Article locked')));
  assert.equal(localStorage.getItem('payread_access'),null);
  cleanup();approved=true;
  reader=render(React.createElement(PathParamsContext.Provider,{value:{id:paid.id}},React.createElement(ArticlePage)));
  await waitFor(()=>assert.ok(reader.getByText('Paid body')));
  assert.deepEqual(tokensSeen,[token,token]);
  assert.equal(JSON.parse(localStorage.getItem('payread_access')!)[paid.id],token);
 } finally {cleanup();supabase!.auth.stopAutoRefresh();(supabase!.auth as unknown as {broadcastChannel?:BroadcastChannel}).broadcastChannel?.close();dom.window.close();}
});
