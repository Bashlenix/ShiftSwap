import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'ShiftSwap-Demo-2026';
// Better Auth allows 3 sign-ins per client IP, and the counter only resets after 10s
// without a sign-in. So: up to 3 attempts back to back, then a quiet gap. The suite
// starts with a gap because earlier CI steps (smoke test) also sign in.
const MAX_BURST = 3;
const QUIET_MS = 11_000;
let burst = MAX_BURST;
let lastSignIn = Date.now();

async function paceSignIn(page: Page) {
  if (Date.now() - lastSignIn >= QUIET_MS) burst = 0;
  if (burst >= MAX_BURST) {
    const wait = lastSignIn + QUIET_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    burst = 0;
  }
  burst++;
  lastSignIn = Date.now();
}

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await paceSignIn(page);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('Anna logs in with the README credentials and sees her organisation', async ({ page }) => {
  await logIn(page, 'anna@shiftswap.test', PASSWORD);
  await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Café Lindenhof/ })).toBeVisible();
});

test('Lukas sees both organisations', async ({ page }) => {
  await logIn(page, 'lukas@shiftswap.test', PASSWORD);
  await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Café Lindenhof/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Hotel Seeblick/ })).toBeVisible();
});

test('Log out returns to the login page and ends the session', async ({ page }) => {
  await logIn(page, 'mia@shiftswap.test', PASSWORD);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/orgs');
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows a generic error', async ({ page }) => {
  await logIn(page, 'anna@shiftswap.test', 'not-the-password');
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
});

test('login page has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/login');
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
});
