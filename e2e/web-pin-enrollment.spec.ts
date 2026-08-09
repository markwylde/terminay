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

function pairingUrl(): string {
	const fragment = new URLSearchParams({
		pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		pairingSessionId: 'pairing-session-browser-pin',
		pairingToken: 'pairing-token-browser-pin-0123456789abcdef',
	});
	return `https://paired.example.test/?transport=webrtc#${fragment}`;
}

async function openEnrollment(page: import('@playwright/test').Page) {
	// Cold Vite compilation is fixture bootstrap, not an application operation.
	await page.goto(`${fixture.origin}/web.html`, {
		waitUntil: 'domcontentloaded',
		timeout: 15_000,
	});
	const connect = page.getByRole('dialog', {
		name: 'Connect to Remote Server',
	});
	await connect.getByLabel('Pairing URL').fill(pairingUrl());
	await connect.getByRole('button', { name: 'Connect', exact: true }).click();
	return page.getByRole('dialog', { name: 'Enroll browser device' });
}

test('canonical manager hands a pairing URL to its exact session origin', async ({
	page,
}) => {
	await page.route('https://app.terminay.com/**', async (route) => {
		const requested = new URL(route.request().url());
		const upstream = new URL(
			`${requested.pathname}${requested.search}`,
			fixture.origin,
		);
		await route.fulfill({ response: await route.fetch({ url: upstream.toString() }) });
	});
	await page.route('https://session-handoff.example.test/**', async (route) => {
		await route.fulfill({
			body: '<!doctype html><title>Session handoff</title>',
			contentType: 'text/html',
		});
	});

	await page.goto('https://app.terminay.com/web.html', {
		waitUntil: 'domcontentloaded',
		timeout: 15_000,
	});
	const fragment = new URLSearchParams({
		pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		pairingFlow: 'device',
		pairingSessionId: 'manager-session-handoff',
		pairingToken: 'manager-session-handoff-token-0123456789abcdef',
	});
	const pairingUrl = `https://session-handoff.example.test/#${fragment}`;
	const connect = page.getByRole('dialog', {
		name: 'Connect to Remote Server',
	});
	await connect.getByLabel('Pairing URL').fill(pairingUrl);
	await connect.getByRole('button', { name: 'Connect', exact: true }).click();

	await page.waitForURL(pairingUrl);
	await expect(page).toHaveTitle('Session handoff');
});

test('browser pairing requires explicit device name and six-digit PIN enrollment', async ({
	page,
}) => {
	const enrollment = await openEnrollment(page);
	await expect(enrollment).toBeVisible();
	await expect(enrollment).toHaveClass(/connect-modal--enrollment/);
	const viewport = page.viewportSize();
	const bounds = await enrollment.boundingBox();
	expect(viewport).not.toBeNull();
	expect(bounds).not.toBeNull();
	expect(
		Math.abs(bounds!.x + bounds!.width / 2 - viewport!.width / 2),
	).toBeLessThan(2);
	expect(
		Math.abs(bounds!.y + bounds!.height / 2 - viewport!.height / 2),
	).toBeLessThan(2);
	await expect(enrollment).toContainText(
		'enter the six-digit PIN shown by the Terminay server',
	);
	await expect(enrollment.getByRole('alert')).toHaveCount(0);
	await expect(enrollment.getByLabel('Device name')).toBeEditable();
	await expect(enrollment.getByLabel('Device name')).toBeFocused();
	const pin = enrollment.getByLabel('Pairing PIN');
	await expect(pin).toHaveAttribute('type', 'password');
	await expect(pin).toHaveAttribute('inputmode', 'numeric');
	await expect(pin).toHaveAttribute('autocomplete', 'one-time-code');
	await expect(pin).toHaveAttribute('pattern', '[0-9]{6}');
	await expect(
		enrollment.getByRole('button', { name: 'Pair and connect' }),
	).toBeDisabled();

	await enrollment.getByLabel('Device name').fill('Browser contract device');
	await pin.fill('12345');
	await expect(
		enrollment.getByRole('button', { name: 'Pair and connect' }),
	).toBeDisabled();
	await pin.fill('123456');
	await expect(
		enrollment.getByRole('button', { name: 'Pair and connect' }),
	).toBeEnabled();
	await enrollment.getByLabel('Device name').fill('   ');
	await expect(
		enrollment.getByRole('button', { name: 'Pair and connect' }),
	).toBeDisabled();
});

test('opening a direct device link consumes its fragment and asks for the PIN immediately', async ({
	page,
}) => {
	const fragment = new URLSearchParams({
		pairingFlow: 'device',
		pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		pairingSessionId: 'direct-device-browser-pin',
		pairingToken: 'direct-device-token-browser-pin-0123456789',
	});
	await page.goto(`${fixture.origin}/web.html#${fragment}`, {
		waitUntil: 'domcontentloaded',
		timeout: 15_000,
	});
	await expect(
		page.getByRole('dialog', { name: 'Enroll browser device' }),
	).toBeVisible();
	expect(page.url()).not.toContain('#');
});

