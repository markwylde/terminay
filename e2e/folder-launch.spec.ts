import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { expect, launchDesktopApp, test } from './fixtures';
import { openSettingsWindow, prepareWindow } from './support/app';
import { activeTerminalCwd } from './support/project-start';

test('native and argv folder launches show fresh terminals at the exact local cwd', async ({
	tempDir,
	userDataDir,
}, testInfo) => {
	const first = path.join(tempDir, 'cold ü space $(false)');
	const second = path.join(tempDir, 'warm folder');
	await mkdir(first);
	await mkdir(second);
	const launched = await launchDesktopApp({
		tempDir,
		userDataDir,
		testInfo,
		args: ['--working-directory', first],
	});
	const app = launched.electronApp;
	try {
		const page = await prepareWindow(await app.firstWindow());
		await expect(
			page.locator('.project-workspace--active .terminal-panel:visible'),
		).toHaveCount(1, { timeout: 30_000 });
		expect(await activeTerminalCwd(page)).toBe(await realpath(first));
		const settings = await openSettingsWindow(app, page, {
			sectionId: 'shell-launch',
		});
		const policy = settings.locator('#shell-profile-cwd-policy');
		await expect(policy).toBeEnabled();
		await policy.selectOption('home');
		await expect(policy).toBeEnabled();
		// A failed operand must not block the subsequent valid request.
		await app.evaluate(
			({ app }, folder) => {
				app.emit('open-file', { preventDefault() {} }, folder);
			},
			path.join(tempDir, 'missing'),
		);
		// Drive Electron's actual OS event adapter; this is not a renderer launch API.
		await app.evaluate(({ app }, folder) => {
			app.emit('open-file', { preventDefault() {} }, folder);
		}, second);
		await expect
			.poll(() => activeTerminalCwd(page), { timeout: 20_000 })
			.toBe(await realpath(second));
		const projectId = await page
			.locator('.project-tab--active')
			.getAttribute('data-project-id');
		const executable = await app.evaluate(() => process.execPath);
		const appPath = await app.evaluate(({ app }) => app.getAppPath());
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			const child = spawn(
				executable,
				[appPath, '--working-directory', 'warm folder'],
				{
					cwd: tempDir,
					env: {
						...process.env,
						TERMINAY_USER_DATA_DIR: userDataDir,
						TERMINAY_TEST: '1',
					},
					stdio: 'ignore',
				},
			);
			child.once('error', reject);
			child.once('exit', resolve);
		});
		expect(exitCode).toBe(0);
		await expect(
			page.locator('.project-workspace--active .dv-tab'),
		).toHaveCount(2, { timeout: 20_000 });
		expect(await activeTerminalCwd(page)).toBe(await realpath(second));
		if (projectId)
			await expect(page.locator('.project-tab--active')).toHaveAttribute(
				'data-project-id',
				projectId,
			);
	} finally {
		await launched.close();
	}
});
