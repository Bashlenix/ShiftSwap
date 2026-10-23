import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { logInToLindenhof, openPage } from './helpers';

// Runs after login.spec.ts (alphabetical order, one worker) against freshly seeded demo
// data. The tests change that data, so they depend on each other's order.
test.describe.configure({ mode: 'serial' });

const GIVE_AWAY_TIME = '18:00–23:00';
const BARISTA_TIME = '07:00–13:00';

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
}

test("Tom approves Lukas for Anna's give-away", async ({ page }) => {
  await logInToLindenhof(page, 'tom@shiftswap.test');
  await openPage(page, 'Offer review', 'Offer review');
  await page.getByRole('link', { name: new RegExp(`^Review .*${GIVE_AWAY_TIME}`) }).click();

  const detail = page.getByRole('region', { name: new RegExp(GIVE_AWAY_TIME) });
  await expect(detail.getByText('Lukas Wolf')).toBeVisible();
  await expect(detail.getByText('Mia Hoffmann')).toBeVisible();
  await expect(detail.getByText(/^Score \d+/)).toHaveCount(2);

  await detail.getByRole('button', { name: 'Approve Lukas Wolf' }).click();
  await expect(page.getByText('Approved Lukas Wolf.')).toBeVisible();
  await expect(detail.getByText(/Filled|Selected/).first()).toBeVisible();
});

test('Lukas now has the shift Tom approved', async ({ page }) => {
  await logInToLindenhof(page, 'lukas@shiftswap.test');
  await openPage(page, 'My shifts', 'My shifts');
  await expect(
    page.getByRole('rowheader', { name: new RegExp(GIVE_AWAY_TIME) }).first(),
  ).toBeVisible();
});

test('Lukas is not offered the Barista open shift', async ({ page }) => {
  await logInToLindenhof(page, 'lukas@shiftswap.test');
  await openPage(page, 'Open offers', 'Open offers');
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await expect(page.getByRole('rowheader', { name: new RegExp(BARISTA_TIME) })).toHaveCount(0);
});

test('Anna claims the open Barista shift', async ({ page }) => {
  await logInToLindenhof(page, 'anna@shiftswap.test');
  await openPage(page, 'Open offers', 'Open offers');
  const row = page.getByRole('row').filter({ hasText: BARISTA_TIME });
  await row.getByRole('button', { name: 'Claim' }).click();
  await expect(page.getByText('Done.')).toBeVisible();

  await openPage(page, 'My shifts', 'My shifts');
  // Anna already had the 07:00–13:00 Barista shift the day before; now there are two.
  await expect(page.getByRole('rowheader', { name: new RegExp(BARISTA_TIME) })).toHaveCount(2);
});

test('main screens have no serious or critical axe violations', async ({ page }) => {
  await logInToLindenhof(page, 'tom@shiftswap.test');
  for (const [nav, heading] of [
    ['My shifts', 'My shifts'],
    ['Open offers', 'Open offers'],
    ['Schedule', 'Schedule'],
    ['Offer review', 'Offer review'],
  ]) {
    await openPage(page, nav, heading);
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
  }
});
