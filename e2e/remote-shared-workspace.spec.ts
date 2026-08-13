import { expect, test } from '@playwright/test';
import {
	installSessionTransportHostStub,
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

test('remote entry uses the shared browser connection and workspace runtime', async ({
	page,
}) => {
	test.setTimeout(90_000);
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));
	await installSessionTransportHostStub(page);
	const pairingUrl = `${fixture.origin}/remote.html#pairingToken=${'a'.repeat(32)}`;
	// Cold CI workers can still be compiling the Vite module graph after the
	// document commits. Navigation only proves that the session route exists;
	// the bounded UI assertion below proves that the hosted contract mounted.
	await page.goto(pairingUrl, { waitUntil: 'commit' });

	await expect(
		page.getByRole('dialog', { name: 'Connect to Remote Server' }),
	).toBeVisible({ timeout: 60_000 });
	await expect(page.getByLabel('Pairing URL')).toHaveValue(pairingUrl);
	await expect(
		page.getByRole('listbox', { name: 'Saved Terminay servers' }),
	).toBeAttached();
	await expect(page.locator('.remote-shell')).toHaveCount(0);
	await expect(page.locator('.remote-workspace')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});
