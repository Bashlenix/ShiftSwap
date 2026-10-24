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

test('main screens (before any change) have no serious or critical axe violations', async ({
  page,
}) => {
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

test("Tom approves Lukas for Anna's give-away", async ({ page }) => {
  await logInToLindenhof(page, 'tom@shiftswap.test');
  await openPage(page, 'Offer review', 'Offer review');
  await page.getByRole('link', { name: new RegExp(`^Review .*${GIVE_AWAY_TIME}`) }).click();

  const detail = page.getByRole('region', { name: new RegExp(GIVE_AWAY_TIME) });
  await expect(detail.getByText('Lukas Wolf', { exact: true })).toBeVisible();
  await expect(detail.getByText('Mia Hoffmann', { exact: true })).toBeVisible();
  await expect(detail.getByText(/^Score \d+/)).toHaveCount(2);

  await expectNoSeriousAxeViolations(page);

  await detail.getByRole('button', { name: 'Approve Lukas Wolf' }).click();
  await expect(page.getByText('Approved Lukas Wolf.')).toBeVisible();
  await expect(detail.getByText(/^\W*Approved$/)).toBeVisible();
  await expect(detail.getByText(/^\W*Selected$/)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Approve Lukas Wolf' })).toHaveCount(0);
});

test('Lukas now has the shift Tom approved', async ({ page }) => {
  await logInToLindenhof(page, 'lukas@shiftswap.test');
  await openPage(page, 'My shifts', 'My shifts');
  await expect(
    page.getByRole('rowheader', { name: new RegExp(GIVE_AWAY_TIME) }).first(),
  ).toBeVisible();
  const acceptances = page.getByRole('region', { name: 'My acceptances' });
  await expect(
    acceptances.getByRole('row', { name: new RegExp(GIVE_AWAY_TIME) }).getByText(/^\W*Selected$/),
  ).toBeVisible();
});

test('Lukas is not offered the Barista open shift', async ({ page }) => {
  await logInToLindenhof(page, 'lukas@shiftswap.test');
  await openPage(page, 'Open offers', 'Open offers');
  // Wait for the list to render (table or empty state) before asserting absence.
  await expect(
    page
      .getByRole('table', { name: 'Open offers you can take' })
      .or(page.getByText('No open offers right now.')),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('rowheader', { name: new RegExp(BARISTA_TIME) })).toHaveCount(0);
});

test('Anna claims the open Barista shift', async ({ page }) => {
  await logInToLindenhof(page, 'anna@shiftswap.test');
  await openPage(page, 'Open offers', 'Open offers');
  const row = page.getByRole('row').filter({ hasText: BARISTA_TIME });
  await expect(row).toBeVisible();
  await expectNoSeriousAxeViolations(page);
  await row.getByRole('button', { name: 'Claim' }).click();
  await expect(page.getByText('Done.')).toBeVisible();

  await openPage(page, 'My shifts', 'My shifts');
  // Anna already had the 07:00–13:00 Barista shift the day before; now there are two.
  await expect(
    page
      .getByRole('table', { name: 'Your shifts in the next 14 days' })
      .getByRole('rowheader', { name: new RegExp(BARISTA_TIME) }),
  ).toHaveCount(2);
});
