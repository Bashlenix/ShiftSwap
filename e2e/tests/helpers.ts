import { type Page } from '@playwright/test';

export const PASSWORD = 'ShiftSwap-Demo-2026';
// Better Auth allows 3 sign-ins per client IP, and the counter only resets after 10s
// without a sign-in. So: up to 3 attempts back to back, then a quiet gap. The suite
// starts with a gap because earlier CI steps (smoke test) also sign in.
const MAX_BURST = 3;
const QUIET_MS = 11_000;
let burst = MAX_BURST;
let lastSignIn = Date.now();

export async function paceSignIn(page: Page) {
  if (Date.now() - lastSignIn >= QUIET_MS) burst = 0;
  if (burst >= MAX_BURST) {
    const wait = lastSignIn + QUIET_MS - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    burst = 0;
  }
  burst++;
  lastSignIn = Date.now();
}

export async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await paceSignIn(page);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** Logs in with the demo password and opens Café Lindenhof. */
export async function logInToLindenhof(page: Page, email: string) {
  await logIn(page, email, PASSWORD);
  await page.getByRole('link', { name: /Café Lindenhof/ }).click();
}

export async function openPage(page: Page, nav: string, heading: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: nav }).click();
  await page.getByRole('heading', { level: 1, name: heading }).waitFor();
}
