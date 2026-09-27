'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase, supabaseConfigError } from '@/lib/supabase';
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
  const [error, setError] = useState(supabaseConfigError || '');

  useEffect(() => {
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

        let token: string | null = null;
        try {
          const raw = localStorage.getItem('payread_access');
          const access = raw ? (JSON.parse(raw) as Record<string, string>) : {};
          token = access[id] ?? null;
        } catch {
          localStorage.removeItem('payread_access');
        }

        if (!token) return;

        const { data: contentRows, error: contentError } = await client.rpc(
          'get_article_content',
          {
            p_article_id: id,
            p_access_token: token,
          },
        );

        if (cancelled) return;

        if (contentError) {
          // Keep the preview visible and leave the article locked.
          return;
        }

        const unlocked = Array.isArray(contentRows) ? contentRows[0] : null;
        if (unlocked) {
          setArticle(unlocked as Article);
          setAllowed(true);
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
  }, [id]);

  if (loading) {
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

        {allowed ? (
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
