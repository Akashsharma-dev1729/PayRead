import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type StatsReport = {
  days: number;
  since: string;
  sessions: number;
  page_views: number;
  signups: number;
  purchases: number;
  revenue_paise: number;
  awaiting_review: number;
  all_time: { accounts: number; purchases: number; revenue_paise: number };
  funnel: { visited: number; opened_article: number; started_checkout: number; submitted_upi: number; paid: number };
  daily: { day: string; sessions: number; page_views: number; purchases: number }[];
  top_articles: { id: string; title: string; price_paise: number; opened: number; checkouts: number; purchases: number }[];
  top_sources: { source: string; sessions: number; checkouts: number; upi_submitted: number }[];
  devices: Record<string, number>;
};

export class StatsError extends Error {}

/** Admin-only numbers for the stats page, from admin_stats(). */
export class StatsService {
  constructor(private readonly client: SupabaseClient | null) {}

  static shared(): StatsService {
    return new StatsService(supabase);
  }

  async report(days: number): Promise<StatsReport> {
    if (!this.client) throw new StatsError('Supabase is not configured.');
    const { data, error } = await this.client.rpc('admin_stats', { p_days: days });
    if (error) {
      if (/admin access required/i.test(error.message)) throw new StatsError('Only PayRead admins can see stats.');
      if (/admin_stats/i.test(error.message) && /(not find|does not exist)/i.test(error.message)) {
        throw new StatsError('Stats are not set up in the database yet: run the tracking migration in Supabase.');
      }
      throw new StatsError(`Could not load stats: ${error.message}`);
    }
    if (!data || typeof data !== 'object') throw new StatsError('Stats came back empty.');
    return data as StatsReport;
  }
}

/** Share of `part` in `whole` as a whole percent, or null when there is nothing to divide. */
export function percent(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}
