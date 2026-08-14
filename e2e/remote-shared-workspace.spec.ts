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

test('browser manager keeps connection management separate from the server workspace', async ({
	page,
}) => {
	test.setTimeout(90_000);
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));
	const pairingUrl = `${fixture.origin}/remote.html#pairingToken=${'a'.repeat(32)}`;
	// Cold CI workers can still be compiling the Vite module graph after the
	// document commits. Navigation only proves that the session route exists;
	// the bounded UI assertion below proves that the hosted contract mounted.
	await page.goto(`${fixture.origin}/web.html`, { waitUntil: 'commit' });

	const connections = page.locator('[data-shared-route-body="connections"]');
	await expect(connections).toContainText('No saved servers yet', {
		timeout: 60_000,
	});
	await connections.getByRole('button', { name: 'Add connection…' }).click();
	const pairing = connections.getByRole('form', { name: 'Add connection' });
	await pairing.getByLabel('Pairing URL').fill(pairingUrl);
	await expect(pairing.getByLabel('Pairing URL')).toHaveValue(pairingUrl);
	await expect(page.locator('.remote-shell')).toHaveCount(0);
	await expect(page.locator('.remote-workspace')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});
