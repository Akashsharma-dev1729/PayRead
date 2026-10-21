import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Seeded by the workflow: the five migrations (production upgrade path) create five
// free articles and one ₹100 article; one extra ₹49 article is inserted.
const FREE = '71000000-0000-4000-8000-000000000001';
const PAID = '71000000-0000-4000-8000-000000000100';
const PAID_TITLE = 'From Idea to Finished Project';
const PAID_BODY = 'Start by describing one person and one task';
const PAID2 = '10000000-0000-4000-8000-0000000000e2';
const PAID2_BODY = 'SECOND PAID BODY';
const ADMIN = { email: 'admin@payread.test', password: 'admin-pass-123' };
const RUN = Date.now().toString(36);
const ASHA = { name: 'Asha Reader', email: `asha.${RUN}@payread.test`, password: 'asha-pass-123' };
const RAVI = { name: 'Ravi Second', email: `ravi.${RUN}@payread.test`, password: 'ravi-pass-123' };
const UTR_A = '412345678901';
const UTR_B = '512345678901';
const SHOTS = 'e2e-output';
mkdirSync(SHOTS, { recursive: true });

const pageErrors: string[] = [];
async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && /hydrat/i.test(m.text())) pageErrors.push(`${page.url()}: ${m.text()}`); });
  return { context, page };
}

async function buyWithUpi(page: Page, priceLabel: string, utr: string) {
  await page.goto('/');
  await page.getByRole('button', { name: `Read for ${priceLabel}` }).click();
  await page.getByRole('button', { name: 'Use manual UPI instead' }).click();
  const link = page.getByRole('link', { name: 'Pay with UPI' });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  expect(href).toMatch(/^upi:\/\/pay\?pa=ci@upi&pn=PayRead&am=\d+\.\d{2}&cu=INR&tn=PayRead%20PR[0-9A-Z]+$/);
  await page.getByLabel(/12-digit UPI transaction ID/).fill(utr.replace(/(\d{4})(?=\d)/g, '$1 '));
  await page.getByRole('button', { name: "I've paid" }).click();
}

