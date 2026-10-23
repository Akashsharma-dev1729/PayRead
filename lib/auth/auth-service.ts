import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { supabase, supabaseConfigError } from '@/lib/supabase';

/** A sign-in problem the reader can act on; its message is safe to show. */
export class AuthError extends Error {}

export type SignUpResult = { session: Session | null; needsConfirmation: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

/**
 * Thin, testable wrapper around Supabase Auth for readers and writers.
 * Owns input validation and turns provider errors into plain messages.
 */
export class AuthService {
  constructor(private readonly client: SupabaseClient | null, private readonly configError: string | null = null) {}

  static shared(): AuthService {
    return new AuthService(supabase, supabaseConfigError);
  }

  get available(): boolean {
    return this.client !== null;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new AuthError(this.configError || 'Sign-in is not configured yet.');
    return this.client;
  }

  static normalizeEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new AuthError('Enter a valid email address.');
    return email;
  }

  static checkPassword(value: string): string {
    if (value.length < MIN_PASSWORD) throw new AuthError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    if (value.length > 72) throw new AuthError('Use 72 characters or fewer for your password.');
    return value;
  }

  static checkDisplayName(value: string): string {
    const name = value.trim();
    if (name.length < 1 || name.length > 60) throw new AuthError('Enter a name between 1 and 60 characters.');
    return name;
  }

  /** Provider messages vary; map the common ones and never echo internals. */
  static friendly(error: { message?: string; status?: number } | null | undefined): string {
    const message = (error?.message || '').toLowerCase();
    if (message.includes('invalid login credentials')) return 'Wrong email or password.';
    if (message.includes('email not confirmed')) return 'Confirm your email first: open the link we sent to your inbox.';
    if (message.includes('rate limit') || error?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    if (message.includes('already registered')) return 'That email already has an account. Sign in instead.';
    if (message.includes('password')) return 'Choose a stronger password (at least 8 characters, not a common one).';
    if (message.includes('fetch')) return 'Could not reach PayRead. Check your connection and try again.';
    return 'Something went wrong. Please try again.';
  }

  async currentSession(): Promise<Session | null> {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getSession();
    if (error) return null;
    return data.session;
  }

  /** Subscribes to sign-in changes; returns the unsubscribe function. */
  onChange(listener: (session: Session | null) => void): () => void {
    if (!this.client) return () => {};
    const { data } = this.client.auth.onAuthStateChange((_event, session) => listener(session));
    return () => data.subscription.unsubscribe();
  }

  async signIn(emailInput: string, password: string): Promise<Session> {
    const client = this.requireClient();
    const email = AuthService.normalizeEmail(emailInput);
    if (!password) throw new AuthError('Enter your password.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new AuthError(AuthService.friendly(error));
    return data.session;
  }

  async signUp(emailInput: string, passwordInput: string, displayNameInput: string, redirectTo?: string): Promise<SignUpResult> {
    const client = this.requireClient();
    const email = AuthService.normalizeEmail(emailInput);
    const password = AuthService.checkPassword(passwordInput);
    const displayName = AuthService.checkDisplayName(displayNameInput);
    const { data, error } = await client.auth.signUp({
      email, password, options: { data: { display_name: displayName }, emailRedirectTo: redirectTo },
    });
    if (error) throw new AuthError(AuthService.friendly(error));
    // With email confirmation on, Supabase returns no session (and, for an email
    // that already exists, a user with no identities, so as not to reveal it).
    return { session: data.session, needsConfirmation: !data.session };
  }

  /**
   * Emails a reset link. The result never reveals whether the address has an
   * account; only a rate limit or a network problem is reported.
   */
  async requestPasswordReset(emailInput: string, redirectTo: string): Promise<void> {
    const client = this.requireClient();
    const email = AuthService.normalizeEmail(emailInput);
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (!error) return;
    const message = (error.message || '').toLowerCase();
    if (message.includes('rate limit') || error.status === 429 || message.includes('fetch')) throw new AuthError(AuthService.friendly(error));
  }

  /** Sets a new password for the signed-in user (also used after a reset link). */
  async updatePassword(passwordInput: string, confirmInput: string): Promise<void> {
    const client = this.requireClient();
    const password = AuthService.checkPassword(passwordInput);
    if (password !== confirmInput) throw new AuthError('The two passwords do not match.');
    const { error } = await client.auth.updateUser({ password });
    if (!error) return;
    const message = (error.message || '').toLowerCase();
    if (message.includes('different')) throw new AuthError('Choose a password different from your current one.');
    if (message.includes('session') || message.includes('jwt')) throw new AuthError('This reset link has expired. Request a new one.');
    throw new AuthError(AuthService.friendly(error));
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client.auth.signOut();
    if (error) throw new AuthError(AuthService.friendly(error));
  }
}

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNextPath(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const url = new URL(raw, 'https://payread.local');
    if (url.origin !== 'https://payread.local') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
