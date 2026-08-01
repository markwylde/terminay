import { expect, test } from './fixtures';

test('Electron exposes the connection manager with immutable Local', async ({
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	await mainWindow.getByLabel('Open connection menu').click();
	await mainWindow
		.getByRole('button', { name: 'Manage connections…' })
		.click();

	const manager = mainWindow.getByRole('dialog', { name: 'Connections' });
	await expect(manager).toBeVisible();
	await expect(manager.getByText('Saved connections')).toBeVisible();

	const local = manager.getByRole('option', { name: /Local connected/u });
	await expect(local).toHaveAttribute('aria-selected', 'true');
	await expect(local).toContainText('Always available');
	await expect(local.getByRole('button', { name: 'Current server' })).toBeDisabled();
	await expect(local.getByRole('button', { name: 'Rename' })).toHaveCount(0);
	await expect(local.getByRole('button', { name: 'Forget' })).toHaveCount(0);
	await expect(local.getByRole('button', { name: 'Revoke access' })).toHaveCount(
		0,
	);

	await expect(manager.getByText('Add a remote server', { exact: true })).toBeVisible();
	await expect(manager.getByLabel('Pairing URL')).toBeVisible();
});
