import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  retries: 0,
	// CI shards must finish their full assigned test set. Stopping at the first
	// failure hides independent regressions and turns each repair loop into a
	// one-failure-at-a-time process.
  maxFailures: 0,
  workers: process.env.CI ? Number(process.env.PLAYWRIGHT_WORKERS ?? '1') : 1,
  use: {
    actionTimeout: 5_000,
    navigationTimeout: 5_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
