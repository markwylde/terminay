import { expect, test } from '@playwright/test';
import { WEB_PROFILE_STORAGE_KEY } from '@terminay/web';
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

test('Connections pairing opens enrollment without saving metadata, while advanced imports converge across tabs', async ({
	context,
}) => {
	const first = await context.newPage();
	const second = await context.newPage();
	const url = `${fixture.origin}/web.html`;
	// Navigation commit proves the fixture accepted the request. The route content
	// below is the authoritative application-readiness boundary; DOMContentLoaded
	// can remain pending behind cold Vite compilation on a loaded Docker shard.
	await first.goto(url, { waitUntil: 'commit' });
	await second.goto(url, { waitUntil: 'commit' });

	const firstConnections = first.locator(
		'[data-shared-route-body="connections"]',
	);
	const secondConnections = second.locator(
		'[data-shared-route-body="connections"]',
	);
	await expect(firstConnections).toContainText('No saved servers yet', {
		timeout: 30_000,
	});
	await expect(secondConnections).toContainText('No saved servers yet', {
		timeout: 30_000,
	});
	await firstConnections
		.getByRole('button', { name: 'Add connection…' })
		.click();
	const pair = firstConnections.getByRole('form', { name: 'Add connection' });
	await pair
		.getByLabel('Pairing URL')
		.fill(
			`https://paired.example/?transport=webrtc#pairingSessionId=pairing-session-tabs&pairingToken=${'a'.repeat(32)}&pairingExpiresAt=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
		);
	await pair.getByRole('button', { name: 'Continue pairing' }).click();

	const enrollment = first.getByRole('dialog', {
		name: 'Enroll browser device',
	});
	await expect(enrollment).toBeVisible();
	await expect(enrollment.getByLabel('Device name')).toBeEditable();
	await expect(enrollment.getByLabel('Pairing PIN')).toBeVisible();
	await expect(secondConnections).toContainText('No saved servers yet');
	const beforeEnrollment = await first.evaluate(
		(key) => localStorage.getItem(key),
		WEB_PROFILE_STORAGE_KEY,
	);
	expect(beforeEnrollment ?? '').not.toContain('paired.example');
	expect(beforeEnrollment ?? '').not.toContain('pairing-session-tabs');
	await enrollment.getByRole('button', { name: 'Cancel pairing' }).click();

	await firstConnections
		.getByRole('button', { name: 'Advanced: import profile metadata' })
		.click();
	const advancedImport = firstConnections.getByRole('region', {
		name: 'Advanced profile metadata import',
	});
	await expect(advancedImport).toContainText(
		'You will need a fresh pairing URL before this browser can connect.',
	);
	await advancedImport
		.getByLabel('Profile metadata')
		.fill(
			'{"id":"server:shared","serverId":"server:shared","label":"Shared server","origin":"https://shared.example","status":"offline"}',
		);
	await advancedImport.getByRole('button', { name: 'Import metadata' }).click();
	await expect(secondConnections).toContainText('Shared server');

	const shared = firstConnections.getByRole('option', {
		name: /Shared server offline/u,
	});
	await shared.getByRole('button', { name: 'Rename' }).click();
	const rename = firstConnections.getByRole('form', {
		name: 'Rename connection',
	});
	await rename.getByLabel('Connection name').fill('Renamed shared server');
	await rename.getByRole('button', { name: 'Save name' }).click();
	await expect(secondConnections).toContainText('Renamed shared server');

	const persisted = await first.evaluate(
		(key) => localStorage.getItem(key),
		WEB_PROFILE_STORAGE_KEY,
	);
	expect(persisted).toContain('https://shared.example');
	expect(persisted).not.toContain('pairing-session-tabs');
	expect(persisted).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

	const remote = secondConnections.getByRole('option', {
		name: /Renamed shared server offline/u,
	});
	await remote.getByRole('button', { name: 'Forget' }).click();
	await secondConnections
		.getByRole('button', { name: 'Confirm forget' })
		.click();
	await expect(firstConnections).not.toContainText('Renamed shared server');
});
