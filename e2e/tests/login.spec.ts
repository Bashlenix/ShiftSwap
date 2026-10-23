import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'ShiftSwap-Demo-2026';
// The API allows 3 sign-ins per 10s per client IP. One attempt every 4s stays under that
// regardless of test order, so the suite never hits 429.
const MIN_GAP_MS = 4_000;
let lastSignIn = Date.now();

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const wait = lastSignIn + MIN_GAP_MS - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  lastSignIn = Date.now();
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
