import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

test('auth helpers validate input, hide provider internals and only allow same-site redirects', async () => {
  const { AuthService, safeNextPath } = await import('../lib/auth/auth-service');
  assert.equal(AuthService.normalizeEmail('  Daniel@Example.COM '), 'daniel@example.com');
  assert.throws(() => AuthService.normalizeEmail('not-an-email'), /valid email/);
  assert.throws(() => AuthService.checkPassword('short'), /at least 8/);
  assert.throws(() => AuthService.checkDisplayName('   '), /between 1 and 60/);
  assert.equal(AuthService.friendly({ message: 'Invalid login credentials' }), 'Wrong email or password.');
  assert.match(AuthService.friendly({ message: 'Email not confirmed' }), /Confirm your email/);
  assert.match(AuthService.friendly({ message: 'internal stack trace xyz' }), /Something went wrong/);
  assert.equal(safeNextPath('/article/abc?x=1'), '/article/abc?x=1');
  for (const bad of [null, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)']) {
    assert.equal(safeNextPath(bad), '/account');
  }
});

test('login, sign-up, account purchases and owned articles', { timeout: 20000 }, async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://payread.test/login?next=%2Farticle%2F10000000-0000-4000-8000-000000000001' });
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  const { supabase } = await import('../lib/supabase');
  const { navigation } = await import('../lib/navigation');
  const { default: LoginPage } = await import('../app/login/page');
  const { default: AccountPage } = await import('../app/account/page');
  const { default: Home } = await import('../app/page');
  const { render, waitFor, fireEvent, cleanup, act } = await import('@testing-library/react');

  const visits: string[] = [];
  navigation.go = (url: string) => { visits.push(url); };
  const user = { id: '30000000-0000-4000-8000-000000000002', email: 'daniel@example.com', user_metadata: { display_name: 'Daniel' } };
  const signedIn = { user, access_token: 'jwt' };
  let session: unknown = null;
  let listener: (event: string, s: unknown) => void = () => {};
  const signIns: unknown[] = [];
  const signUps: unknown[] = [];
  const rpcs: { name: string; args: unknown }[] = [];
  const paid = { id: '10000000-0000-4000-8000-000000000001', title: 'Deep Work', excerpt: 'Focus.', price_paise: 10000, published: true };
  const other = { id: '10000000-0000-4000-8000-000000000002', title: 'Second paid', excerpt: 'More.', price_paise: 4900, published: true };

  Object.defineProperty(supabase!.auth, 'getSession', { value: async () => ({ data: { session }, error: null }) });
  Object.defineProperty(supabase!.auth, 'onAuthStateChange', { value: (fn: typeof listener) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; } });
  Object.defineProperty(supabase!.auth, 'signInWithPassword', { value: async (args: { password: string }) => {
    signIns.push(args);
    if (args.password !== 'correct-horse') return { data: { session: null }, error: { message: 'Invalid login credentials', status: 400 } };
    session = signedIn; return { data: { session: signedIn }, error: null };
  } });
  Object.defineProperty(supabase!.auth, 'signUp', { value: async (args: unknown) => { signUps.push(args); return { data: { session: null, user: { id: 'x' } }, error: null }; } });
  Object.defineProperty(supabase!.auth, 'signOut', { value: async () => { session = null; return { error: null }; } });
  Object.defineProperty(supabase, 'rpc', { value: async (name: string, args: unknown) => {
    rpcs.push({ name, args });
    if (name === 'claim_purchases') return { data: 1, error: null };
    if (name === 'my_purchases') return { data: [
      { payment_id: 'p1', article_id: paid.id, article_title: paid.title, amount_paise: 10000, status: 'completed', provider: 'manual_upi', created_at: '2026-10-20T08:00:00Z', completed_at: '2026-10-20T09:00:00Z' },
      { payment_id: 'p2', article_id: other.id, article_title: other.title, amount_paise: 4900, status: 'pending', provider: 'manual_upi', created_at: '2026-10-21T08:00:00Z', completed_at: null },
    ], error: null };
    if (name === 'get_my_profile') return { data: [{ display_name: 'Daniel', role: 'reader', bio: '', is_admin: false }], error: null };
    if (name === 'update_my_profile') return { data: null, error: null };
    if (name === 'list_published_articles') return { data: [paid, other], error: null };
    throw new Error(`Unexpected call: ${name}`);
  } });

  try {
    // --- Sign in: friendly error, then success redirects to the safe ?next path.
    let view = render(React.createElement(LoginPage));
    fireEvent.change(view.getByLabelText('Email'), { target: { value: ' Daniel@Example.com ' } });
    fireEvent.change(view.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => assert.ok(view.getByText('Wrong email or password.')));
    assert.deepEqual(visits, []);
    fireEvent.change(view.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(view.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => assert.deepEqual(visits, ['/article/10000000-0000-4000-8000-000000000001']));
    assert.equal((signIns[1] as { email: string }).email, 'daniel@example.com');
    await act(async () => listener('SIGNED_IN', signedIn));
    assert.equal(visits.length, 1, 'never redirects twice');
    cleanup();

    // --- Sign up with email confirmation on: no session, so ask to confirm.
    session = null; visits.length = 0;
    view = render(React.createElement(LoginPage));
    fireEvent.click(view.getByRole('button', { name: 'Create account' }));
    fireEvent.change(view.getByLabelText('Your name'), { target: { value: 'Asha' } });
    fireEvent.change(view.getByLabelText('Email'), { target: { value: 'asha@example.com' } });
    fireEvent.change(view.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(view.getAllByRole('button', { name: 'Create account' }).at(-1)!);
    await waitFor(() => assert.ok(view.getByText(/at least 8 characters for your password/)));
    assert.equal(signUps.length, 0);
    fireEvent.change(view.getByLabelText('Password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(view.getAllByRole('button', { name: 'Create account' }).at(-1)!);
    await waitFor(() => assert.ok(view.getByText(/Check asha@example.com for a confirmation link/)));
    const sent = signUps[0] as { options: { data: { display_name: string } } };
    assert.equal(sent.options.data.display_name, 'Asha');
    assert.deepEqual(visits, []);
    cleanup();

    // --- Account: browser purchases are claimed by token, then listed.
    session = signedIn; rpcs.length = 0;
    const browserToken = '20000000-0000-4000-8000-0000000000aa';
    localStorage.setItem('payread_access', JSON.stringify({ [paid.id]: browserToken, junk: 42 }));
    view = render(React.createElement(AccountPage));
    await waitFor(() => assert.ok(view.getByText('Hello, Daniel')));
    await waitFor(() => assert.ok(view.getByText('Waiting for confirmation')));
    assert.deepEqual(rpcs.find((r) => r.name === 'claim_purchases')!.args, { p_tokens: [browserToken] });
    assert.ok(rpcs.findIndex((r) => r.name === 'claim_purchases') < rpcs.findIndex((r) => r.name === 'my_purchases'));
    assert.equal(view.getByRole('link', { name: 'Read' }).getAttribute('href'), `/article/${paid.id}`);
    fireEvent.click(view.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => assert.deepEqual(visits, ['/']));
    cleanup();

    // --- Home: an article owned through the account says "Read", not a price.
    localStorage.clear(); session = signedIn;
    view = render(React.createElement(Home));
    await waitFor(() => assert.ok(view.getByRole('link', { name: 'Read' })));
    assert.equal(view.getByRole('link', { name: 'Read' }).getAttribute('href'), `/article/${paid.id}`);
    assert.ok(view.getByRole('button', { name: 'Read for ₹49.00' }), 'unpaid article still offers checkout');
    assert.equal(view.queryByRole('button', { name: 'Read for ₹100.00' }), null);
    assert.ok(view.getByRole('link', { name: 'Hi, Daniel' }));
  } finally {
    cleanup();
    supabase!.auth.stopAutoRefresh();
    (supabase!.auth as unknown as { broadcastChannel?: BroadcastChannel }).broadcastChannel?.close();
    dom.window.close();
  }
});
