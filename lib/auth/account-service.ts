import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { forgetBrowserPurchases, storedPurchaseTokens } from '@/lib/storage';

export type Profile = { displayName: string; role: 'reader' | 'writer'; bio: string; isAdmin: boolean };

export type Purchase = {
  paymentId: string;
  articleId: string;
  articleTitle: string;
  amountPaise: number;
  status: 'pending' | 'completed' | 'failed';
  provider: string;
  createdAt: string;
  completedAt: string | null;
};

export class AccountError extends Error {}

/** The signed-in reader's profile and purchases. Every call needs a session. */
export class AccountService {
  constructor(
    private readonly client: SupabaseClient | null,
    private readonly browserTokens: () => string[] = storedPurchaseTokens,
  ) {}

  static shared(): AccountService {
    return new AccountService(supabase);
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new AccountError('Accounts are not configured yet.');
    return this.client;
  }

  async profile(): Promise<Profile | null> {
    const { data, error } = await this.requireClient().rpc('get_my_profile');
    if (error) throw new AccountError('Could not load your profile. Please retry.');
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return { displayName: row.display_name, role: row.role === 'writer' ? 'writer' : 'reader', bio: row.bio ?? '', isAdmin: row.is_admin === true };
  }

  async updateDisplayName(name: string): Promise<void> {
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 60) throw new AccountError('Enter a name between 1 and 60 characters.');
    const client = this.requireClient();
    const { error } = await client.rpc('update_my_profile', { p_display_name: clean });
    if (error) throw new AccountError('Could not save your name. Please retry.');
    // The header shows the session's name; keep it in sync (best effort, the profile is the source of truth).
    try { await client.auth.updateUser({ data: { display_name: clean } }); } catch { /* header refreshes on next sign-in */ }
  }

  /** Attaches purchases made in this browser to the account. Returns how many moved. */
  async claimBrowserPurchases(): Promise<number> {
    const tokens = this.browserTokens();
    if (tokens.length === 0) return 0;
    const { data, error } = await this.requireClient().rpc('claim_purchases', { p_tokens: tokens });
    if (error) throw new AccountError('Could not attach this browser’s purchases to your account.');
    return typeof data === 'number' ? data : 0;
  }

  async purchases(): Promise<Purchase[]> {
    const { data, error } = await this.requireClient().rpc('my_purchases');
    if (error) throw new AccountError('Could not load your purchases. Please retry.');
    return (Array.isArray(data) ? data : []).map((row) => ({
      paymentId: row.payment_id,
      articleId: row.article_id,
      articleTitle: row.article_title,
      amountPaise: row.amount_paise,
      status: row.status,
      provider: row.provider,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }

  /**
   * Signs out and removes this browser's purchase tokens, so a shared computer
   * does not keep the account's articles open. Tokens are removed only after
   * they are safely attached to an account; if that fails they are kept.
   */
  async signOutAndForgetBrowser(signOut: () => Promise<void>, forget: () => void = forgetBrowserPurchases): Promise<void> {
    let attached = this.browserTokens().length === 0;
    if (!attached) {
      try { await this.claimBrowserPurchases(); attached = true; } catch { attached = false; }
    }
    await signOut();
    if (attached) forget();
  }

  /** Claims browser purchases first (so a fresh sign-in sees them), then lists. */
  async syncAndList(): Promise<Purchase[]> {
    try { await this.claimBrowserPurchases(); } catch { /* listing still works */ }
    return this.purchases();
  }
}
