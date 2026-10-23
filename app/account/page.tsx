'use client';

import React, { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import SiteHeader from '@/components/ui/SiteHeader';
import { AccountError, AccountService, type Profile, type Purchase } from '@/lib/auth/account-service';
import { AuthService } from '@/lib/auth/auth-service';
import { useAuth, useOwnedArticles } from '@/lib/auth/use-auth';
import { formatPrice } from '@/lib/payment';
import { navigation } from '@/lib/navigation';

function statusLabel(p: Purchase): { text: string; tone: '' | 'wait' | 'bad' } {
  if (p.status === 'completed') return { text: 'Unlocked', tone: '' };
  if (p.status === 'failed') return { text: 'Rejected or refunded', tone: 'bad' };
  return { text: 'Waiting for confirmation', tone: 'wait' };
}

export default function AccountPage() {
  const auth = useAuth();
  const purchases = useOwnedArticles(auth.session);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const userId = auth.session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) { setProfile(null); return; }
    let alive = true;
    AccountService.shared().profile()
      .then((p) => { if (alive && p) { setProfile(p); setName(p.displayName); } })
      .catch((e) => { if (alive) setError(e instanceof AccountError ? e.message : 'Could not load your profile.'); });
    return () => { alive = false; };
  }, [userId]);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setMessage(''); setError('');
    try {
      await AccountService.shared().updateDisplayName(name);
      setProfile((p) => (p ? { ...p, displayName: name.trim() } : p));
      setMessage('Saved.');
    } catch (err) {
      setError(err instanceof AccountError ? err.message : 'Could not save your name.');
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try { await AccountService.shared().signOutAndForgetBrowser(() => AuthService.shared().signOut()); navigation.go('/'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign out.'); }
  }

  if (auth.loading) return <main className="container"><p className="muted">Loading…</p></main>;

  if (!auth.session) {
    return <main className="container">
      <SiteHeader session={null} loading={false} />
      <section className="card auth-wrap">
        <h1 style={{ marginTop: 0 }}>Your account</h1>
        <p className="muted">Sign in to see your purchases and open them on any device.</p>
        <a className="btn" href="/login?next=%2Faccount">Sign in</a>
      </section>
    </main>;
  }

  return <main className="container">
    <SiteHeader session={auth.session} loading={false} />
    <h1 className="rise d1" style={{ fontSize: 'clamp(40px, 6vw, 64px)', margin: '8px 0 28px' }}>
      {profile ? `Hello, ${profile.displayName}` : 'Your account'}
    </h1>
    <div className="account-grid rise d2">
      <section className="card" aria-labelledby="purchases-title">
        <h2 id="purchases-title">Your purchases</h2>
        {purchases.loading && <p className="muted">Loading purchases…</p>}
        {purchases.error && <p className="danger">{purchases.error}</p>}
        {!purchases.loading && !purchases.error && purchases.purchases.length === 0 &&
          <p className="muted">Nothing unlocked yet. <a href="/">Browse articles</a>.</p>}
        <ul className="purchase-list">
          {purchases.purchases.map((p) => {
            const label = statusLabel(p);
            return <li key={p.paymentId}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.articleTitle}</div>
                <div className="muted small">{formatPrice(p.amountPaise)} · {new Date(p.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <span className={`pill ${label.tone}`}>{label.text}</span>
                {p.status === 'completed' && <a className="btn ghost" href={`/article/${p.articleId}`}>Read</a>}
              </div>
            </li>;
          })}
        </ul>
      </section>

      <section className="card" aria-labelledby="profile-title">
        <h2 id="profile-title">Profile</h2>
        <p className="muted small">{auth.session.user.email}</p>
        <form onSubmit={saveName}>
          <div className="field">
            <label htmlFor="display-name">Display name</label>
            <input id="display-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} disabled={saving} />
          </div>
          <div aria-live="polite">
            {message && <p className="success small">{message}</p>}
            {error && <p className="danger small" role="alert">{error}</p>}
          </div>
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
        <div className="row" style={{ marginTop: 24, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <a className="btn ghost" href="/reset-password">Change password</a>
          {profile?.isAdmin && <a className="btn ghost" href="/admin">Admin dashboard</a>}
          <button className="btn secondary" type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </section>
    </div>
  </main>;
}
