import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {PathParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

test('free reader bypasses checkout; paid reader remains locked without a token', {timeout:15000}, async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://payread.test'});
 for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-key';
 const {supabase}=await import('../lib/supabase');
 const {default:Home}=await import('../app/page');
 const {default:ArticlePage}=await import('../app/article/[id]/page');
 const {render,waitFor,cleanup}=await import('@testing-library/react');
 const free={id:'71000000-0000-4000-8000-000000000001',title:'Free read',excerpt:'An excerpt',price_paise:0,published:true};
 const paid={...free,id:'10000000-0000-4000-8000-000000000001',title:'Paid read',price_paise:10000};
 let contentCalls=0;let recoveredToken:string|null=null;
 Object.defineProperty(supabase,'rpc',{value:async(name:string,args?:{p_article_id:string;p_access_token?:string|null})=>{
  if(name==='list_published_articles')return {data:[free,paid],error:null};
  if(name==='get_article_preview')return {data:[args!.p_article_id===free.id?free:paid],error:null};
  if(name==='get_article_content'){contentCalls++;
   if(args!.p_article_id===paid.id){assert.equal(args!.p_access_token,recoveredToken);return {data:[{...paid,content:'Recovered paid article'}],error:null};}
   assert.equal(args!.p_article_id,free.id);assert.equal(args!.p_access_token,null);return {data:[{...free,content:'Full free article body'}],error:null};}
  throw new Error(`Unexpected payment call: ${name}`);
 }});
 try {
 const home=render(React.createElement(Home));
 await waitFor(()=>assert.ok(home.getByText('Read free')));
 assert.equal(home.getByText('Read free').getAttribute('href'),`/article/${free.id}`);
 assert.ok(home.getByText('Read for ₹100.00'));assert.equal(home.queryByRole('dialog'),null);
 cleanup();
 const reader=render(React.createElement(PathParamsContext.Provider,{value:{id:free.id}},React.createElement(ArticlePage)));
 await waitFor(()=>assert.ok(reader.getByText('Full free article body')));
 assert.equal(reader.queryByText('Article locked'),null);assert.equal(contentCalls,1);
 reader.rerender(React.createElement(PathParamsContext.Provider,{value:{id:paid.id}},React.createElement(ArticlePage)));
 await waitFor(()=>assert.ok(reader.getByText('Article locked')));
 assert.equal(reader.queryByText('Full free article body'),null);assert.equal(contentCalls,1);
 cleanup();
 recoveredToken=crypto.randomUUID();
 localStorage.setItem('payread_pending',JSON.stringify({[paid.id]:{token:recoveredToken,ref:'PR1234567890',method:'razorpay'}}));
 const recovered=render(React.createElement(PathParamsContext.Provider,{value:{id:paid.id}},React.createElement(ArticlePage)));
 await waitFor(()=>assert.ok(recovered.getByText('Recovered paid article')));
 assert.equal(JSON.parse(localStorage.getItem('payread_access')!)[paid.id],recoveredToken);
 } finally {cleanup();supabase!.auth.stopAutoRefresh();(supabase!.auth as unknown as {broadcastChannel?:BroadcastChannel}).broadcastChannel?.close();dom.window.close();}
});
