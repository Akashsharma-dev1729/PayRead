'use client';
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {supabase} from '@/lib/supabase';
import {buildUpiLink,formatPrice,newToken,newTransactionRef,saveAccess} from '@/lib/payment';
import type {Article} from '@/lib/types';

export default function PayModal({article,onClose,onUnlocked}:{article:Article;onClose:()=>void;onUnlocked:()=>void}){
 const [qr,setQr]=useState(''); const [token]=useState(newToken); const [ref]=useState(newTransactionRef); const [status,setStatus]=useState<'starting'|'pending'|'success'|'failed'>('starting'); const [error,setError]=useState(''); const [copied,setCopied]=useState(false);
 const link=buildUpiLink(article.price_paise,ref,article.title);
 useEffect(()=>{let cancelled=false;(async()=>{const {error}=await supabase.from('payments').insert({article_id:article.id,amount_paise:article.price_paise,status:'pending',transaction_ref:ref,access_token:token});if(error){setError(error.message);setStatus('failed');return}const data=await QRCode.toDataURL(link,{width:230,margin:1});if(!cancelled){setQr(data);setStatus('pending')}})();return()=>{cancelled=true}},[article.id,article.price_paise,link,ref,token]);
 useEffect(()=>{if(status!=='pending')return;const id=setInterval(async()=>{const {data}=await supabase.from('payments').select('status').eq('access_token',token).maybeSingle();if(data?.status==='completed'){clearInterval(id);saveAccess(article.id,token);setStatus('success');setTimeout(onUnlocked,700)}},3000);return()=>clearInterval(id)},[status,token,article.id,onUnlocked]);
 const copy=async()=>{await navigator.clipboard.writeText(link);setCopied(true);setTimeout(()=>setCopied(false),1600)};
 return <div className="modalback" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="row"><h2>Unlock article</h2><button className="btn secondary" onClick={onClose}>×</button></div><p className="muted">{article.title}</p><p className="price">{formatPrice(article.price_paise)} one-time</p>
 {status==='starting'&&<p className="status">Preparing payment…</p>}
 {status==='failed'&&<><p className="status danger">{error||'Could not start payment.'}</p><button className="btn secondary" onClick={onClose}>Close</button></>}
 {status==='pending'&&<div className="center"><img className="qr" src={qr} alt="UPI payment QR code"/><p className="muted small">Scan with Paytm, PhonePe, Google Pay or another UPI app.</p><button
  className="btn"
  onClick={() => {
    const isAndroid = /Android/i.test(navigator.userAgent);

    if (isAndroid) {
      const params = link.replace('upi://pay?', '');

      const intentLink =
        `intent://pay?${params}` +
        `#Intent;scheme=upi;action=android.intent.action.VIEW;end`;

      window.location.href = intentLink;
    } else {
      window.location.href = link;
    }
  }}
>
  Pay with UPI
</button><button className="btn secondary" onClick={copy} style={{marginLeft:8}}>{copied?'Copied':'Copy payment link'}</button><p className="status small">Payment stays pending until it is confirmed by the site administrator. Do not rely on this page alone as proof of payment.</p></div>}
 {status==='success'&&<div className="center"><p className="success">✓ Payment confirmed</p><p>Unlocking your article…</p></div>}</div></div>
}
