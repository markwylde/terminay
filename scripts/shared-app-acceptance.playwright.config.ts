import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './acceptance',
	testMatch: 'shared-app-production-parity.spec.ts',
	timeout: 90_000,
	expect: { timeout: 15_000 },
	workers: 1,
	reporter: 'list',
	use: {
		colorScheme: 'dark',
		deviceScaleFactor: 1,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
});
