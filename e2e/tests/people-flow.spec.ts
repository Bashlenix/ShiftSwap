import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, logInToLindenhof, openPage, paceSignIn } from './helpers';

// Runs in the chromium-people project, which depends on the chromium project (see
// playwright.config.ts), so it starts only after swap-flow.spec.ts has finished against the
// same seeded demo data. The tests in this file depend on each other's order.
test.describe.configure({ mode: 'serial' });

const NEW_HIRE_EMAIL = `newhire+${Date.now()}@shiftswap.test`;
const NEW_HIRE_NAME = 'Nora Newhire';

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')),
  ).toEqual([]);
}

/** Polls Mailpit (served through the web proxy) until the invite mail for `email` has arrived. */
async function inviteLinkFromMailpit(page: Page, email: string): Promise<string> {
  let link = '';
  await expect(async () => {
    const search = await page.request.get(
      `/mailpit/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    expect(search.ok()).toBe(true);
    const found = (await search.json()) as { messages?: { ID: string }[] };
    expect(found.messages?.length ?? 0).toBeGreaterThan(0);
    const message = await page.request.get(`/mailpit/api/v1/message/${found.messages![0].ID}`);
    expect(message.ok()).toBe(true);
    const body = (await message.json()) as { Text?: string; HTML?: string };
    const match = `${body.Text ?? ''}\n${body.HTML ?? ''}`.match(
      /https?:\/\/[^\s"'<>]+\/invites\/[\w-]+/,
    );
    expect(match).not.toBeNull();
    link = match![0];
  }).toPass({ timeout: 20_000, intervals: [500, 1000, 2000] });
  return link;
}

test('Maria invites a new person who creates an account and joins', async ({ page }) => {
  await logInToLindenhof(page, 'maria@shiftswap.test');
  await openPage(page, 'Members', 'Members');
  await page.getByRole('button', { name: 'Add person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(NEW_HIRE_NAME);
  await dialog.getByLabel('Email (optional)').fill(NEW_HIRE_EMAIL);
  await dialog.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText(`Invite sent to ${NEW_HIRE_EMAIL}.`)).toBeVisible();

  const link = await inviteLinkFromMailpit(page, NEW_HIRE_EMAIL);
  const path = new URL(link).pathname;

  // A fresh browser context has no session, like a real new hire.
  const guest = await page.context().browser()!.newContext({ baseURL: 'http://localhost:5173' });
  try {
    const guestPage = await guest.newPage();
    await guestPage.goto(path);
    await expect(
      guestPage.getByRole('heading', { level: 1, name: 'Join Café Lindenhof' }),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(guestPage);
    await guestPage.getByRole('button', { name: 'Create account' }).click();
    await guestPage.getByLabel('Name').fill(NEW_HIRE_NAME);
    await guestPage.getByLabel('Password').fill(PASSWORD);
    await paceSignIn(guestPage);
    await guestPage.getByRole('button', { name: 'Create account and join' }).click();
    await expect(guestPage).toHaveURL(/\/orgs\/[^/]+(\/me\/shifts)?$/);
  } finally {
    await guest.close();
  }

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: NEW_HIRE_NAME });
  // Exact badge text; the badge starts with an aria-hidden symbol, hence \W*.
  await expect(row.getByText(/^\W*Active$/)).toBeVisible();
});

test('Tom reads and clears his notifications', async ({ page }) => {
  await logInToLindenhof(page, 'tom@shiftswap.test');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: /^Notifications \(\d+\)$/ })).toBeVisible();
  await openPage(page, 'Notifications', 'Notifications');
  // The two seeded ACCEPTANCE_RECEIVED items, both still unread.
  const accepted = page
    .getByRole('listitem')
    .filter({ hasText: /Someone accepted the offer for / });
  await expect(accepted).toHaveCount(2);
  await expect(accepted.getByText('New', { exact: true })).toHaveCount(2);
  await expectNoSeriousAxeViolations(page);

  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByText('All notifications marked as read.')).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Notifications \(/ })).toHaveCount(0);
});

test("Maria deactivates Mia and Mia's shifts become open shifts", async ({ page }) => {
  await logInToLindenhof(page, 'maria@shiftswap.test');
  await openPage(page, 'Members', 'Members');
  await page.getByRole('button', { name: 'Deactivate Mia Hoffmann' }).click();
  await page.getByRole('button', { name: 'Yes, deactivate' }).click();
  await expect(
    page.getByText(/^Deactivated\. \d+ future shifts? w(as|ere) posted as/),
  ).toBeVisible();

  await openPage(page, 'Schedule', 'Schedule');
  const unassigned = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Unassigned' }) });
  await expect(unassigned.getByText('Open shift').first()).toBeVisible();
  // Mia's 13:00–19:00 shift (tomorrow) is in the Unassigned row too.
  await expect(unassigned.getByRole('button', { name: /13:00–19:00/ })).toBeVisible();
});

test('people screens have no serious or critical axe violations', async ({ page }) => {
  await logInToLindenhof(page, 'maria@shiftswap.test');
  for (const [nav, heading] of [
    ['Members', 'Members'],
    ['Settings', 'Settings'],
    ['Notifications', 'Notifications'],
    ['Audit', 'Audit log'],
  ]) {
    await openPage(page, nav, heading);
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);
  }
});
