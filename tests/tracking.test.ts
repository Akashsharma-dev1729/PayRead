import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
}

test('tracker: UTM tags or referrer decide the source once per session; events dedupe; failures never throw', async () => {
  const { Tracker, sourceFromReferrer, deviceOf } = await import('../lib/analytics/tracker');
  assert.equal(sourceFromReferrer('https://www.quora.com/What-is-x', 'www.signal.org.in'), 'quora');
  assert.equal(sourceFromReferrer('https://l.facebook.com/l.php', 'signal.org.in'), 'facebook');
  assert.equal(sourceFromReferrer('https://signal.org.in/article/1', 'www.signal.org.in'), null, 'own site is not a source');
  assert.equal(sourceFromReferrer('https://blog.example.com/post', 'signal.org.in'), 'blog.example.com');
  assert.equal(sourceFromReferrer('not a url', 'signal.org.in'), null);
  assert.equal(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'), 'mobile');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X200) Safari/537.36'), 'tablet');
  assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop');

  const calls: Record<string, unknown>[] = [];
  let fail = false;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    if (fail) throw new Error('network down');
    calls.push({ name, ...args }); return { data: null, error: null };
  } };
  const storage = memoryStorage();
  let href = 'https://www.signal.org.in/?utm_source=Quora&utm_medium=answer&utm_campaign=Launch%20Week';
  const env = () => ({ storage, location: { href, hostname: 'www.signal.org.in', pathname: new URL(href).pathname },
    referrer: 'https://www.google.com/', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracker = new Tracker(client as any, env);
  assert.equal(await tracker.track('page_view'), true);
  assert.equal(await tracker.track('page_view'), false, 'one page_view per page load');
  href = 'https://www.signal.org.in/article/10000000-0000-4000-8000-000000000001';
  assert.equal(await tracker.track('paywall_view', { articleId: '10000000-0000-4000-8000-000000000001' }), true);
  assert.equal(await tracker.track('checkout_open', { articleId: 'not-a-uuid' }), true);
  assert.equal(calls.length, 3);
  const [first, second, third] = calls;
  assert.equal(first.name, 'track_event');
  assert.deepEqual([first.p_name, first.p_path, first.p_source, first.p_medium, first.p_campaign, first.p_device],
    ['page_view', '/', 'quora', 'answer', 'launch week', 'desktop']);
  assert.equal(second.p_source, 'quora', 'source sticks for the whole session even without UTM tags');
  assert.equal(second.p_article, '10000000-0000-4000-8000-000000000001');
  assert.equal(third.p_article, null);
  assert.equal(new Set(calls.map((c) => c.p_session)).size, 1);
  assert.match(String(first.p_session), /^[0-9a-f-]{36}$/);

  // A new tab session landing from Medium without tags: the referrer decides.
  const tab2 = memoryStorage();
  href = 'https://www.signal.org.in/';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t2 = new Tracker(client as any, () => ({ ...env(), storage: tab2, referrer: 'https://medium.com/@someone/post' }));
  await t2.track('page_view');
  assert.deepEqual([calls.at(-1)!.p_source, calls.at(-1)!.p_medium], ['medium', 'referral']);
  assert.notEqual(calls.at(-1)!.p_session, first.p_session);

  fail = true;
  assert.equal(await tracker.track('upi_submitted', { articleId: '10000000-0000-4000-8000-000000000001' }), false, 'errors are swallowed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(await new Tracker(null, env).track('page_view'), false);
  assert.equal(await new Tracker(client as any, () => null).track('page_view'), false); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test('stats page: admins see tiles, funnel and tables; others are turned away', { timeout: 20000 }, async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://payread.test/admin/stats' });
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  const { supabase } = await import('../lib/supabase');
  const { default: StatsPage } = await import('../app/admin/stats/page');
  const { render, waitFor, fireEvent, cleanup } = await import('@testing-library/react');
  let isAdmin = true;
  const asked: unknown[] = [];
  const session = { user: { id: 'u1', email: 'owner@example.com', user_metadata: { display_name: 'Owner' } }, access_token: 'jwt' };
  Object.defineProperty(supabase!.auth, 'getSession', { value: async () => ({ data: { session }, error: null }) });
  Object.defineProperty(supabase!.auth, 'onAuthStateChange', { value: () => ({ data: { subscription: { unsubscribe() {} } } }) });
  const report = (days: number) => ({
    days, since: '2026-10-16T00:00:00Z', sessions: 120, page_views: 340, signups: 9, purchases: 4, revenue_paise: 40000, awaiting_review: 2,
    all_time: { accounts: 15, purchases: 6, revenue_paise: 60000 },
    funnel: { visited: 120, opened_article: 60, started_checkout: 12, submitted_upi: 5, paid: 4 },
    daily: [{ day: '2026-11-13', sessions: 20, page_views: 50, purchases: 1 }, { day: '2026-11-14', sessions: 40, page_views: 90, purchases: 2 }],
    top_articles: [{ id: '10000000-0000-4000-8000-000000000001', title: 'Deep Work', price_paise: 10000, opened: 40, checkouts: 12, purchases: 4 }],
    top_sources: [{ source: 'quora', sessions: 70, checkouts: 9, upi_submitted: 4 }, { source: 'direct', sessions: 50, checkouts: 3, upi_submitted: 1 }],
    devices: { mobile: 90, desktop: 30 },
  });
  Object.defineProperty(supabase, 'rpc', { value: async (name: string, args: { p_days?: number }) => {
    if (name === 'get_my_profile') return { data: [{ display_name: 'Owner', role: 'reader', bio: '', is_admin: isAdmin }], error: null };
    if (name === 'admin_stats') { asked.push(args.p_days); return { data: report(args.p_days!), error: null }; }
    if (name === 'track_event') return { data: null, error: null };
    throw new Error(`Unexpected call: ${name}`);
  } });
  try {
    let view = render(React.createElement(StatsPage));
    await waitFor(() => assert.ok(view.getByText('₹400.00')));
    assert.ok(view.getByText('120', { selector: '.stat-value' }));
    assert.ok(view.getByText('Started checkout'));
    assert.ok(view.getByText(/· 20%/), 'checkout is 20% of article openers');
    assert.ok(view.getByText('quora'));
    assert.equal(view.getByRole('link', { name: 'Deep Work' }).getAttribute('href'), '/article/10000000-0000-4000-8000-000000000001');
    assert.deepEqual(asked, [30]);
    fireEvent.click(view.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => assert.deepEqual(asked, [30, 7]));
    cleanup();

    isAdmin = false; asked.length = 0;
    view = render(React.createElement(StatsPage));
    await waitFor(() => assert.ok(view.getByText('Only PayRead admins can see stats.')));
    assert.deepEqual(asked, [], 'non-admins never request stats');
  } finally {
    cleanup();
    supabase!.auth.stopAutoRefresh();
    (supabase!.auth as unknown as { broadcastChannel?: BroadcastChannel }).broadcastChannel?.close();
    dom.window.close();
  }
});
