import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;
const WIDE = { x: 40, y: 40, width: 1280, height: 800 } as const;

async function resize(
	page: Page,
	electronApp: ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
}

async function toggleStatusBar(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.dispatchEvent(
			new CustomEvent('terminay-app-command', {
				detail: { command: 'toggle-status-bar' },
			}),
		);
	});
}

test('compact chrome keeps its own status bar preference, hidden by default', async ({
	electronApp,
	mainWindow,
}) => {
	const statusBar = mainWindow.locator('.workspace-status-bar');
	const compactRow = mainWindow.locator('[data-compact-chrome="true"]');
	await expect(
		mainWindow.locator('[data-terminay-app-component]'),
	).toBeVisible();

	await resize(mainWindow, electronApp, WIDE);
	await expect(compactRow).toHaveCount(0);
	await expect(statusBar).toBeVisible();

	await resize(mainWindow, electronApp, PHONE);
	await expect(compactRow).toBeVisible();
	await expect(statusBar).toHaveCount(0);

	// Toggling at phone width shows the bar there.
	await toggleStatusBar(mainWindow);
	await expect(statusBar).toBeVisible();

	// The wide layout's preference is untouched by the phone toggle.
	await resize(mainWindow, electronApp, WIDE);
	await expect(compactRow).toHaveCount(0);
	await expect(statusBar).toBeVisible();

	await resize(mainWindow, electronApp, PHONE);
	await expect(compactRow).toBeVisible();
	await expect(statusBar).toBeVisible();
	await toggleStatusBar(mainWindow);
	await expect(statusBar).toHaveCount(0);

	await resize(mainWindow, electronApp, WIDE);
	await expect(compactRow).toHaveCount(0);
	await expect(statusBar).toBeVisible();
});
