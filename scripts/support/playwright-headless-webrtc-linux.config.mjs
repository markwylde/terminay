import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'line',
  retries: 0,
  testDir: '../../e2e',
  timeout: 60_000,
  use: {
    launchOptions: {
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  workers: 1,
})
