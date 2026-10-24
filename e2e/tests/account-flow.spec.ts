import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, logIn, paceSignIn } from './helpers';

// Each case signs up its own user, so nothing here touches the seeded demo data.
test.describe.configure({ mode: 'serial' });

async function signUp(page: Page, email: string, name: string) {
  await page.goto('/signup');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await paceSignIn(page);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
}

async function openDeleteDialog(page: Page) {
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete account…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  return dialog;
}

test('Case A: a user without organisations deletes the account', async ({ page }) => {
  const email = `del-${Date.now()}@example.test`;
  await signUp(page, email, 'Delete Me');

  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Delete account…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' });
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete my account' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Your account was deleted.')).toBeVisible();

  await logIn(page, email, PASSWORD);
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
});

test('Case B: the last admin of an organisation cannot delete the account', async ({ page }) => {
  const stamp = Date.now();
  const orgName = `Del Org ${stamp}`;
  await signUp(page, `del-${stamp}@example.test`, 'Last Admin');

  await page.getByRole('link', { name: 'Create organisation' }).click();
  await page.getByLabel('Name').fill(orgName);
  await page.getByRole('button', { name: 'Create organisation' }).click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+/);

  const dialog = await openDeleteDialog(page);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(dialog.getByRole('alert')).toContainText(`You are the last admin of ${orgName}.`);
});
