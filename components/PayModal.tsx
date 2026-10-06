'use client';
import React,{useEffect,useRef,useState} from 'react';
import ManualPayModal from './ManualPayModal';
import RazorpayPayment from './RazorpayPayment';
import {paymentSession,readRecord} from '@/lib/storage';
import type {Article} from '@/lib/types';
export default function PayModal(props:{article:Article;onClose:()=>void;onUnlocked:()=>void}){
 const [method,setMethod]=useState<'manual_upi'|'razorpay'|null>(null);
 const [ready,setReady]=useState(false);const [error,setError]=useState('');const [active,setActive]=useState(false);
 const dialog=useRef<HTMLDivElement>(null);const activeRef=useRef(false);activeRef.current=active;
 const close=useRef(props.onClose);close.current=props.onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;
  const record=readRecord('payread_pending')[props.article.id] as {method?:string}|undefined;
  if(record)setMethod(record.method==='razorpay'?'razorpay':'manual_upi');setReady(true);
  const handler=(e:KeyboardEvent)=>{if(activeRef.current)return;if(e.key==='Escape')close.current();
   if(e.key!=='Tab'||!dialog.current)return;
   const nodes=dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled)');if(!nodes.length)return;
   const first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first.focus();}
  };document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);previous?.focus();};
 },[props.article.id]);
 useEffect(()=>{if(ready&&method!=='manual_upi')dialog.current?.focus();},[ready,method]);
 if(!ready)return null;
 if(method==='manual_upi')return <ManualPayModal {...props}/>;
 const choose=(value:'razorpay'|'manual_upi')=>{try{paymentSession(props.article.id,value);setMethod(value);}catch(e){setError(e instanceof Error?e.message:'Storage unavailable.');}};
 return <div className="modalback" onClick={()=>{if(!active)props.onClose();}}>
  <div className="modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="payment-title" onClick={e=>e.stopPropagation()}>
   <div className="row"><h2 id="payment-title">Unlock article</h2><button className="btn secondary" disabled={active} onClick={props.onClose} aria-label="Close payment dialog">×</button></div>
   <p>{props.article.title}</p>
   {method==='razorpay'?<RazorpayPayment article={props.article} onUnlocked={props.onUnlocked} onActive={setActive}/>:<>
    <button className="btn" onClick={()=>choose('razorpay')}>Pay with Razorpay</button>
    <p className="muted small">Automatic confirmation after successful payment.</p>
    <button className="btn secondary" onClick={()=>choose('manual_upi')}>Use manual UPI instead</button>
    <p className="muted small">Manual UPI requires administrator approval.</p>
   </>}
   {error&&<p className="danger">{error}</p>}
  </div>
 </div>;
}
