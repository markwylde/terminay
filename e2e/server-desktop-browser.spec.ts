import { expect } from '@playwright/test';
import { test } from './support/isolated-test';
import {
	type SharedWebShellFixture,
	startSharedWebShellFixture,
} from './support/shared-web-shell-fixture';

/**
 * The server desktop control and window in a browser client. The Terminay
 * Desktop half, against a real standalone server, is `server-desktop.spec.ts`.
 */

let fixture: SharedWebShellFixture;
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture();
});
test.afterAll(async () => {
	await fixture.close();
});

test('in a browser client Show Desktop twice shows one window, and it reopens on setup in progress', async ({
	browser,
}) => {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const page = await context.newPage();
	await page.goto(`${fixture.origin}/e2e/fixtures/server-desktop.html`, {
		waitUntil: 'commit',
		timeout: 15_000,
	});
	const button = page.locator('[data-server-desktop-button="true"]');
	const desktop = page.locator('[data-server-desktop-dropdown="true"]');
	await expect(button).toBeVisible({ timeout: 30_000 });
	await expect(button).toHaveAttribute(
		'aria-label',
		'Show desktop of studio.example',
	);
	await expect(desktop).toHaveCount(0);

	// The control opens its dropdown, and activating it again closes it.
	await button.click();
	await expect(desktop).toHaveCount(1);
	await expect(button).toHaveAttribute('aria-pressed', 'true');
	await button.click();
	await expect(desktop).toHaveCount(0);
	await button.click();
	await expect(desktop).toHaveCount(1);
	await expect(desktop).toContainText('Desktop · studio.example');

	await expect(
		desktop.locator('[data-server-desktop-state="needs-setup"]'),
	).toBeVisible();
	await desktop.locator('[data-server-desktop-action="setup"]').click();
	await expect(
		desktop.locator('[data-server-desktop-state="setting-up"]'),
	).toBeVisible();

	// Closing and reopening shows the setup still running.
	await page.keyboard.press('Escape');
	await expect(desktop).toHaveCount(0);
	await expect(button).toHaveAttribute('aria-pressed', 'false');
	await button.click();
	await expect(desktop).toHaveCount(1);
	await expect(
		desktop.locator('[data-server-desktop-state="setting-up"]'),
	).toBeVisible();
	await expect(desktop.locator('[role="progressbar"]')).toHaveAttribute(
		'aria-valuenow',
		'10',
	);
	await context.close();
});
