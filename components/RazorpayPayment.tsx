'use client';
import React,{useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {formatPrice,saveAccess} from '@/lib/payment';
import {paymentSession} from '@/lib/storage';
import {loadCheckout,type CheckoutInstance} from '@/lib/razorpay-checkout';
import type {Article} from '@/lib/types';

export default function RazorpayPayment({article,onUnlocked,onActive}:{article:Article;onUnlocked:()=>void;onActive:(active:boolean)=>void}) {
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [reference,setReference]=useState('');
 const [amount,setAmount]=useState(article.price_paise);
 const mounted=useRef(false);const locked=useRef(false);const finished=useRef(false);const checkout=useRef<CheckoutInstance|null>(null);
 const callbacks=useRef({onUnlocked,onActive});callbacks.current={onUnlocked,onActive};
 const unlock=(token:string)=>{if(!mounted.current||finished.current)return;saveAccess(article.id,token);finished.current=true;callbacks.current.onUnlocked();};
 useEffect(()=>{
  mounted.current=true;let cancelled=false;let timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   try {const session=paymentSession(article.id,'razorpay');setReference(session.ref);
    const result=await supabase?.rpc('get_payment_status',{p_access_token:session.token});
    if(cancelled)return;
    if(result?.error)throw new Error('Could not check payment status.');
    if(result?.data==='completed'){unlock(session.token);return;}
    if(result?.data==='failed'){setMessage('This purchase was refunded or revoked. Contact the site owner.');return;}
   }catch{if(!cancelled)setMessage('Unable to restore payment status. Check browser storage and your connection before paying.');}
   if(!cancelled)timer=setTimeout(()=>void poll(),3000);
  };
  void poll();
  return()=>{mounted.current=false;cancelled=true;if(timer)clearTimeout(timer);checkout.current?.close();};
 },[article.id]);
 async function post(path:string,body:unknown){
  const response=await fetch(`/api/razorpay/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if(!response.ok||data.error)throw new Error(data.error||'Payment request failed.');
  return data;
 }
 async function start(){
  if(locked.current)return;locked.current=true;setBusy(true);setMessage('Preparing secure checkout…');
  const release=()=>{locked.current=false;if(mounted.current){setBusy(false);callbacks.current.onActive(false);}};
  try {
   const session=paymentSession(article.id,'razorpay');setReference(session.ref);
   await loadCheckout();if(!mounted.current)return;
   const order=await post('order',{articleId:article.id,token:session.token,ref:session.ref});if(!mounted.current)return;
   if(order.completed){unlock(session.token);release();return;}
   setAmount(order.amount);
   if(!window.Razorpay)throw new Error('Checkout is unavailable.');
   checkout.current=new window.Razorpay({key:order.keyId,order_id:order.orderId,amount:order.amount,currency:order.currency,name:'PayRead',description:article.title,
    handler:async result=>{
     if(!mounted.current)return;
     setMessage('Verifying payment. Please do not pay again.');
     try {const verified=await post('verify',{token:session.token,orderId:result.razorpay_order_id,paymentId:result.razorpay_payment_id,signature:result.razorpay_signature});if(verified.completed)unlock(session.token);}
     catch(e){if(mounted.current)setMessage(`${e instanceof Error?e.message:'Verification is pending.'} Reopen this purchase to check again; do not pay twice.`);}
     finally{release();}
    },modal:{ondismiss:()=>{if(mounted.current)setMessage('Checkout closed. If you paid, wait for confirmation; otherwise you can reopen checkout.');release();}}});
   checkout.current.on('payment.failed',()=>{if(mounted.current)setMessage('The payment attempt failed. You can retry inside checkout. Access has not been granted.');});
   callbacks.current.onActive(true);checkout.current.open();setMessage('Complete your payment in Razorpay.');
  }catch(e){if(mounted.current)setMessage(e instanceof Error?e.message:'Unable to open checkout.');release();}
 }
 return <div className="center">
  <p className="price">{formatPrice(amount)} one-time</p>
  <button className="btn" disabled={busy} onClick={()=>void start()}>{busy?'Processing…':'Pay with Razorpay'}</button>
  <p className="muted small">Access unlocks after payment is confirmed automatically.</p>
  {reference&&<p className="small">Reference: {reference}</p>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
