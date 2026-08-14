import { expect, test } from './fixtures';

test('Electron exposes the connection manager for canonical remote profiles', async ({
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	await mainWindow.getByLabel('Open connection menu').click();
	await mainWindow.getByRole('button', { name: 'Add connection…' }).click();

	const manager = mainWindow.getByRole('dialog', {
		name: 'Browser connections',
	});
	await expect(manager).toBeVisible();
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
