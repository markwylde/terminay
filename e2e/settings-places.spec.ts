import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DEVICE_NAME = /^This (Mac|PC)$/u;

const deviceTile = (settings: Page) => settings.locator('[data-settings-place="device"]');
const serverTile = (settings: Page, name: string) =>
	settings.locator(`[data-settings-place-name="${name}"]`);
const scopeLine = (settings: Page) => settings.locator('.settings-scope-line');
const navItem = (settings: Page, name: string) =>
	settings.locator('.settings-nav-item', { hasText: name });

test('the rail lists this device, then each attached server, then Connect a server', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const settings = await appHarness.openSettingsAt('device', 'appearance');
	const rail = settings.getByRole('navigation', { name: 'Where settings are saved' });
	const tiles = rail.locator('button');
	await expect(tiles.first()).toHaveAccessibleName(DEVICE_NAME);
	await expect(tiles.nth(1)).toHaveAttribute('data-settings-place-name', 'Local');
	await expect(tiles.last()).toHaveAccessibleName('Connect a server');
	await expect(rail.locator('[aria-pressed="true"]')).toHaveCount(1);
	await expect(deviceTile(settings)).toHaveAttribute('aria-pressed', 'true');
});

test('each place shows only what it stores, with its scope line', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const settings = await appHarness.openSettingsAt('device', 'appearance');
	await expect(scopeLine(settings)).toHaveText(
		/^On this (Mac|PC) · whichever server is connected$/u,
	);
	// Tab indicators are the server's; the device never lists them.
	await expect(settings.getByText('Show indicator for active tabs')).toHaveCount(0);
	// Server-only categories are absent from the device.
	await expect(navItem(settings, 'Macros')).toHaveCount(0);

	await serverTile(settings, 'Local').click();
	await expect(serverTile(settings, 'Local')).toHaveAttribute('aria-pressed', 'true');
	await expect(scopeLine(settings)).toHaveText('On Local · every device connected to it');
	await expect(navItem(settings, 'Macros')).toHaveCount(1);
	await expect(navItem(settings, 'Servers')).toHaveCount(0);
	await navItem(settings, 'Interaction').click();
	await expect(settings.getByText('Show indicator for active tabs')).toHaveCount(1);
});

test('search looks only in the selected place and keeps its query across places', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const settings = await appHarness.openSettingsAt('device', 'appearance');
	const search = settings.locator('.settings-search-input');
	await search.fill('indicator for active tabs');
	await expect(settings.getByText('Show indicator for active tabs')).toHaveCount(0);

	await serverTile(settings, 'Local').click();
	await expect(search).toHaveValue('indicator for active tabs');
	await expect(settings.getByText('Show indicator for active tabs')).toHaveCount(1);
});

test('This device Updates says what its channel reaches; Local follows it', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const settings = await appHarness.openSettingsAt('device', 'updates');
	await expect(navItem(settings, 'Updates')).toHaveClass(/settings-nav-item--active/u);
	await expect(settings.locator('.settings-updates-reach')).toContainText(
		'Local server built into it. It does not change any other server',
	);
	await expect(settings.locator('[data-version-line="Running"]')).toBeVisible();

	await serverTile(settings, 'Local').click();
	await expect(navItem(settings, 'Updates')).toHaveClass(/settings-nav-item--active/u);
	await expect(
		settings.getByText('The Local server is built into Terminay Desktop and follows its update channel.'),
	).toBeVisible();
	await expect(settings.getByText(/terminay daemon upgrade/u)).toHaveCount(0);
	await settings.getByRole('button', { name: 'Open Terminay Desktop updates' }).click();
	await expect(deviceTile(settings)).toHaveAttribute('aria-pressed', 'true');
	await expect(settings.locator('.settings-updates-reach')).toBeVisible();
});

test('leaving a server with pending macro edits asks first', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const settings = await appHarness.openMacrosSettings(mainWindow);
	await settings.getByRole('button', { name: 'New macro', exact: true }).click();
	await settings.getByLabel('Macro name').fill('Pending Place Macro');
	await expect(settings.locator('.macro-save-state').first()).toContainText('Unsaved changes');

	await deviceTile(settings).click();
	const prompt = settings.getByRole('alertdialog');
	await expect(prompt).toContainText('Save changes to your macros?');
	await prompt.getByRole('button', { name: 'Keep editing' }).click();
	await expect(serverTile(settings, 'Local')).toHaveAttribute('aria-pressed', 'true');
	await expect(navItem(settings, 'Macros')).toHaveClass(/settings-nav-item--active/u);
});

test('a narrow Settings window shows the rail as a row above the categories', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const settings = await appHarness.openSettingsAt('device', 'appearance');
	await settings.setViewportSize({ width: 600, height: 820 });
	const shell = settings.locator('.settings-shell');
	await expect(shell).toHaveAttribute('data-settings-layout', 'narrow');
	// A narrow window opens on the page; going back shows the places and categories.
	await expect(settings.locator('.settings-rail')).toBeHidden();
	await settings.getByRole('button', { name: DEVICE_NAME }).first().click();
	const rail = settings.locator('.settings-rail');
	await expect(rail).toBeVisible();
	const railBox = await rail.boundingBox();
	const sidebarBox = await settings.locator('.settings-sidebar').boundingBox();
	expect(railBox && sidebarBox && railBox.y + railBox.height <= sidebarBox.y + 1).toBe(true);
	await serverTile(settings, 'Local').click();
	await navItem(settings, 'Macros').click();
	await expect(settings.locator('.settings-sidebar')).toBeHidden();
});
