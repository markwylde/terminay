import { stat } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';

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

		await recovery.getByRole('link', { name: 'Retry' }).click();
		await expect(recovery).toBeVisible();
		expect(electronApp.windows()).toHaveLength(1);

		// A failed host startup cannot be repaired by renderer-created identities.
		await expect(
			stat(path.join(userDataDir, 'workspace.v3.json')),
		).rejects.toMatchObject({ code: 'ENOENT' });
	});
}
