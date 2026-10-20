'use client';
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { buildUpiLink, formatPrice, normalizeUtr, paymentConfigError, saveAccess } from '@/lib/payment';
import { paymentSession, restartPaymentSession } from '@/lib/storage';
import type { Article } from '@/lib/types';

type Status = 'starting' | 'pending' | 'success' | 'failed' | 'rejected';

export default function PayModal({ article, onClose, onUnlocked }: {
  article: Article; onClose: () => void; onUnlocked: () => void;
}) {
  const [qr, setQr] = useState('');
  const [link, setLink] = useState('');
  const [amount, setAmount] = useState(article.price_paise);
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  // UTR the database has recorded for this purchase, and the buyer's draft.
  const [utr, setUtr] = useState('');
  const [utrInput, setUtrInput] = useState('');
  const [editingUtr, setEditingUtr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [utrError, setUtrError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const token = useRef('');
  const callbacks = useRef({ onClose, onUnlocked });
  callbacks.current = { onClose, onUnlocked };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') callbacks.current.onClose();
      if (e.key !== 'Tab') return;
      const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)');
      if (!nodes?.length) { e.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('starting'); setError(''); setLink(''); setQr(''); setUtr(''); setUtrInput(''); setEditingUtr(false); setUtrError('');
    const run = async () => {
      try {
        const client = supabase;
        if (!client) throw new Error(supabaseConfigError || 'Supabase is not configured.');
        if (paymentConfigError) throw new Error(paymentConfigError);
        // Persist BEFORE creating or showing anything payable. Reopening/retries reuse this identity.
        const session = paymentSession(article.id);
        token.current = session.token;
        setReference(session.ref);
        const { error: createError } = await client.rpc('create_payment', {
          p_article_id: article.id, p_transaction_ref: session.ref, p_access_token: session.token,
        });
        if (cancelled) return;
        if (createError) throw new Error(createError.message);
        const { data, error: detailsError } = await client.rpc('get_payment_details', { p_access_token: session.token });
        if (cancelled) return;
        if (detailsError) throw new Error(detailsError.message);
        const details = Array.isArray(data) ? data[0] : null;
        if (!details || details.article_id !== article.id || details.transaction_ref !== session.ref) throw new Error('Payment details could not be verified.');
        setAmount(details.amount_paise);
        if (typeof details.payer_utr === 'string') setUtr(details.payer_utr);
        const unlock = () => {
          saveAccess(article.id, session.token);
          if (!cancelled) { setStatus('success'); callbacks.current.onUnlocked(); }
        };
        if (details.status === 'completed') { unlock(); return; }
        if (details.status === 'failed') { setStatus('rejected'); return; }
        const paymentLink = buildUpiLink(details.amount_paise, session.ref);
        const image = await QRCode.toDataURL(paymentLink, { width: 230, margin: 1 });
        if (cancelled) return;
        setLink(paymentLink); setQr(image); setStatus('pending');
        const poll = async () => {
          try {
            const { data: state, error: pollError } = await client.rpc('get_payment_status', { p_access_token: session.token });
            if (cancelled) return;
            if (pollError) throw new Error(pollError.message);
            if (state === 'completed') { unlock(); return; }
            if (state === 'failed') { setStatus('rejected'); setError(''); return; }
            if (state !== 'pending') throw new Error('Payment record not found. Contact the administrator before paying.');
            setError('');
          } catch (e) {
            if (cancelled) return;
            setError(`Cannot confirm payment yet: ${e instanceof Error ? e.message : 'Network error'}. Retrying; do not pay again.`);
          }
          if (!cancelled) timer = setTimeout(() => void poll(), 4000);
        };
        timer = setTimeout(() => void poll(), 1000);
      } catch (e) {
        if (!cancelled) { setStatus('failed'); setError(e instanceof Error ? e.message : 'Could not start payment.'); }
      }
    };
    void run();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [article.id, article.title, retry]);

  async function submitUtr() {
    const value = normalizeUtr(utrInput);
    if (!value) { setUtrError('Enter the 12-digit UPI transaction ID (UTR / UPI Ref No.) from your UPI app.'); return; }
    if (!supabase || !token.current || submitting) return;
    setSubmitting(true); setUtrError('');
    try {
      const { data, error: submitError } = await supabase.rpc('submit_payment_utr', { p_access_token: token.current, p_utr: value });
      if (submitError) { setUtrError(submitError.message); return; }
      if (data === 'failed') { setStatus('rejected'); return; }
      setUtr(value); setEditingUtr(false); setUtrInput('');
    } catch (e) {
      setUtrError(`Could not submit: ${e instanceof Error ? e.message : 'Network error'}. Try again.`);
    } finally { setSubmitting(false); }
  }

  function startNewPayment() {
    try { restartPaymentSession(article.id); setRetry(x => x + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Storage unavailable.'); }
  }

  const showUtrForm = status === 'pending' && (!utr || editingUtr);

  return <div className="modalback" onClick={onClose}>
    <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="payment-title" tabIndex={-1} onClick={e => e.stopPropagation()}>
      <div className="row"><h2 id="payment-title">Unlock article</h2><button className="btn secondary" onClick={onClose} aria-label="Close payment dialog">×</button></div>
      <p>{article.title}</p><p className="price">{formatPrice(amount)} one-time</p>
      {reference && <p className="small">Reference: {reference}</p>}
      <div aria-live="polite">
        {status === 'starting' && <p>Preparing payment…</p>}
        {error && <p className="danger">{error}</p>}
        {status === 'failed' && <button className="btn secondary" onClick={() => setRetry(x => x + 1)}>Retry same payment</button>}
        {status === 'rejected' && <>
          <p className="danger">The administrator could not match this payment and rejected it.</p>
          <p className="muted small">If money left your account, do not pay again: contact the site owner with the reference above{utr ? ` and UPI transaction ID ${utr}` : ''}. If you did not pay, you can start a new payment.</p>
          <button className="btn secondary" onClick={startNewPayment}>Start a new payment</button>
        </>}
        {status === 'pending' && <div className="center">
          {!utr && <>
            <img className="qr" src={qr} alt="UPI payment QR code" />
            <p className="muted small">Scan with your UPI app, or open the link on your phone. Pay exactly {formatPrice(amount)}.</p>
            <a className="btn" href={link}>Pay with UPI</a>
            <button className="btn secondary" onClick={async () => {
              try { await navigator.clipboard.writeText(link); }
              catch { setError('Copy unavailable. Use the QR code or payment link.'); }
            }}>Copy payment link</button>
          </>}
          {utr && !editingUtr && <>
            <p>Payment submitted with UPI transaction ID <strong>{utr}</strong>.</p>
            <button className="btn secondary" onClick={() => { setEditingUtr(true); setUtrInput(utr); }}>Correct the transaction ID</button>
          </>}
          {showUtrForm && <form className="utr-form" onSubmit={e => { e.preventDefault(); void submitUtr(); }}>
            <label htmlFor="payer-utr" className="small">After paying, enter the 12-digit UPI transaction ID (UTR / UPI Ref No.) from your UPI app:</label>
            <input id="payer-utr" className="input" inputMode="numeric" autoComplete="off" maxLength={20} placeholder="e.g. 412345678901"
              value={utrInput} onChange={e => setUtrInput(e.target.value)} disabled={submitting} aria-invalid={!!utrError} />
            <button className="btn" type="submit" disabled={submitting}>{submitting ? 'Submitting…' : "I've paid"}</button>
            {utrError && <p className="danger small">{utrError}</p>}
          </form>}
          <p className="status small">{utr
            ? 'Waiting for the administrator to match your payment. You can close this; reopen the article on this browser to check. Do not pay twice.'
            : 'Your payment is checked by hand, so the administrator needs the transaction ID to find it. Do not pay twice.'}</p>
        </div>}
        {status === 'success' && <p>Payment confirmed. Opening article…</p>}
      </div>
    </div>
  </div>;
}
