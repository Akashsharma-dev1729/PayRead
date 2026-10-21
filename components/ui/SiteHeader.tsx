'use client';
import React from 'react';
import type { Session } from '@supabase/supabase-js';

/** Brand and navigation shared by reader pages. */
export default function SiteHeader({ session, loading }: { session: Session | null; loading: boolean }) {
  const name = (session?.user?.user_metadata?.display_name as string | undefined) || session?.user?.email?.split('@')[0] || '';
  return <nav className="nav" aria-label="Main">
    <a className="brand" href="/" aria-label="PayRead home">
      <span className="brand-dot" aria-hidden="true" />Pay<span>Read</span>
    </a>
    <div className="nav-links">
      {loading ? <span className="nav-placeholder" aria-hidden="true" />
        : session ? <a className="btn ghost" href="/account">{name ? `Hi, ${name}` : 'Your account'}</a>
        : <a className="btn ghost" href="/login">Sign in</a>}
    </div>
  </nav>;
}
