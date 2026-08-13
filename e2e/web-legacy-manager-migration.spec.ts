import { expect, type Page, type Route, test } from '@playwright/test';
import {
	LEGACY_MANAGER_HANDOFF_PREFIX,
	LEGACY_MANAGER_PENDING_ACK_KEY,
	LEGACY_MANAGER_PROFILE_STORAGE_KEY,
	WEB_PROFILE_STORAGE_KEY,
} from '@terminay/web';
import {
	type SharedWebShellFixture,
	startSharedWebShellFixture,
} from './support/shared-web-shell-fixture';

const LEGACY_ORIGIN = 'https://web.terminay.com';
const MANAGER_ORIGIN = 'https://app.terminay.com';
const SESSION_ORIGIN = 'https://workstation-one.sessions.example';
const SESSION_CREDENTIAL_KEY = 'terminay.test.origin-bound-reconnect';

let fixture: SharedWebShellFixture;
test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture();
});
test.afterAll(async () => {
	await fixture.close();
});

async function proxyProductionManagerRequest(route: Route): Promise<void> {
	const requested = new URL(route.request().url());
	if (
		requested.origin !== LEGACY_ORIGIN &&
		requested.origin !== MANAGER_ORIGIN
	) {
		await route.fallback();
		return;
	}
	const fixturePath =
		requested.pathname === '/'
			? requested.origin === LEGACY_ORIGIN
				? '/legacy.html'
				: '/web.html'
			: `${requested.pathname}${requested.search}`;
	const fixtureUrl = `${fixture.origin}${fixturePath}`;
	let response: Awaited<ReturnType<Route['fetch']>> | undefined;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			response = await route.fetch({ url: fixtureUrl });
			break;
		} catch (error) {
			const transientReset =
				error instanceof Error && /\b(?:ECONNRESET|socket hang up)\b/u.test(error.message);
			if (!transientReset || attempt === 3) throw error;
			await new Promise((resolve) => setTimeout(resolve, attempt * 100));
		}
	}
	if (!response) throw new Error(`Fixture proxy returned no response for ${fixturePath}`);
	await route.fulfill({ response });
}

async function seedOrigin(page: Page, origin: string): Promise<void> {
	await page.route(`${origin}/__migration_seed__`, (route) =>
		route.fulfill({
			body: '<!doctype html><title>Migration storage fixture</title>',
			contentType: 'text/html',
			status: 200,
		}),
	);
	await page.goto(`${origin}/__migration_seed__`);
}

