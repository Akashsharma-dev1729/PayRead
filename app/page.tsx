'use client';

import { useEffect, useState } from 'react';
import PayModal from '@/components/PayModal';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { formatPrice } from '@/lib/payment';
import type { Article } from '@/lib/types';

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(supabaseConfigError || '');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase
      .rpc('list_published_articles')
      .then(({ data, error: queryError }) => {
        if (queryError) setError(queryError.message);
        setArticles((data || []) as Article[]);
        setLoading(false);
      })
      .catch((queryError) => {
        setError(queryError instanceof Error ? queryError.message : 'Unable to reach Supabase.');
        setLoading(false);
      });
  }, []);

  return (
    <main className="container">
      <nav className="nav">
        <div className="brand">
          Pay<span>Read</span>
        </div>

        <a className="muted small" href="/admin">
          Admin
        </a>
      </nav>

      <section className="hero">
        <p className="muted">PAY PER ARTICLE</p>
        <h1>Good writing, without another subscription.</h1>
        <p className="muted">Pay once for the article you actually want to read.</p>
      </section>

      {error && <p className="danger">{error}</p>}

      {loading ? (
        <section className="grid">
          {[1, 2, 3].map((n) => (
            <article className="card skeleton-card" key={n}>
              <div className="skeleton skeleton-title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text short"></div>
              <div className="row" style={{ marginTop: '20px' }}>
                <div className="skeleton skeleton-price"></div>
                <div className="skeleton skeleton-btn"></div>
              </div>
            </article>
          ))}
        </section>
      ) : articles.length === 0 && !error ? (
        <p className="muted">No published articles yet.</p>
      ) : (
        <section className="grid">
          {articles.map((a) => (
            <article className="card" key={a.id}>
              <h2>{a.title}</h2>
              <p className="muted">{a.excerpt}</p>
              <div className="row">
                <span className="price">{formatPrice(a.price_paise)}</span>
                <button className="btn" onClick={() => setSelected(a)}>
                  Read for {formatPrice(a.price_paise)}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {selected && (
        <PayModal
          article={selected}
          onClose={() => setSelected(null)}
          onUnlocked={() => location.assign(`/article/${selected.id}`)}
        />
      )}
    </main>
  );
}
