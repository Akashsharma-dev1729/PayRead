'use client';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthService } from './auth-service';
import { AccountService, type Purchase } from './account-service';

export type AuthState = { session: Session | null; loading: boolean };

/** Current sign-in state, kept in sync with Supabase Auth. */
export function useAuth(service: AuthService = AuthService.shared()): AuthState {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });
  useEffect(() => {
    if (!service.available) { setState({ session: null, loading: false }); return; }
    let alive = true;
    service.currentSession()
      .then((session) => { if (alive) setState({ session, loading: false }); })
      .catch(() => { if (alive) setState({ session: null, loading: false }); });
    const unsubscribe = service.onChange((session) => { if (alive) setState({ session, loading: false }); });
    return () => { alive = false; unsubscribe(); };
    // The shared service is stateless; subscribing once per mount is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

export type OwnedState = { owned: Set<string>; purchases: Purchase[]; loading: boolean; error: string };

/**
 * Purchases of the signed-in account (after attaching this browser's purchases).
 * Signed out: nothing is owned through the account.
 */
export function useOwnedArticles(session: Session | null, service: AccountService = AccountService.shared()): OwnedState & { reload: () => void } {
  const [state, setState] = useState<OwnedState>({ owned: new Set(), purchases: [], loading: false, error: '' });
  const [version, setVersion] = useState(0);
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) { setState({ owned: new Set(), purchases: [], loading: false, error: '' }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    service.syncAndList()
      .then((purchases) => {
        if (!alive) return;
        const owned = new Set(purchases.filter((p) => p.status === 'completed').map((p) => p.articleId));
        setState({ owned, purchases, loading: false, error: '' });
      })
      .catch((e) => { if (alive) setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Could not load purchases.' })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}
