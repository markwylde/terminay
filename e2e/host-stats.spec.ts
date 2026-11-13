import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Host stats in the status bar: off by default, switched on per device in
 * Settings > Appearance > Status Bar, filled from samples of the server's own
 * host, and gone again when switched off. The E2E container is Linux, so the
 * server reads /proc and reports every metric.
 */

const strip = (page: Page) => page.getByTestId('workspace-status-bar-host-stats');

async function setHostStats(
	appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
	page: Page,
	enabled: boolean,
) {
	const settings = await appHarness.openSettingsWindow({ page, sectionId: 'status-bar' });
	const toggle = settings.getByLabel('Show host stats');
	if (enabled) await toggle.check();
	else await toggle.uncheck();
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
}

test('host stats are off by default, show the server host once enabled, and leave when disabled', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(90_000);

	await expect(mainWindow.getByTestId('workspace-status-bar')).toBeVisible();
	await expect(strip(mainWindow)).toHaveCount(0);

	await setHostStats(appHarness, mainWindow, true);
	await expect(strip(mainWindow)).toBeVisible();

	// The first sample arrives one interval (5 s by default) after the watch.
	const cpu = strip(mainWindow).locator('[data-metric="cpu"]');
	const memory = strip(mainWindow).locator('[data-metric="memory"]');
	await expect(cpu.locator('.workspace-status-bar__host-figure')).toHaveText(/^\d{1,3}%$/u, {
		timeout: 20_000,
	});
	await expect(memory.locator('.workspace-status-bar__host-figure')).toHaveText(/^\d{1,3}%$/u);
	await expect(memory).toHaveAttribute('title', /Memory \d{1,3}%: .+ used of .+/u);
	await expect(strip(mainWindow).locator('[data-metric="network"]')).toHaveAttribute(
		'title',
		/received, .+ sent/u,
	);
	await expect(strip(mainWindow).locator('[data-metric="disk"]')).toHaveAttribute(
		'title',
		/read, .+ written/u,
	);

	// The graphs advance with further samples.
	await expect(cpu.locator('polyline')).toHaveAttribute('points', / /u, { timeout: 15_000 });

	await setHostStats(appHarness, mainWindow, false);
	await expect(strip(mainWindow)).toHaveCount(0);
});
