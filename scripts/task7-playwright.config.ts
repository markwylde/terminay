import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: 'task7-remote-connection-e2e.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['line'], ['json', { outputFile: 'scripts/.task7-remote-connection-e2e-results.json' }]],
})
