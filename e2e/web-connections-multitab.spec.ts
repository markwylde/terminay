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

test('shared Web Connections actions persist and converge across tabs without pairing fragments', async ({
	context,
}) => {
	const first = await context.newPage();
	const second = await context.newPage();
	const url = `${fixture.origin}/web.html`;
	await first.goto(url, { waitUntil: 'commit' });
	await second.goto(url, { waitUntil: 'commit' });

	const firstConnections = first.locator(
		'[data-shared-route-body="connections"]',
	);
	const secondConnections = second.locator(
		'[data-shared-route-body="connections"]',
	);
	await firstConnections.getByRole('button', { name: 'Add server' }).click();
	const add = firstConnections.getByRole('form', { name: 'Add connection' });
	await add.getByLabel('Server ID').fill('server:shared');
	await add.getByLabel('Name').fill('Shared server');
	await add.getByLabel('Origin').fill('https://shared.example');
	await add.getByRole('button', { name: 'Save server' }).click();
	await expect(secondConnections).toContainText('Shared server');

	await firstConnections.getByRole('button', { name: 'Pair device' }).click();
	const pair = firstConnections.getByRole('form', { name: 'Pair device' });
	await pair
		.getByLabel('Pairing URL')
		.fill('https://paired.example/session#one-time-secret');
	await pair.getByRole('button', { name: 'Continue pairing' }).click();
	await expect(secondConnections).toContainText('paired.example');

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
	expect(persisted).toContain('https://paired.example');
	expect(persisted).not.toContain('one-time-secret');
	expect(persisted).not.toContain('/session');

	const remote = secondConnections.getByRole('option', {
		name: /Renamed shared server offline/u,
	});
	await remote.getByRole('button', { name: 'Forget' }).click();
	await secondConnections
		.getByRole('button', { name: 'Confirm forget' })
		.click();
	await expect(firstConnections).not.toContainText('Renamed shared server');
});
