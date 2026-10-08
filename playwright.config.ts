import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const pwPort = process.env.PW_PORT || '5199';
const pwApiPort = process.env.PW_API_PORT || '3001';
const usePrivatePorts = process.env.PW_PORT !== undefined || process.env.PW_API_PORT !== undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${pwPort}`,
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
      command: `PORT=${pwApiPort} BETTER_AUTH_URL=http://localhost:${pwPort} npm run dev:server`,
      url: `http://localhost:${pwApiPort}/api/health`,
      reuseExistingServer: !isCI && !usePrivatePorts,
      timeout: 60_000,
    },
    {
      command: `VITE_API_PROXY_PORT=${pwApiPort} npm run dev:client -- --port ${pwPort}`,
      url: `http://localhost:${pwPort}`,
      reuseExistingServer: !isCI && !usePrivatePorts,
      timeout: 60_000,
    },
  ],
});
