import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for DocuFlow smoke E2E tests. Spins up the Angular dev
 * server automatically. Run with: `pnpm e2e` (after `pnpm playwright install`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-engine.ts',
  use: {
    baseURL: 'http://localhost:4280',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm ng serve --port 4280',
    url: 'http://localhost:4280',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
