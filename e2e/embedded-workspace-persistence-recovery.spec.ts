import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';

test.setTimeout(60_000);

for (const fault of ['unreadable', 'invalid', 'uncommittable'] as const) {
	test(`embedded ${fault} persistence remains in bounded host recovery`, async ({
		electronApp,
		userDataDir,
	}) => {
		const page = await electronApp.firstWindow();
		const recovery = page.getByRole('alert');
		await expect(recovery).toBeVisible();
		await expect(
			recovery.getByRole('heading', {
				name: 'Terminay could not open this workspace',
			}),
		).toBeVisible();
		const copy = (await recovery.innerText()).trim();
		expect(copy.length).toBeGreaterThan(20);
		expect(copy.length).toBeLessThanOrEqual(600);
		expect(copy).not.toMatch(
			/injected|workspace\.v3\.json|Users\/|EACCES|ENOSPC/,
		);
		await expect(page.locator('.project-tabbar')).toHaveCount(0);
		await expect(page.locator('.terminal-tab-content')).toHaveCount(0);
		expect(electronApp.windows()).toHaveLength(1);
		// Closing a recovery-only window races the deliberately uninitialized Local
		// UI session. It must be an ordinary Electron teardown, not a main-process
		// exception or an extra recovery/blank window.
		if (fault === 'unreadable') {
			const closed = electronApp.waitForEvent('close');
			await electronApp.evaluate(({ BrowserWindow }) => {
				BrowserWindow.getAllWindows()[0]?.close();
			});
			await closed;
			return;
		}

		await recovery.getByRole('link', { name: 'Retry' }).evaluate((link) => {
			(link as HTMLAnchorElement).click();
		});
		await expect
			.poll(() =>
				electronApp.evaluate(async ({ BrowserWindow }) => {
					const window = BrowserWindow.getAllWindows()[0];
					if (window === undefined || window.isDestroyed()) return false;
					return window.webContents.executeJavaScript(
						"document.querySelector('[role=alert]')?.textContent?.includes('Terminay could not open this workspace') === true",
					);
				}),
			)
			.toBe(true);
		expect(electronApp.windows()).toHaveLength(1);

		// A failed host startup cannot be repaired by renderer-created identities.
		await expect(
			stat(path.join(userDataDir, 'workspace.v3.json')),
		).rejects.toMatchObject({ code: 'ENOENT' });
	});
}
