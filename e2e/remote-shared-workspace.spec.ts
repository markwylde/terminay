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

test('remote entry uses the shared browser connection and workspace runtime', async ({
	page,
}) => {
	const pairingUrl = `${fixture.origin}/remote.html#pairingToken=${'a'.repeat(32)}`;
	await page.goto(pairingUrl, { waitUntil: 'domcontentloaded' });

	await expect(
		page.getByRole('dialog', { name: 'Connect to Remote Server' }),
	).toBeVisible();
	await expect(page.getByLabel('Pairing URL')).toHaveValue(pairingUrl);
	await expect(
		page.getByRole('listbox', { name: 'Saved Terminay servers' }),
	).toBeAttached();
	await expect(page.locator('.remote-shell')).toHaveCount(0);
	await expect(page.locator('.remote-workspace')).toHaveCount(0);
});
