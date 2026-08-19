import { expect, test } from './fixtures';

test('Electron opens Remote Control as a full auxiliary window', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const manager = await appHarness.openRemoteControlWindow(mainWindow);
	await expect(manager.locator('.remote-control-window')).toBeVisible();
	await expect(manager.locator('.settings-sidebar')).toBeVisible();
	await expect(manager.locator('.settings-content')).toBeVisible();
	await expect(
		manager.getByRole('heading', { name: 'Remote Control' }),
	).toBeVisible();
	await expect(manager.locator('[role="dialog"]')).toHaveCount(0);
	expect(new URL(manager.url()).searchParams.get('auxiliary')).toBe(
		'remote-control',
	);
	await expect(
		manager.getByRole('listbox', { name: 'Saved Terminay servers' }),
	).toHaveCount(1);

	await manager.getByRole('button', { name: 'Add connection…' }).click();
	await expect(
		manager.locator('form[aria-label="Add connection"]'),
	).toBeVisible();
	await expect(manager.getByLabel('Pairing URL')).toBeVisible();
	await expect(
		manager.getByRole('button', { name: 'Continue pairing', exact: true }),
	).toBeVisible();
});

test('the header connection menu opens the Remote Control window', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const connectionMenu = mainWindow.getByRole('button', {
		name: /Open connection menu/,
	});
	await expect(connectionMenu).toHaveAttribute(
		'aria-label',
		'Open connection menu, Offline',
	);
	const manager = await appHarness.openChildWindow(async () => {
		await connectionMenu.click();
		await mainWindow.getByRole('button', { name: 'Manage connections' }).click();
	});
	await expect(manager.locator('.remote-control-window')).toBeVisible();
	expect(new URL(manager.url()).searchParams.get('auxiliary')).toBe(
		'remote-control',
	);
});
