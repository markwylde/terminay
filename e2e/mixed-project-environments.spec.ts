import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.describe.configure({ timeout: 180_000 });

async function expectMixedInventory(page: Page): Promise<void> {
	await page
		.getByRole('button', { name: 'Choose project environment' })
		.click();
	const menu = page.getByRole('menu', { name: 'Choose project environment' });
	await expect(menu).toBeVisible();
	await expect(
		menu.getByRole('menuitem', { name: /This server/u }),
	).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: /CI SSH/u })).toContainText(
		'ssh-ci:22',
	);
	await expect(
		menu.getByRole('menuitem', { name: /CI Puzed VM/u }),
	).toContainText('puzed-ci:22');
	await page.keyboard.press('Escape');
}

test('Desktop preserves one This server, SSH and Puzed inventory across renderer restart', async ({
	mainWindow,
}) => {
	await expectMixedInventory(mainWindow);
	await mainWindow.reload();
	await expect(mainWindow.locator('.project-tabbar')).toBeVisible();
	await expectMixedInventory(mainWindow);
});
