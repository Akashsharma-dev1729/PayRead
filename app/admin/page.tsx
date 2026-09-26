'use client';

import { useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '@/lib/supabase';

type AdminPayment = {
  id: string;
  article_id: string;
  amount_paise: number;
  status: string;
  transaction_ref: string;
  created_at: string;
  article_title: string | null;
};

type PaymentRow = Omit<AdminPayment, 'article_title'>;

type ArticleTitleRow = {
  id: string;
  title: string;
};

function friendlyNetworkError(error: unknown) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'Unable to reach Supabase. Check the Vercel Supabase URL/key, confirm the Supabase project is active, then redeploy.';
  }

  return error instanceof Error ? error.message : 'Unexpected authentication error.';
}

export default function Admin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [msg, setMsg] = useState(supabaseConfigError || '');
  const [signingIn, setSigningIn] = useState(false);

  async function checkAdmin(currentSession: Session | null) {
    if (!supabase || !currentSession) {
      setIsAdmin(false);
      setCheckingRole(false);
      return;
    }

    setCheckingRole(true);
    const { data, error } = await supabase.rpc('is_admin');

    if (error) {
      setIsAdmin(false);
      setMsg(`Admin authorization check failed: ${error.message}`);
    } else {
      setIsAdmin(data === true);
      if (data !== true) {
        setMsg('This account is authenticated but is not registered as a PayRead admin.');
      }
    }

    setCheckingRole(false);
  }

  useEffect(() => {
    if (!supabase) {
      setCheckingRole(false);
      return;
    }

    const client = supabase;
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (cancelled) return;
        if (error) setMsg(error.message);
        setSession(data.session);
      } catch (error) {
        if (!cancelled) {
          setMsg(friendlyNetworkError(error));
          setCheckingRole(false);
        }
      }
    };

    void restoreSession();

    const { data } = client.auth.onAuthStateChange((_event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void checkAdmin(session);
  }, [session?.user.id]);

  async function login() {
    if (!supabase) {
      setMsg(supabaseConfigError || 'Supabase is not configured.');
      return;
    }

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setMsg('Enter your Supabase Auth email and password.');
      return;
    }

    setMsg('');
    setSigningIn(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      setSession(data.session);
      await checkAdmin(data.session);
    } catch (error) {
      setMsg(friendlyNetworkError(error));
    } finally {
      setSigningIn(false);
    }
  }

  async function load() {
    if (!supabase || !isAdmin) return;

    setMsg('');
    const { data: paymentData, error: paymentError } = await supabase
      .from('payments')
      .select('id, article_id, amount_paise, status, transaction_ref, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (paymentError) {
      setMsg(paymentError.message);
      return;
    }

    const paymentRows = (paymentData || []) as PaymentRow[];
    const articleIds = [...new Set(paymentRows.map((payment) => payment.article_id))];

    let articleTitleById = new Map<string, string>();

    if (articleIds.length > 0) {
      const { data: articleData, error: articleError } = await supabase
        .from('articles')
        .select('id, title')
        .in('id', articleIds);

      if (articleError) {
        setMsg(articleError.message);
        return;
      }

      articleTitleById = new Map(
        ((articleData || []) as ArticleTitleRow[]).map((article) => [
          article.id,
          article.title,
        ]),
      );
    }

    setPayments(
      paymentRows.map((payment) => ({
        ...payment,
        article_title: articleTitleById.get(payment.article_id) ?? null,
      })),
    );
  }

  async function approve(id: string) {
    if (!supabase || !isAdmin) return;

    setMsg('');
    const { error } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending');

    if (error) {
      setMsg(error.message);
      return;
    }

    await load();
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setPayments([]);
    setMsg('');
  }

  if (!session || !isAdmin) {
    return (
      <main className="container admin">
        <h1>PayRead Admin</h1>

        <p className="muted">
          Sign in with the email/password created in Supabase Authentication.
        </p>

        {session && checkingRole ? (
          <p className="status">Checking admin access…</p>
        ) : (
          <>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              disabled={signingIn || !!supabaseConfigError}
            />

            <br />
            <br />

            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') void login();
              }}
              disabled={signingIn || !!supabaseConfigError}
            />

            <br />
            <br />

            <button
              className="btn"
              onClick={() => void login()}
              disabled={signingIn || !!supabaseConfigError}
            >
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>

            {session && !isAdmin && (
              <button
                className="btn secondary"
                onClick={() => void signOut()}
                style={{ marginLeft: 8 }}
              >
                Sign out
              </button>
            )}
          </>
        )}

        {msg && <p className="danger">{msg}</p>}
      </main>
    );
  }

  return (
    <main className="container admin">
      <div className="row">
        <h1>Pending payments</h1>

        <button className="btn secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <button className="btn" onClick={() => void load()}>
        Refresh
      </button>

      <p className="muted small">
        Only approve payments after you have independently confirmed the money was received.
      </p>

      {msg && <p className="danger">{msg}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Article</th>
            <th>Amount</th>
            <th>Reference</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{p.article_title || p.article_id}</td>
              <td>₹{(p.amount_paise / 100).toFixed(2)}</td>
              <td>{p.transaction_ref}</td>
              <td>
                <button className="btn" onClick={() => void approve(p.id)}>
                  Approve
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
