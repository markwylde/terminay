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
	await page.goto(`${fixture.origin}/web.html`);
	const connect = page.getByRole('dialog', {
		name: 'Connect to Remote Server',
	});
	await connect.getByLabel('Pairing URL').fill(pairingUrl());
	await connect.getByRole('button', { name: 'Connect' }).click();
	return page.getByRole('dialog', { name: 'Enroll browser device' });
}

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
	await page.goto(`${fixture.origin}/web.html#${fragment}`);
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
