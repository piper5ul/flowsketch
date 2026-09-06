import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // CI uses Playwright's bundled Chromium. Locally, default to the installed
    // Chrome so `npm run test:e2e` works without a 150 MB download; override
    // with PW_CHANNEL (e.g. PW_CHANNEL=chromium after `npx playwright install`).
    ...(isCI ? {} : { channel: process.env.PW_CHANNEL || 'chrome' }),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev:server',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:client',
      url: 'http://localhost:5199',
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
