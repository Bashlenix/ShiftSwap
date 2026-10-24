import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { logInToLindenhof, openPage } from './helpers';

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test('Anna saves a preference and it survives a reload', async ({ page }) => {
  await logInToLindenhof(page, 'anna@shiftswap.test');
  await openPage(page, 'Availability', 'Availability');
  await expect(page.getByText('Loading…')).toHaveCount(0);

  const group = page.getByRole('group', { name: 'Wednesday evening' });
  await group.getByRole('radio', { name: 'Preferred' }).check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Preferences saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Availability' })).toBeVisible();
  await expect(
    page
      .getByRole('group', { name: 'Wednesday evening' })
      .getByRole('radio', { name: 'Preferred' }),
  ).toBeChecked();

  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
});

test('Availability, My shifts and Open offers fit a 320 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await logInToLindenhof(page, 'anna@shiftswap.test');
  for (const [nav, heading] of [
    ['Availability', 'Availability'],
    ['My shifts', 'My shifts'],
    ['Open offers', 'Open offers'],
  ]) {
    await openPage(page, nav, heading);
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  }
});
