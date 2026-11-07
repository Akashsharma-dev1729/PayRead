'use client';

import React, { useState } from 'react';
import type { FormEvent } from 'react';
import SiteHeader from '@/components/ui/SiteHeader';
import { AuthError, AuthService, MIN_PASSWORD } from '@/lib/auth/auth-service';
import { useAuth } from '@/lib/auth/use-auth';
import { navigation } from '@/lib/navigation';

/**
 * Landing page of the emailed reset link (Supabase signs the reader in from the
 * link), and the place where a signed-in reader changes their password.
 */
export default function ResetPasswordPage() {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await AuthService.shared().updatePassword(password, confirm);
      setDone(true);
      navigation.go('/account');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not change your password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="container">
    <SiteHeader session={auth.session} loading={auth.loading} />
    <section className="card auth-card auth-wrap rise d1" aria-labelledby="reset-title">
      <h1 id="reset-title">Choose a new password</h1>
      {auth.loading ? <p className="muted">Checking your link…</p>
        : !auth.session ? <>
          <p className="muted">This reset link is invalid or has expired. Links work once and only for a short time.</p>
          <a className="btn" href="/login?mode=reset">Send a new link</a>
        </>
        : <form onSubmit={submit} noValidate>
          <p className="muted small">For {auth.session.user.email}</p>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" className="input" type="password" autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} disabled={busy || done} aria-describedby="new-password-hint" />
            <span id="new-password-hint" className="hint">At least {MIN_PASSWORD} characters.</span>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Repeat new password</label>
            <input id="confirm-password" className="input" type="password" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} disabled={busy || done} />
          </div>
          <div aria-live="polite">
            {error && <p className="danger small" role="alert">{error}</p>}
            {done && <p className="success small">Password changed. Opening your account…</p>}
          </div>
          <button className="btn block" type="submit" disabled={busy || done}>{busy ? 'Saving…' : 'Save new password'}</button>
        </form>}
    </section>
  </main>;
}
