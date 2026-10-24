import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { logIn, PASSWORD, paceSignIn } from './helpers';

test('Anna logs in with the README credentials and sees her organisation', async ({ page }) => {
  await logIn(page, 'anna@shiftswap.test', PASSWORD);
  await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Café Lindenhof/ })).toBeVisible();
});

// Regression: a cold start at / redirects to /login, and the first click on "Log in" used to
// bounce back to an empty login form.
test('cold start at / redirects to login and one click logs Anna in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill('anna@shiftswap.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await paceSignIn(page);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
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
