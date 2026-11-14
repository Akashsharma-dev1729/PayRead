import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type EventName = 'page_view' | 'article_read' | 'paywall_view' | 'checkout_open' | 'upi_submitted';

export type Attribution = { source: string | null; medium: string | null; campaign: string | null };

type Env = {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  location: { href: string; hostname: string; pathname: string };
  referrer: string;
  userAgent: string;
};

const SESSION_KEY = 'payread_sid';
const SOURCE_KEY = 'payread_src';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Known hosts mapped to a readable source name. */
const KNOWN_SOURCES: [RegExp, string][] = [
  [/(^|\.)quora\.com$/, 'quora'], [/(^|\.)medium\.com$/, 'medium'], [/(^|\.)substack\.com$/, 'substack'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'], [/(^|\.)(twitter|x)\.com$|^t\.co$/, 'x'],
  [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)whatsapp\.com$|^wa\.me$/, 'whatsapp'], [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)google\./, 'google'], [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'youtube'], [/(^|\.)t\.me$|(^|\.)telegram\.org$/, 'telegram'],
];

function cleanTag(value: string | null): string | null {
  const clean = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9._ -]/g, '').slice(0, 60);
  return clean || null;
}

export function sourceFromReferrer(referrer: string, ownHost: string): string | null {
  if (!referrer) return null;
  let host: string;
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return null; }
  const bare = (h: string) => h.replace(/^www\./, '');
  if (!host || bare(host) === bare(ownHost.toLowerCase())) return null;
  for (const [pattern, name] of KNOWN_SOURCES) if (pattern.test(host)) return name;
  return cleanTag(bare(host));
}

export function deviceOf(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/**
 * Anonymous funnel tracking. One random id per browser-tab session, where the
 * visitor came from (UTM tags or the referring site), and a handful of named
 * events. Nothing personal is sent, and nothing here can break the page: every
 * failure is swallowed.
 */
export class Tracker {
  private readonly sent = new Set<string>();
  private sessionId: string | null = null;
  private attribution: Attribution | null = null;

  constructor(private readonly client: SupabaseClient | null, private readonly env: () => Env | null) {}

  static browser(): Tracker {
    return new Tracker(supabase, () => {
      if (typeof window === 'undefined') return null;
      let storage: Storage | null = null;
      try { storage = window.sessionStorage; } catch { storage = null; }
      return { storage, location: window.location, referrer: document.referrer, userAgent: navigator.userAgent };
    });
  }

  private session(env: Env): string {
    if (this.sessionId) return this.sessionId;
    let id: string | null = null;
    try { id = env.storage?.getItem(SESSION_KEY) ?? null; } catch { id = null; }
    if (!id || !UUID.test(id)) {
      id = crypto.randomUUID();
      try { env.storage?.setItem(SESSION_KEY, id); } catch { /* private mode: one id per page */ }
    }
    this.sessionId = id;
    return id;
  }

  /** Decided once per session, on the landing page: UTM tags win, then the referrer. */
  attributionFor(env: Env): Attribution {
    if (this.attribution) return this.attribution;
    try {
      const saved = env.storage?.getItem(SOURCE_KEY);
      if (saved) { this.attribution = JSON.parse(saved) as Attribution; return this.attribution; }
    } catch { /* recompute */ }
    let params: URLSearchParams | null = null;
    try { params = new URL(env.location.href).searchParams; } catch { params = null; }
    const utmSource = cleanTag(params?.get('utm_source') ?? null);
    const attribution: Attribution = {
      source: utmSource ?? sourceFromReferrer(env.referrer, env.location.hostname),
      medium: cleanTag(params?.get('utm_medium') ?? null) ?? (utmSource ? null : env.referrer && sourceFromReferrer(env.referrer, env.location.hostname) ? 'referral' : null),
      campaign: cleanTag(params?.get('utm_campaign') ?? null),
    };
    this.attribution = attribution;
    try { env.storage?.setItem(SOURCE_KEY, JSON.stringify(attribution)); } catch { /* fine */ }
    return attribution;
  }

  /**
   * Sends an event once per page load for the same name and article (repeat
   * renders and React Strict Mode do not double count). Resolves to whether it
   * was sent; never rejects.
   */
  async track(name: EventName, options: { articleId?: string | null } = {}): Promise<boolean> {
    try {
      const env = this.env();
      if (!env || !this.client) return false;
      const key = `${name}:${options.articleId ?? ''}:${name === 'page_view' ? env.location.pathname : ''}`;
      if (this.sent.has(key)) return false;
      this.sent.add(key);
      const from = this.attributionFor(env);
      const { error } = await this.client.rpc('track_event', {
        p_session: this.session(env),
        p_name: name,
        p_path: env.location.pathname.slice(0, 200),
        p_article: options.articleId && UUID.test(options.articleId) ? options.articleId : null,
        p_source: from.source,
        p_medium: from.medium,
        p_campaign: from.campaign,
        p_device: deviceOf(env.userAgent),
      });
      return !error;
    } catch {
      return false;
    }
  }
}

let shared: Tracker | null = null;
/** The page's tracker. Calls are fire-and-forget. */
export function track(name: EventName, options: { articleId?: string | null } = {}): void {
  shared ??= Tracker.browser();
  void shared.track(name, options);
}
