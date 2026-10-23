import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Sign-in is rate limited per client IP (3 per 10s), so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
