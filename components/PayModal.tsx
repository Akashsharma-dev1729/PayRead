'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { buildUpiLink, formatPrice, newToken, newTransactionRef, saveAccess } from '@/lib/payment';
import type { Article } from '@/lib/types';

export default function PayModal({
  article,
  onClose,
  onUnlocked,
}: {
  article: Article;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [qr, setQr] = useState('');
  const [token] = useState(newToken);
  const [ref] = useState(newTransactionRef);
  const [status, setStatus] = useState<'starting' | 'pending' | 'success' | 'failed'>('starting');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = buildUpiLink(article.price_paise, ref, article.title);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!supabase) {
        setError(supabaseConfigError || 'Supabase is not configured.');
        setStatus('failed');
        return;
      }

      try {
        const { error: createError } = await supabase.rpc('create_payment', {
          p_article_id: article.id,
          p_transaction_ref: ref,
          p_access_token: token,
        });

        if (createError) {
          setError(createError.message);
          setStatus('failed');
          return;
        }

        const data = await QRCode.toDataURL(link, { width: 230, margin: 1 });
        if (!cancelled) {
          setQr(data);
          setStatus('pending');
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Could not start payment.');
        setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [article.id, link, ref, token]);

  useEffect(() => {
    if (status !== 'pending' || !supabase) return;

    const client = supabase;
    const intervalId = setInterval(async () => {
      const { data, error: statusError } = await client.rpc('get_payment_status', {
        p_access_token: token,
      });

      if (statusError) return;

      if (data === 'completed') {
        clearInterval(intervalId);
        saveAccess(article.id, token);
        setStatus('success');
        setTimeout(onUnlocked, 700);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [status, token, article.id, onUnlocked]);

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="modalback" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>Unlock article</h2>
          <button className="btn secondary" onClick={onClose}>×</button>
        </div>
        <p className="muted">{article.title}</p>
        <p className="price">{formatPrice(article.price_paise)} one-time</p>

        {status === 'starting' && <p className="status">Preparing payment…</p>}
        {status === 'failed' && (
          <>
            <p className="status danger">{error || 'Could not start payment.'}</p>
            <button className="btn secondary" onClick={onClose}>Close</button>
          </>
        )}
        {status === 'pending' && (
          <div className="center">
            <img className="qr" src={qr} alt="UPI payment QR code" />
            <p className="muted small">Scan with Paytm, PhonePe, Google Pay or another UPI app.</p>
            <button
              className="btn"
              onClick={() => {
                const isAndroid = /Android/i.test(navigator.userAgent);
                if (isAndroid) {
                  const params = link.replace('upi://pay?', '');
                  window.location.href = `intent://pay?${params}#Intent;scheme=upi;action=android.intent.action.VIEW;end`;
                } else {
                  window.location.href = link;
                }
              }}
            >
              Pay with UPI
            </button>
            <button className="btn secondary" onClick={copy} style={{ marginLeft: 8 }}>
              {copied ? 'Copied' : 'Copy payment link'}
            </button>
            <p className="status small">
              Payment stays pending until it is confirmed by the site administrator.
            </p>
          </div>
        )}
        {status === 'success' && (
          <div className="center">
            <p className="success">✓ Payment confirmed</p>
            <p>Unlocking your article…</p>
          </div>
        )}
      </div>
    </div>
  );
}
