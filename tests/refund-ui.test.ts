import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {PathParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

test('a refunded purchase stops showing as unlocked; a failed check never drops access', {timeout:15000}, async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://payread.test'});
 for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-key';
 const {supabase}=await import('../lib/supabase');
 const {default:ArticlePage}=await import('../app/article/[id]/page');
 const {render,waitFor,cleanup}=await import('@testing-library/react');
 const paid={id:'10000000-0000-4000-8000-000000000001',title:'Paid read',excerpt:'An excerpt',price_paise:10000,published:true};
 const other='10000000-0000-4000-8000-000000000002';
 const token='20000000-0000-4000-8000-000000000001';
 let mode:'error'|'refunded'='error';
 Object.defineProperty(supabase,'rpc',{value:async(name:string)=>{
  if(name==='get_article_preview')return {data:[paid],error:null};
  if(name==='get_article_content')return mode==='error'?{data:null,error:{message:'network down'}}:{data:[],error:null};
  throw new Error(`Unexpected call: ${name}`);
 }});
 const view=()=>React.createElement(PathParamsContext.Provider,{value:{id:paid.id}},React.createElement(ArticlePage));
 try {
  localStorage.setItem('payread_access',JSON.stringify({[paid.id]:token,[other]:'20000000-0000-4000-8000-000000000002'}));
  // A temporary failure must keep the purchase: the reader is told to retry.
  let page=render(view());
  await waitFor(()=>assert.ok(page.getByText(/Could not verify your purchase: network down/)));
  assert.equal(JSON.parse(localStorage.getItem('payread_access')!)[paid.id],token);
  cleanup();
  // A successful check that no longer unlocks (refunded): forget only that article.
  mode='refunded';page=render(view());
  await waitFor(()=>assert.ok(page.getByText('Article locked')));
  const saved=JSON.parse(localStorage.getItem('payread_access')!);
  assert.equal(saved[paid.id],undefined);
  assert.equal(saved[other],'20000000-0000-4000-8000-000000000002');
 } finally {cleanup();supabase!.auth.stopAutoRefresh();(supabase!.auth as unknown as {broadcastChannel?:BroadcastChannel}).broadcastChannel?.close();dom.window.close();}
});
