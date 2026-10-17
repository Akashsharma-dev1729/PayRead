'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase, supabaseConfigError } from '@/lib/supabase';
import { accessToken, UUID } from '@/lib/storage';
import { formatPrice } from '@/lib/payment';
import type { Article } from '@/lib/types';

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to reach Supabase.';
}

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(supabaseConfigError || '');

  useEffect(() => {
    setArticle(null);
    setAllowed(false);
    setError(supabaseConfigError || '');
    setLoading(true);
    if (!UUID.test(id)) { setError('Article not found.'); setLoading(false); return; }
    const client = supabase;

    if (!client) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadArticle = async () => {
      try {
        const { data: previewRows, error: previewError } = await client.rpc(
          'get_article_preview',
          { p_article_id: id },
        );

        if (cancelled) return;

        if (previewError) {
          setError(previewError.message);
          return;
        }

        const preview = Array.isArray(previewRows) ? previewRows[0] : null;
        if (!preview) {
          setError('Article not found.');
          return;
        }

        setArticle(preview as Article);

        const token = accessToken(id);

        if (preview.price_paise !== 0 && !token) return;

        const { data: contentRows, error: contentError } = await client.rpc(
          'get_article_content',
          {
            p_article_id: id,
            p_access_token: token || null,
          },
        );

        if (cancelled) return;

        if (contentError) {
          setError(preview.price_paise === 0
            ? `Could not load this article: ${contentError.message}. Please retry.`
            : `Could not verify your purchase: ${contentError.message}. Please retry before paying again.`);
          return;
        }

        const unlocked = Array.isArray(contentRows) ? contentRows[0] : null;
        if (unlocked) {
          setArticle(unlocked as Article);
          setAllowed(true);
        } else if (preview.price_paise === 0) {
          setError('Could not load this free article. Please retry.');
        }
      } catch (requestError) {
        if (!cancelled) setError(messageFromError(requestError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadArticle();

    return () => {
      cancelled = true;
    };
  }, [id, retry]);

  if (loading || (article && article.id !== id)) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!article) {
    return (
      <main className="container">
        <p className="danger">{error || 'Article not found.'}</p>
      </main>
    );
  }

  return (
    <main className="container">
      <article className="article">
        <a className="muted" href="/">
          ← Back
        </a>
        <h1>{article.title}</h1>

        {error && <p className="danger">{error}</p>}

        {error ? (
          <button className="btn secondary" onClick={() => setRetry(value => value + 1)}>
            Retry loading article
          </button>
        ) : allowed ? (
          <div className="article-content">{article.content}</div>
        ) : (
          <div className="card">
            <h2>Article locked</h2>
            <p className="muted">
              Purchase access from the home page for {formatPrice(article.price_paise)}.
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
