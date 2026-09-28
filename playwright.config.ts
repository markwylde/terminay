import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Warms Vite's dependency cache for the browser-shell fixtures; see
  // prebundleSharedWebShellDependencies.
  globalSetup: './e2e/support/global-setup.ts',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // Shard by test, not by file, so the ten CI shards carry near-equal work. A
  // spec whose tests share one app from beforeAll declares itself one group
  // with test.describe.configure({ mode: 'default' }).
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The JSON report keeps every test's duration with the shard's artifacts;
  // the container entrypoint prints the slowest ones into the job log.
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/e2e-timings.json' }],
      ]
    : 'list',
  // CI Electron/Xvfb shards occasionally lose a single timing-sensitive
  // assertion. Retry only that test (not the shard) so a flake can recover
  // without hiding a local failure.
  retries: process.env.CI ? 2 : 0,
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