test('the real legacy and canonical entries migrate metadata once and preserve origin-bound credentials', async ({
	context,
}) => {
	const page = await context.newPage();
	const loadedDocuments: Array<{ name: string; origin: string }> = [];
	const productionRequests: string[] = [];

	await page.exposeFunction(
		'captureMigrationDocument',
		(value: { name: string; origin: string }) => loadedDocuments.push(value),
	);
	await page.addInitScript(() => {
		void (
			window as unknown as Window & {
				captureMigrationDocument(value: {
					name: string;
					origin: string;
				}): Promise<void>;
			}
		).captureMigrationDocument({ name: window.name, origin: location.origin });
	});
	page.on('request', (request) => {
		const url = request.url();
		if (
			request.resourceType() === 'document' &&
			(url.startsWith(LEGACY_ORIGIN) || url.startsWith(MANAGER_ORIGIN))
		)
			productionRequests.push(url);
	});
	await page.route(
		'https://app.terminay.com/**',
		proxyProductionManagerRequest,
	);
	await page.route(
		'https://web.terminay.com/**',
		proxyProductionManagerRequest,
	);

	const reconnectSecret = 'origin-bound-reconnect-secret-must-survive';
	await seedOrigin(page, SESSION_ORIGIN);
	await page.evaluate(
		([key, value]) => localStorage.setItem(key, value),
		[SESSION_CREDENTIAL_KEY, reconnectSecret],
	);

	const forbiddenSecret = 'legacy-pairing-secret-must-not-migrate';
	await seedOrigin(page, LEGACY_ORIGIN);
	await page.evaluate(
		({ key, record }) => localStorage.setItem(key, JSON.stringify(record)),
		{
			key: LEGACY_MANAGER_PROFILE_STORAGE_KEY,
			record: {
				version: 1,
				profiles: [
					{
						id: 'saved-workstation-one',
						serverId: 'server-workstation-one',
						label: 'Workstation one',
						origin: SESSION_ORIGIN,
						status: 'connected',
						reconnectGrant: forbiddenSecret,
						pairingFragment: forbiddenSecret,
						deviceKey: forbiddenSecret,
						pin: '123456',
						terminalOutput: forbiddenSecret,
					},
					{
						id: 'saved-build-host',
						serverId: 'server-build-host',
						label: 'Build host',
						origin: 'https://build-host.sessions.example',
						arbitraryStorage: forbiddenSecret,
					},
				],
			},
		},
	);

	await page.goto(`${LEGACY_ORIGIN}/`, {
		waitUntil: 'domcontentloaded',
		timeout: 15_000,
	});
	await expect(page).toHaveURL(`${MANAGER_ORIGIN}/`, { timeout: 15_000 });
	// The final canonical navigation can commit before the React manager has
	// restored its durable profile projection on a loaded CI shard. Synchronize
	// on the migration's storage boundary before asserting the rendered cards.
	await expect
		.poll(
			() =>
				page.evaluate(
					([key, expectedOrigin]) =>
						localStorage.getItem(key)?.includes(expectedOrigin) === true,
					[WEB_PROFILE_STORAGE_KEY, SESSION_ORIGIN],
				),
			{ timeout: 15_000 },
		)
		.toBe(true);
	await expect(page.getByText('Workstation one', { exact: true })).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText('Build host', { exact: true })).toBeVisible({
		timeout: 15_000,
	});

	const canonicalState = await page.evaluate(
		(key) => ({
			handoff: window.name,
			profiles: localStorage.getItem(key),
		}),
		WEB_PROFILE_STORAGE_KEY,
	);
	expect(canonicalState.handoff).toBe('');
	expect(canonicalState.profiles).toContain(SESSION_ORIGIN);
	expect(canonicalState.profiles).toContain(
		'https://build-host.sessions.example',
	);
	expect(canonicalState.profiles).not.toContain(forbiddenSecret);
	expect(canonicalState.profiles).not.toContain('123456');
	expect(canonicalState.profiles).not.toContain('pairingFragment');
	expect(canonicalState.profiles).not.toContain('reconnectGrant');

	// Imported manager metadata cannot pretend that exact-session-origin browser
	// credentials crossed the origin boundary. Both profiles remain visible and
	// selecting one transfers control to that exact session origin, where its
	// origin-bound reconnect state can be checked without involving the manager.
	await page.route('https://build-host.sessions.example/**', (route) =>
		route.fulfill({
			body: '<!doctype html><title>Build host session</title>',
			contentType: 'text/html',
		}),
	);
	const buildHost = page.getByRole('option', { name: /Build host offline/u });
	await buildHost.getByRole('button', { name: 'Switch to Build host' }).click();
	await expect(page).toHaveURL('https://build-host.sessions.example/?route=workspace');
	await expect(page).toHaveTitle('Build host session');

	await expect
		.poll(
			() =>
				loadedDocuments.filter(
					(document) =>
						document.origin === LEGACY_ORIGIN ||
						document.origin === MANAGER_ORIGIN,
				).length,
			{ timeout: 5_000 },
		)
		.toBeGreaterThanOrEqual(4);
	const migrationDocuments = loadedDocuments.filter(
		(document) =>
			document.origin === LEGACY_ORIGIN || document.origin === MANAGER_ORIGIN,
	);
	const offers = migrationDocuments.filter((document) =>
		document.name.startsWith(LEGACY_MANAGER_HANDOFF_PREFIX),
	);
	expect(offers).toHaveLength(2);
	expect(offers[0]?.name).toContain('"type":"offer"');
	expect(offers[1]?.name).toContain('"type":"ack"');
	for (const document of offers) {
		expect(document.name).not.toContain(forbiddenSecret);
		expect(document.name).not.toContain('123456');
		expect(document.name).not.toContain('pairingFragment');
		expect(document.name).not.toContain('reconnectGrant');
	}
	expect(productionRequests.every((url) => !new URL(url).search)).toBe(true);
	expect(productionRequests.every((url) => !new URL(url).hash)).toBe(true);

	await seedOrigin(page, LEGACY_ORIGIN);
	const legacyCleanup = await page.evaluate(
		([profilesKey, pendingKey]) => ({
			pending: localStorage.getItem(pendingKey),
			profiles: localStorage.getItem(profilesKey),
		}),
		[LEGACY_MANAGER_PROFILE_STORAGE_KEY, LEGACY_MANAGER_PENDING_ACK_KEY],
	);
	expect(legacyCleanup).toEqual({ pending: null, profiles: null });

	await seedOrigin(page, SESSION_ORIGIN);
	await expect
		.poll(() =>
			page.evaluate((key) => localStorage.getItem(key), SESSION_CREDENTIAL_KEY),
		)
		.toBe(reconnectSecret);
});
