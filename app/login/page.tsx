'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import MistBackground from '@/components/ui/MistBackground';
import SiteHeader from '@/components/ui/SiteHeader';
import { AuthError, AuthService, MIN_PASSWORD, safeNextPath } from '@/lib/auth/auth-service';
import { useAuth } from '@/lib/auth/use-auth';
import { navigation } from '@/lib/navigation';

type Mode = 'signin' | 'signup' | 'reset';

const TITLES: Record<Mode, [string, string]> = {
  signin: ['Welcome back', 'Sign in to open your purchases on any device.'],
  signup: ['Join PayRead', 'One account for everything you read and unlock.'],
  reset: ['Reset your password', 'We will email you a link to choose a new password.'],
};

export default function LoginPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [next, setNext] = useState('/account');
  const left = useRef(false);
  const leave = (path: string) => { if (left.current) return; left.current = true; navigation.go(path); };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNextPath(params.get('next')));
    const requested = params.get('mode');
    if (requested === 'signup' || requested === 'reset') setMode(requested);
  }, []);

  // Already signed in: nothing to do here.
  useEffect(() => {
    if (!auth.loading && auth.session && !busy) leave(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.session, busy, next]);

  function switchMode(value: Mode) {
    setMode(value); setError(''); setNotice('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    const service = AuthService.shared();
    try {
      if (mode === 'signin') {
        await service.signIn(email, password);
        leave(next);
        return;
      }
      if (mode === 'reset') {
        await service.requestPasswordReset(email, `${window.location.origin}/reset-password`);
        setNotice(`If ${email.trim()} has a PayRead account, a reset link is on its way. It works once.`);
        return;
      }
      const result = await service.signUp(email, password, name, `${window.location.origin}${next}`);
      if (result.session) { leave(next); return; }
      setNotice(`Check ${email.trim()} for a confirmation link, then sign in. If you already have an account, sign in instead.`);
      setPassword('');
      setMode('signin');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const [title, subtitle] = TITLES[mode];
  const submitLabel = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link';

  return <>
    <div className="hero-shell" style={{ minHeight: '100vh' }}>
      <MistBackground intensity={0.7} />
      <div className="container">
        <SiteHeader session={auth.session} loading={auth.loading} />
        <main className="auth-wrap rise d1">
          <section className="card auth-card" aria-labelledby="auth-title">
            <h1 id="auth-title">{title}</h1>
            <p className="muted">{subtitle}</p>

            {mode !== 'reset' ? <div className="tabs" role="group" aria-label="Choose sign in or create account">
              <button type="button" aria-pressed={mode === 'signin'} onClick={() => switchMode('signin')}>Sign in</button>
              <button type="button" aria-pressed={mode === 'signup'} onClick={() => switchMode('signup')}>Create account</button>
            </div> : <div style={{ height: 16 }} />}

            <form onSubmit={submit} noValidate>
              {mode === 'signup' && <div className="field">
                <label htmlFor="name">Your name</label>
                <input id="name" className="input" autoComplete="name" value={name} maxLength={60}
                  onChange={(e) => setName(e.target.value)} disabled={busy} />
              </div>}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} disabled={busy} />
              </div>
              {mode !== 'reset' && <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" className="input" type="password" value={password}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  onChange={(e) => setPassword(e.target.value)} disabled={busy} aria-describedby={mode === 'signup' ? 'password-hint' : undefined} />
                {mode === 'signup' && <span id="password-hint" className="hint">At least {MIN_PASSWORD} characters.</span>}
              </div>}
              <div aria-live="polite">
                {error && <p className="danger small" role="alert">{error}</p>}
                {notice && <p className="status small">{notice}</p>}
              </div>
              <button className="btn block" type="submit" disabled={busy}>
                {busy ? 'Please wait…' : submitLabel}
              </button>
            </form>
            {mode === 'signin' && <p style={{ margin: '16px 0 0', textAlign: 'center' }}>
              <button type="button" className="link-button" onClick={() => switchMode('reset')}>Forgot password?</button>
            </p>}
            {mode === 'reset' && <p style={{ margin: '16px 0 0', textAlign: 'center' }}>
              <button type="button" className="link-button" onClick={() => switchMode('signin')}>Back to sign in</button>
            </p>}
            {mode !== 'reset' && <p className="muted small" style={{ marginTop: 20 }}>
              Purchases you made on this browser before signing in are added to your account automatically.
            </p>}
          </section>
        </main>
      </div>
    </div>
  </>;
}
