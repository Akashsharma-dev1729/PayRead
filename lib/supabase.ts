import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const rawKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

function isValidSupabaseUrl(value?: string): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export const supabaseConfigError = !rawUrl
  ? 'NEXT_PUBLIC_SUPABASE_URL is missing.'
  : !isValidSupabaseUrl(rawUrl)
    ? 'NEXT_PUBLIC_SUPABASE_URL must be the Supabase project URL, for example https://your-project.supabase.co (do not include /rest/v1).'
    : !rawKey
      ? 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) is missing.'
      : null;

export const supabase: SupabaseClient | null = supabaseConfigError
  ? null
  : createClient(rawUrl!, rawKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  return supabase;
}
