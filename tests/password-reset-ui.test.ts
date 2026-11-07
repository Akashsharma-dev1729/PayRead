import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';

test('forgot password: request a link, expired link, mismatch, then a new password', { timeout: 20000 }, async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://payread.test/login?mode=reset' });
  for (const [key, value] of Object.entries({ React, window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  const { supabase } = await import('../lib/supabase');
  const { navigation } = await import('../lib/navigation');
  const { default: LoginPage } = await import('../app/login/page');
  const { default: ResetPage } = await import('../app/reset-password/page');
  const { render, waitFor, fireEvent, cleanup } = await import('@testing-library/react');

  const visits: string[] = [];
  navigation.go = (url: string) => { visits.push(url); };
  let session: unknown = null;
  const resets: unknown[][] = [];
  const updates: unknown[] = [];
  let updateError: { message: string } | null = null;
  Object.defineProperty(supabase!.auth, 'getSession', { value: async () => ({ data: { session }, error: null }) });
  Object.defineProperty(supabase!.auth, 'onAuthStateChange', { value: () => ({ data: { subscription: { unsubscribe() {} } } }) });
  Object.defineProperty(supabase!.auth, 'resetPasswordForEmail', { value: async (...args: unknown[]) => { resets.push(args); return { data: {}, error: null }; } });
  Object.defineProperty(supabase!.auth, 'updateUser', { value: async (args: unknown) => { updates.push(args); return { data: {}, error: updateError }; } });

  try {
    // Request a link: opened directly in reset mode, no password field, never reveals accounts.
    let view = render(React.createElement(LoginPage));
    await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Reset your password' })));
    assert.equal(view.queryByLabelText('Password'), null);
    fireEvent.change(view.getByLabelText('Email'), { target: { value: 'nope' } });
    fireEvent.click(view.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => assert.ok(view.getByText('Enter a valid email address.')));
    assert.equal(resets.length, 0);
    fireEvent.change(view.getByLabelText('Email'), { target: { value: ' Asha@Example.com ' } });
    fireEvent.click(view.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => assert.ok(view.getByText(/If Asha@Example.com has a PayRead account, a reset link is on its way/)));
    assert.deepEqual(resets[0], ['asha@example.com', { redirectTo: 'https://payread.test/reset-password' }]);
    fireEvent.click(view.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => assert.ok(view.getByRole('heading', { name: 'Welcome back' })));
    assert.ok(view.getByRole('button', { name: 'Forgot password?' }));
    cleanup();

    // The emailed link expired: no session, so offer a new link instead of a form.
    view = render(React.createElement(ResetPage));
    await waitFor(() => assert.ok(view.getByText(/invalid or has expired/)));
    assert.equal(view.getByRole('link', { name: 'Send a new link' }).getAttribute('href'), '/login?mode=reset');
    cleanup();

    // A valid link signs the reader in: mismatch and reuse are explained, then success.
    session = { user: { id: 'u1', email: 'asha@example.com', user_metadata: {} }, access_token: 'jwt' };
    view = render(React.createElement(ResetPage));
    await waitFor(() => assert.ok(view.getByLabelText('New password')));
    fireEvent.change(view.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.change(view.getByLabelText('Repeat new password'), { target: { value: 'brand-new-pasS' } });
    fireEvent.click(view.getByRole('button', { name: 'Save new password' }));
    await waitFor(() => assert.ok(view.getByText('The two passwords do not match.')));
    assert.equal(updates.length, 0);
    updateError = { message: 'New password should be different from the old password.' };
    fireEvent.change(view.getByLabelText('Repeat new password'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(view.getByRole('button', { name: 'Save new password' }));
    await waitFor(() => assert.ok(view.getByText('Choose a password different from your current one.')));
    updateError = null;
    fireEvent.click(view.getByRole('button', { name: 'Save new password' }));
    await waitFor(() => assert.deepEqual(visits, ['/account']));
    assert.deepEqual(updates.at(-1), { password: 'brand-new-pass' });
  } finally {
    cleanup();
    supabase!.auth.stopAutoRefresh();
    (supabase!.auth as unknown as { broadcastChannel?: BroadcastChannel }).broadcastChannel?.close();
    dom.window.close();
  }
});
