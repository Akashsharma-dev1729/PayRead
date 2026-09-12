'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { formatPrice } from '@/lib/payment';
import type { Article } from '@/lib/types';

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();

  const [a, setA] = useState<Article | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('articles')
        .select('*')
        .eq('id', id)
        .single();

      setA(data);

      const raw = localStorage.getItem('payread_access');

      const token = raw ? JSON.parse(raw)[id] : null;

      if (token) {
        const { data: p } = await supabase
          .from('payments')
          .select('status')
          .eq('article_id', id)
          .eq('access_token', token)
          .eq('status', 'completed')
          .maybeSingle();

        setAllowed(!!p);
      }
    })();
  }, [id]);

  if (!a) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="container">
      <article className="article">
        <a className="muted" href="/">
          ← Back
        </a>

        <h1>{a.title}</h1>

        {allowed ? (
          <div className="article-content">
            {a.content}
          </div>
        ) : (
          <div className="card">
            <h2>Article locked</h2>

            <p className="muted">
              Purchase access from the home page for{' '}
              {formatPrice(a.price_paise)}.
            </p>

            <a className="btn" href="/">
              Go back to PayRead
            </a>
          </div>
        )}
      </article>
    </main>
  );
}