async function adminApprove(admin: Page, utr: string) {
  await admin.goto('/admin');
  const email = admin.getByPlaceholder('Email');
  const heading = admin.getByRole('heading', { name: 'Pending payments' });
  await expect(email.or(heading)).toBeVisible();
  if (await email.isVisible()) {
    await email.fill(ADMIN.email);
    await admin.getByPlaceholder('Password').fill(ADMIN.password);
    await admin.getByRole('button', { name: 'Sign in' }).click();
  }
  await expect(heading).toBeVisible();
  await admin.getByRole('button', { name: 'Refresh' }).click();
  const row = admin.getByRole('row', { name: new RegExp(utr) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByRole('row', { name: new RegExp(utr) })).toHaveCount(0);
}

async function signUp(page: Page, who: typeof ASHA) {
  await page.goto('/login?mode=signup');
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await page.waitForURL('**/account');
}

async function signIn(page: Page, who: { email: string; password: string }, path = '/login') {
  await page.goto(path);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
}

test.describe.serial('stage 1: accounts on top of the UPI flow', () => {
  let browserA: { context: BrowserContext; page: Page };
  let adminTab: { context: BrowserContext; page: Page };
  let deviceB: { context: BrowserContext; page: Page };

  test.beforeAll(async ({ browser }) => {
    browserA = await newPage(browser);
    adminTab = await newPage(browser);
    deviceB = await newPage(browser);
  });

  test('1. anonymous reader: free reads open, paid ones are locked, header offers sign-in', async () => {
    const { page } = browserA;
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Read free' })).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Read for ₹100.00' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read for ₹49.00' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });
    await page.goto(`/article/${FREE}`);
    await expect(page.getByText('A reading habit does not have to begin')).toBeVisible();
    await page.goto(`/article/${PAID}`);
    await expect(page.getByRole('heading', { name: 'Article locked' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bought it on another device? Sign in' })).toBeVisible();
  });

  test('2. anonymous UPI purchase: UTR, admin approval, article unlocks by itself', async () => {
    const { page } = browserA;
    await buyWithUpi(page, '₹100.00', UTR_A);
    await expect(page.getByText(`Payment submitted with UPI transaction ID ${UTR_A}`)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-utr-submitted.png` });
    await adminApprove(adminTab.page, UTR_A);
    await page.waitForURL(`**/article/${PAID}`, { timeout: 60_000 });
    await expect(page.getByText(PAID_BODY)).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Read', exact: true })).toBeVisible();
  });

  test('3. signing up on that browser attaches the purchase to the new account', async () => {
    const { page } = browserA;
    await signUp(page, ASHA);
    await expect(page.getByRole('heading', { name: `Hello, ${ASHA.name}` })).toBeVisible();
    const item = page.getByRole('listitem').filter({ hasText: PAID_TITLE });
    await expect(item.getByText('Unlocked')).toBeVisible();
    await expect(page.getByRole('link', { name: `Hi, ${ASHA.name}` })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-account.png`, fullPage: true });
  });

  test('4. another device: sign in and the purchase opens there too', async () => {
    const { page } = deviceB;
    await page.goto(`/article/${PAID}`);
    await expect(page.getByRole('heading', { name: 'Article locked' })).toBeVisible();
    await page.getByRole('link', { name: 'Bought it on another device? Sign in' }).click();
    await page.screenshot({ path: `${SHOTS}/04-login.png` });
    await page.getByLabel('Email').fill(ASHA.email);
    await page.getByLabel('Password').fill(ASHA.password);
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForURL(`**/article/${PAID}`);
    await expect(page.getByText(PAID_BODY)).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Read', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read for ₹49.00' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read for ₹100.00' })).toHaveCount(0);
  });

  test('5. signed-in purchase on device B is listed in the account after approval', async () => {
    const { page } = deviceB;
    await buyWithUpi(page, '₹49.00', UTR_B);
    await expect(page.getByText(`Payment submitted with UPI transaction ID ${UTR_B}`)).toBeVisible();
    await page.goto('/account');
    await expect(page.getByRole('listitem').filter({ hasText: 'Second Paid Read' }).getByText('Waiting for confirmation')).toBeVisible();
    await adminApprove(adminTab.page, UTR_B);
    await page.goto(`/article/${PAID2}`);
    await expect(page.getByText(PAID2_BODY)).toBeVisible();
    await page.goto('/account');
    await expect(page.getByText('Unlocked')).toHaveCount(2);
  });

  test('6. renaming updates the profile and the header', async () => {
    const { page } = deviceB;
    await page.goto('/account');
    await page.getByLabel('Display name').fill('Asha R');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hello, Asha R' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hi, Asha R' })).toBeVisible();
  });

  test('7. a second reader is isolated and cannot reuse an approved UPI transaction ID', async ({ browser }) => {
    const { page, context } = await newPage(browser);
    await signUp(page, RAVI);
    await expect(page.getByText('Nothing unlocked yet.')).toBeVisible();
    await page.goto(`/article/${PAID}`);
    await expect(page.getByRole('heading', { name: 'Article locked' })).toBeVisible();
    await buyWithUpi(page, '₹100.00', UTR_A);
    await expect(page.getByText('This UPI transaction ID is already attached to another purchase')).toBeVisible();
    await context.close();
  });

  test('8. signing out removes access from that browser; signing back in restores it', async () => {
    const { page } = browserA;
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read for ₹100.00' })).toBeVisible();
    await page.goto(`/article/${PAID}`);
    await expect(page.getByRole('heading', { name: 'Article locked' })).toBeVisible();
    await signIn(page, ASHA, `/login?next=${encodeURIComponent(`/article/${PAID}`)}`);
    await page.waitForURL(`**/article/${PAID}`);
    await expect(page.getByText(PAID_BODY)).toBeVisible();
  });

  test('9. login never redirects off-site and bad credentials are explained', async ({ browser }) => {
    const { page, context } = await newPage(browser);
    await signIn(page, { email: RAVI.email, password: 'wrong-password' }, '/login?next=https%3A%2F%2Fevil.example');
    await expect(page.getByText('Wrong email or password.')).toBeVisible();
    await page.getByLabel('Password').fill(RAVI.password);
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForURL('**/account');
    expect(new URL(page.url()).host).toBe('localhost:3000');
    await page.goto('/login?next=%2F%2Fevil.example');
    await page.waitForURL('**/account');
    await context.close();
  });

  test('10. admin signs in from the reader login and reaches the dashboard', async ({ browser }) => {
    const { page, context } = await newPage(browser);
    await signIn(page, ADMIN);
    await page.waitForURL('**/account');
    await page.getByRole('link', { name: 'Admin dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Pending payments' })).toBeVisible();
    await context.close();
  });

  test.afterAll(async () => {
    await browserA?.context.close();
    await adminTab?.context.close();
    await deviceB?.context.close();
  });

  test('11. no uncaught errors or hydration errors on any page', async () => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