test('cancelling PIN enrollment persists neither pairing material nor a profile', async ({
	page,
}) => {
	const enrollment = await openEnrollment(page);
	await enrollment.getByLabel('Device name').fill('Discarded browser');
	await enrollment.getByLabel('Pairing PIN').fill('123456');
	await enrollment.getByRole('button', { name: 'Cancel pairing' }).click();
	await expect(
		page.getByRole('dialog', { name: 'Connect to Remote Server' }),
	).toBeVisible();
	await expect(page.getByLabel('Pairing URL')).toHaveValue('');
	const persisted = await page.evaluate(
		(key) => localStorage.getItem(key),
		WEB_PROFILE_STORAGE_KEY,
	);
	expect(persisted ?? '').not.toContain('paired.example.test');
	expect(persisted ?? '').not.toContain('pairing-token-browser-pin');
	expect(persisted ?? '').not.toContain('123456');
});

test('an expired pairing handoff fails before enrollment and saves nothing', async ({
	page,
}) => {
	const expiredUrl = `https://expired.example.test/?transport=webrtc#${new URLSearchParams({
		pairingExpiresAt: new Date(Date.now() - 60_000).toISOString(),
		pairingSessionId: 'expired-browser-pairing',
		pairingToken: 'expired-browser-token-0123456789abcdef',
	})}`;
	await page.goto(`${fixture.origin}/web.html`, {
		waitUntil: 'domcontentloaded',
		timeout: 15_000,
	});
	const connect = page.getByRole('dialog', {
		name: 'Connect to Remote Server',
	});
	await connect.getByLabel('Pairing URL').fill(expiredUrl);
	await connect.getByRole('button', { name: 'Connect', exact: true }).click();
	await expect(connect.getByRole('alert')).toContainText('expired');
	await expect(
		page.getByRole('dialog', { name: 'Enroll browser device' }),
	).toHaveCount(0);
	const persisted = await page.evaluate(
		(key) => localStorage.getItem(key),
		WEB_PROFILE_STORAGE_KEY,
	);
	expect(persisted ?? '').not.toContain('expired.example.test');
	expect(persisted ?? '').not.toContain('expired-browser-pairing');
});

test('a pairing link missing its token fails before enrollment and saves nothing', async ({
	page,
}) => {
	const invalidUrl = `https://invalid.example.test/?transport=webrtc#${new URLSearchParams({
		pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		pairingSessionId: 'missing-token-browser-pairing',
	})}`;
		await page.goto(`${fixture.origin}/web.html`, {
			waitUntil: 'domcontentloaded',
			timeout: 15_000,
		});
		const connect = page.getByRole('dialog', {
			name: 'Connect to Remote Server',
		});
		await connect.getByLabel('Pairing URL').fill(invalidUrl);
		await connect.getByRole('button', { name: 'Connect', exact: true }).click();
		await expect(connect.getByRole('alert')).toBeVisible();
		await expect(
			page.getByRole('dialog', { name: 'Enroll browser device' }),
		).toHaveCount(0);
		const persisted = await page.evaluate(
			(key) => localStorage.getItem(key),
			WEB_PROFILE_STORAGE_KEY,
		);
		expect(persisted ?? '').not.toContain(new URL(invalidUrl).origin);
	expect(persisted ?? '').not.toContain('browser-pairing');
});

test('a wrong PIN reports the server denial and persists no connection', async ({
	page,
}) => {
	let submittedPin: string | undefined;
	await page.route(`${fixture.origin}/api/pairing/start`, async (route) => {
		const body = route.request().postDataJSON() as { pairingPin?: string };
		submittedPin = body.pairingPin;
		await route.fulfill({
			body: JSON.stringify({ error: 'Pairing PIN is incorrect.' }),
			contentType: 'application/json',
			status: 403,
		});
	});
	const fragment = new URLSearchParams({
		pairingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
		pairingFlow: 'device',
		pairingSessionId: 'wrong-pin-browser-pairing',
		pairingToken: 'wrong-pin-browser-token-0123456789abcdef',
	});
	await page.goto(`${fixture.origin}/web.html#${fragment}`);
	const enrollment = page.getByRole('dialog', {
		name: 'Enroll browser device',
	});
	await enrollment.getByLabel('Device name').fill('Wrong PIN browser');
	await enrollment.getByLabel('Pairing PIN').fill('654321');
	await enrollment.getByRole('button', { name: 'Pair and connect' }).click();
	await expect(enrollment.getByRole('alert')).toContainText(
		'Pairing PIN is incorrect.',
	);
	expect(submittedPin).toBe('654321');
	const persisted = await page.evaluate(
		(key) => localStorage.getItem(key),
		WEB_PROFILE_STORAGE_KEY,
	);
	expect(persisted ?? '').not.toContain('wrong-pin-browser-pairing');
	expect(persisted ?? '').not.toContain('Wrong PIN browser');
});
