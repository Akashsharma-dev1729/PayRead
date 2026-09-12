'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type AdminPayment = {
  id: string;
  article_id: string;
  amount_paise: number;
  status: string;
  transaction_ref: string;
  access_token: string;
  created_at: string;
  articles?: {
    title: string;
  } | null;
};

export default function Admin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<any>(null);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    return supabase.auth
      .onAuthStateChange((_e, s) => {
        setSession(s);
      })
      .data.subscription.unsubscribe;
  }, []);

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMsg(error.message);
    }
  }

  async function load() {
    const { data, error } = await supabase
      .from('payments')
      .select(`
        *,
        articles (
          title
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      setMsg(error.message);
      return;
    }

    setPayments((data || []) as AdminPayment[]);
  }

  async function approve(id: string) {
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
    }

    await load();
  }

  if (!session) {
    return (
      <main className="container admin">
        <h1>PayRead Admin</h1>

        <p className="muted">
          Sign in to review pending UPI payments.
        </p>

        <input
          className="input"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <br />
        <br />

        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <br />
        <br />

        <button className="btn" onClick={login}>
          Sign in
        </button>

        <p className="danger">{msg}</p>
      </main>
    );
  }

  return (
    <main className="container admin">
      <div className="row">
        <h1>Pending payments</h1>

        <button
          className="btn secondary"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </div>

      <button className="btn" onClick={load}>
        Refresh
      </button>

      <p className="muted small">
        Only approve payments after you have independently confirmed
        the money was received.
      </p>

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
              <td>
                {p.articles?.title || p.article_id}
              </td>

              <td>
                ₹{(p.amount_paise / 100).toFixed(2)}
              </td>

              <td>{p.transaction_ref}</td>

              <td>
                <button
                  className="btn"
                  onClick={() => approve(p.id)}
                >
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
