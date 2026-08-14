import { expect, test } from '@playwright/test';
import {
	type SharedWebShellFixture,
	startSharedWebShellFixture,
} from './support/shared-web-shell-fixture';

let fixture: SharedWebShellFixture;

test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture();
});

test.afterAll(async () => {
	await fixture.close();
});

test('direct browser bootstrap renders recovery for a reduced user agent instead of throwing', async ({
	page,
}) => {
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, 'userAgent', {
			configurable: true,
			get: () => 'Terminay compatibility test',
		});
	});
	await page.goto(`${fixture.origin}/remote.html`, { waitUntil: 'commit' });

	const failure = page.locator(
		'[data-terminay-bootstrap-failure="session-host"]',
	);
	await expect(failure).toBeVisible({ timeout: 60_000 });
	await expect(failure).toContainText(
		'Terminay could not start this workspace',
	);
	await expect(failure).toContainText(
		'Failed bootstrap step: the secure session host check.',
	);
	await expect(
		failure.getByRole('button', { name: 'Reload Terminay' }),
	).toBeVisible();
	expect(pageErrors).toEqual([]);
});
