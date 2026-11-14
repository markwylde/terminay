import { test as base } from '@playwright/test';
import { createWorkerDisplay } from './worker-display.mjs';

// Worker auto fixtures run before beforeAll hooks and browser/Electron fixtures,
// including suites that use the browser directly instead of the desktop harness.
export const test = base.extend<Record<never, never>, { _isolatedDisplay: undefined }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a fixture object pattern.
  _isolatedDisplay: [async ({}, use, workerInfo) => {
    const display = await createWorkerDisplay();
    if (process.env.TERMINAY_E2E_WORKER_DISPLAY === '1') console.log(`E2E worker ${workerInfo.workerIndex}: isolated display ${process.env.DISPLAY}`);
    try { await use(undefined); }
    finally { await display.close(); }
  }, { scope: 'worker', auto: true }],
});
