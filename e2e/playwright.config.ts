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
  // people-flow deactivates Mia, which would change the swap-flow data, so it runs in a
  // second project that starts only after the first one has finished.
  projects: [
    { name: 'chromium', testIgnore: /people-flow/, use: { browserName: 'chromium' } },
    {
      name: 'chromium-people',
      testMatch: /people-flow/,
      dependencies: ['chromium'],
      use: { browserName: 'chromium' },
    },
  ],
});
