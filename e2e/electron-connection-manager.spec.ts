import { expect, test } from './fixtures';

test('Electron exposes the connection manager for canonical remote profiles', async ({
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	await mainWindow.getByLabel('Open connection menu').click();
	await mainWindow
		.getByRole('button', { name: 'Add connection…' })
		.click();

	const manager = mainWindow.getByRole('dialog', { name: 'Connections' });
	await expect(manager).toBeVisible();
	await expect(manager.getByText('Saved Terminay servers')).toBeVisible();
	await expect(manager.getByRole('listbox', { name: 'Saved Terminay servers' })).toHaveCount(1);

	await expect(manager.getByText('Add a remote server', { exact: true })).toBeVisible();
	await expect(manager.getByLabel('Pairing URL')).toBeVisible();
});
