import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import {
	holdTornOffProjectTab,
	setCursorScreenPoint,
	tabBarScreenPoints,
} from './support/project-tab-drag';
import { submitTerminalCommand } from './support/terminal';

type StandaloneServer = Readonly<{
	pairingUrl: string;
	stop: () => Promise<void>;
}>;

/** Start the compiled standalone server on a loopback HTTP port of its own
 * choosing and return the one-time pairing URL it advertises. */
async function startStandaloneServer(root: string): Promise<StandaloneServer> {
	const dataRoot = path.join(root, 'standalone-data');
	const projectRoot = path.join(root, 'standalone-project');
	await mkdir(dataRoot, { recursive: true });
	await mkdir(projectRoot, { recursive: true });
	const child: ChildProcess = spawn(
		process.execPath,
		[
			path.resolve('apps/terminay-server/dist/cli.js'),
			'--server-id',
			'build-box',
			'--data-root',
			dataRoot,
			'--project-root',
			projectRoot,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let stderr = '';
	child.stderr?.on('data', (chunk) => {
		stderr += String(chunk);
	});
	const stop = async () => {
		if (child.exitCode !== null) return;
		child.kill('SIGTERM');
		await Promise.race([
			once(child, 'exit'),
			new Promise((resolve) => setTimeout(resolve, 5_000)),
		]);
		if (child.exitCode === null) child.kill('SIGKILL');
	};
	try {
		const pairingUrl = await new Promise<string>((resolve, reject) => {
			let buffered = '';
			const timeout = setTimeout(
				() => reject(new Error(`standalone server was not ready: ${stderr}`)),
				20_000,
			);
			child.once('exit', (code) => {
				clearTimeout(timeout);
				reject(new Error(`standalone server exited ${code}: ${stderr}`));
			});
			child.stdout?.on('data', (chunk) => {
				buffered += String(chunk);
				const lines = buffered.split('\n');
				buffered = lines.pop() ?? '';
				for (const line of lines) {
					try {
						const parsed = JSON.parse(line) as {
							ready?: unknown;
							pairing?: { pairingUrl?: unknown };
						};
						if (
							parsed.ready === true &&
							typeof parsed.pairing?.pairingUrl === 'string'
						) {
							clearTimeout(timeout);
							resolve(parsed.pairing.pairingUrl);
						}
					} catch {
						// Only the readiness line is protocol output.
					}
				}
			});
		});
		return { pairingUrl, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

test('Add connection pairs Desktop with a standalone server over loopback HTTP', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		expect(new URL(server.pairingUrl).origin).toMatch(
			/^http:\/\/127\.0\.0\.1:\d+$/u,
		);
		const serverHost = new URL(server.pairingUrl).host;
		const connectionMenuButton = mainWindow.getByRole('button', {
			name: /Open connection menu/,
		});
		const menu = mainWindow
			.locator('[role="menu"][aria-label="Connection menu"]:visible')
			.first();

		const manager = await appHarness.openChildWindow(async () => {
			await connectionMenuButton.click();
			await mainWindow
				.getByRole('button', { name: 'Manage connections' })
				.click();
		});
		await manager.getByRole('button', { name: 'Add connection…' }).click();
		await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
		await manager
			.getByRole('button', { name: 'Continue pairing', exact: true })
			.click();

		// Pairing takes you there: the workspace window now shows the new
		// server, and Remote Control is still Remote Control, listing it.
		const openMenu = async () => {
			await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
			if (!(await menu.isVisible().catch(() => false)))
				await connectionMenuButton.click();
			await expect(menu).toBeVisible();
		};
		const row = (label: string) =>
			menu.getByRole('menuitemradio', { name: label, exact: true });
		await expect(async () => {
			await openMenu();
			await expect(row(serverHost)).toHaveAttribute('aria-checked', 'true', {
				timeout: 2_000,
			});
			await expect(
				menu.locator('[data-connection-phase="ready"]').filter({
					hasText: serverHost,
				}),
			).toContainText('Connected', { timeout: 2_000 });
		}).toPass({ timeout: 45_000 });
		await expect(row('Local')).toHaveAttribute('aria-checked', 'false');
		await expect(
			manager.getByRole('heading', { name: 'Remote Control' }),
		).toBeVisible();
		await expect(
			manager
				.getByRole('listbox', { name: 'Saved Terminay servers' })
				.getByRole('option', { name: serverHost }),
		).toBeVisible();

		// Choosing Local shows Local in this window. Nothing is attached beside
		// it: the menu lists the servers and marks the one being shown.
		await row('Local').click();
		await expect(async () => {
			await openMenu();
			await expect(row('Local')).toHaveAttribute('aria-checked', 'true', {
				timeout: 2_000,
			});
		}).toPass({ timeout: 45_000 });
		await expect(row(serverHost)).toHaveAttribute('aria-checked', 'false');
		await expect(menu.getByText('Attach', { exact: true })).toHaveCount(0);

		// The other server can be opened in a window of its own, leaving this
		// one on Local.
		const second = await appHarness.openChildWindow(async () => {
			await menu
				.getByRole('button', { name: `Open ${serverHost} in new window` })
				.click();
		});
		await second.locator('.project-tabbar').waitFor({ state: 'visible' });
		const secondMenu = second
			.locator('[role="menu"][aria-label="Connection menu"]:visible')
			.first();
		await expect(async () => {
			if (!(await secondMenu.isVisible().catch(() => false)))
				await second.getByRole('button', { name: /Open connection menu/ }).click();
			await expect(
				secondMenu.getByRole('menuitemradio', {
					name: serverHost,
					exact: true,
				}),
			).toHaveAttribute('aria-checked', 'true', { timeout: 2_000 });
		}).toPass({ timeout: 45_000 });
		await openMenu();
		await expect(row('Local')).toHaveAttribute('aria-checked', 'true');

		// And this window can go back to it while the other window shows it too.
		await row(serverHost).click();
		await expect(async () => {
			await openMenu();
			await expect(row(serverHost)).toHaveAttribute('aria-checked', 'true', {
				timeout: 2_000,
			});
		}).toPass({ timeout: 45_000 });
	} finally {
		await server.stop();
	}
});

/** Pair a standalone server from Remote Control and wait until the workspace
 * window is showing it. */
async function pairAndLand(
	appHarness: { openChildWindow: (action: () => Promise<void>) => Promise<Page> },
	mainWindow: Page,
	server: { pairingUrl: string },
) {
	const serverHost = new URL(server.pairingUrl).host;
	const manager = await appHarness.openChildWindow(async () => {
		await mainWindow.getByRole('button', { name: /Open connection menu/ }).click();
		await mainWindow.getByRole('button', { name: 'Manage connections' }).click();
	});
	await manager.getByRole('button', { name: 'Add connection…' }).click();
	await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
	await manager
		.getByRole('button', { name: 'Continue pairing', exact: true })
		.click();
	await expectShowing(mainWindow, serverHost);
	return serverHost;
}

function connectionMenu(window: Page) {
	return window
		.locator('[role="menu"][aria-label="Connection menu"]:visible')
		.first();
}

async function openConnectionMenu(window: Page) {
	await window.locator('.project-tabbar').waitFor({ state: 'visible' });
	const menu = connectionMenu(window);
	if (!(await menu.isVisible().catch(() => false)))
		await window.getByRole('button', { name: /Open connection menu/ }).click();
	await expect(menu).toBeVisible();
	return menu;
}

/** Wait until a window's connection menu marks this server as the one shown. */
async function expectShowing(window: Page, label: string) {
	await expect(async () => {
		const menu = await openConnectionMenu(window);
		await expect(
			menu.getByRole('menuitemradio', { name: label, exact: true }),
		).toHaveAttribute('aria-checked', 'true', { timeout: 2_000 });
	}).toPass({ timeout: 45_000 });
}

async function switchTo(window: Page, label: string) {
	const menu = await openConnectionMenu(window);
	await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
	await expectShowing(window, label);
}

/** The projects a window's tab strip shows, by identity. */
async function projectIds(window: Page): Promise<string[]> {
	await window.locator('.project-tabbar').waitFor({ state: 'visible' });
	return window
		.locator('.project-tab[role="tab"]')
		.evaluateAll((tabs) =>
			tabs
				.map((tab) => tab.getAttribute('data-project-id'))
				.filter((id): id is string => id !== null),
		);
}

/** No project is in both windows. */
async function expectNoSharedProject(first: Page, second: Page) {
	await expect(async () => {
		const [left, right] = await Promise.all([
			projectIds(first),
			projectIds(second),
		]);
		expect(
			left.filter((id) => right.includes(id)),
			`both windows show the same project: ${JSON.stringify({ left, right })}`,
		).toEqual([]);
	}).toPass({ timeout: 15_000 });
}

test('a window whose server stops answering can still switch back to Local', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		await pairAndLand(appHarness, mainWindow, server);
		await server.stop();

		// The window stays bound to the server it cannot reach, and the
		// connection state it shows in place of the workspace leads out.
		const others = mainWindow.getByRole('navigation', {
			name: 'Other servers',
		});
		await expect(
			mainWindow.getByRole('button', { name: 'Retry connection' }),
		).toBeVisible({ timeout: 90_000 });
		await others.getByRole('button', { name: 'Switch to Local' }).click();
		await expectShowing(mainWindow, 'Local');
	} finally {
		await server.stop();
	}
});

test('a server opened in a second window does not show the projects the first window is showing', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		// The workspace window shows the server and its project.
		expect((await projectIds(mainWindow)).length).toBeGreaterThan(0);

		// Leave for Local, open the server in a window of its own, and come
		// back: two windows now show the one server.
		await switchTo(mainWindow, 'Local');
		const second = await appHarness.openChildWindow(async () => {
			const menu = await openConnectionMenu(mainWindow);
			await menu
				.getByRole('button', { name: `Open ${serverHost} in new window` })
				.click();
		});
		await expectShowing(second, serverHost);
		await switchTo(mainWindow, serverHost);

		// A project is in one window. Two windows on a server never both show it.
		await expectNoSharedProject(mainWindow, second);
	} finally {
		await server.stop();
	}
});

test('a window switched to Local does not show the projects another Local window is showing', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const localProjects = await projectIds(mainWindow);
	expect(localProjects.length).toBeGreaterThan(0);
	const server = await startStandaloneServer(tempDir);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		// One window on Local, one on the server.
		await switchTo(mainWindow, 'Local');
		const second = await appHarness.openChildWindow(async () => {
			const menu = await openConnectionMenu(mainWindow);
			await menu
				.getByRole('button', { name: `Open ${serverHost} in new window` })
				.click();
		});
		await expectShowing(second, serverHost);
		expect(await projectIds(mainWindow)).toEqual(localProjects);

		// The second window switches to Local, which the first is already
		// showing. It must not duplicate the first window's project tabs.
		await switchTo(second, 'Local');
		await expectNoSharedProject(mainWindow, second);
		// And the first window keeps what it had.
		expect(await projectIds(mainWindow)).toEqual(localProjects);
	} finally {
		await server.stop();
	}
});

test('a project tab dropped on a window showing another server stays where it was', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		const openInNewWindow = (from: Page, label: string) =>
			appHarness.openChildWindow(async () => {
				const menu = await openConnectionMenu(from);
				await menu
					.getByRole('button', { name: `Open ${label} in new window` })
					.click();
			});
		// Two windows on each server. The second window on a server presents a
		// view of its own, and both servers call theirs by the same name.
		const remote = mainWindow;
		const local = await openInNewWindow(remote, 'Local');
		await expectShowing(local, 'Local');
		const secondLocal = await openInNewWindow(remote, 'Local');
		await expectShowing(secondLocal, 'Local');
		const secondRemote = await openInNewWindow(local, serverHost);
		await expectShowing(secondRemote, serverHost);
		for (const window of [remote, local, secondLocal, secondRemote])
			await window.keyboard.press('Escape');
		const remoteProjects = await projectIds(remote);
		const secondLocalProjects = await projectIds(secondLocal);
		const secondRemoteProjects = await projectIds(secondRemote);
		expect(remoteProjects.length).toBeGreaterThan(0);

		// The second Local window's bar is the only bar under the pointer.
		const place = async (window: Page, y: number) =>
			(await electronApp.browserWindow(window)).evaluate(
				(native, top) => native.setPosition(40, top),
				y,
			);
		await place(secondLocal, 0);
		for (const window of [remote, local, secondRemote])
			await place(window, 360);
		const target = await tabBarScreenPoints(electronApp, secondLocal);
		await holdTornOffProjectTab(
			electronApp,
			remote,
			remote.locator('.project-tab[role="tab"]').first(),
		);

		// Held over a Local window's bar: it is not a place this tab can go.
		await setCursorScreenPoint(electronApp, target.onBar);
		await remote.waitForTimeout(500);
		await expect
			.soft(secondLocal.locator('.project-tab--drop-placeholder'))
			.toHaveCount(0);

		// Released there: the drag is abandoned and nothing moves.
		await remote.mouse.up();
		await secondLocal.waitForTimeout(3_000);
		expect(remote.isClosed(), 'the source window closed').toBe(false);
		expect(
			await projectIds(remote),
			'the project left the window it was dragged from',
		).toEqual(remoteProjects);
		expect(await projectIds(secondRemote)).toEqual(secondRemoteProjects);
		expect(await projectIds(secondLocal)).toEqual(secondLocalProjects);
		await expect(remote.locator('.project-tab--torn-off')).toHaveCount(0);
		await expect(
			secondLocal.locator('.project-tab--drop-placeholder'),
		).toHaveCount(0);
	} finally {
		await server.stop();
	}
});

for (const closed of ['opened', 'switched'] as const) {
test(`closing the ${closed} one of two windows on a server leaves the other connected`, async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(300_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		// Two windows on the one server, each holding a project of its own.
		await switchTo(mainWindow, 'Local');
		const first = await appHarness.openChildWindow(async () => {
			const menu = await openConnectionMenu(mainWindow);
			await menu
				.getByRole('button', { name: `Open ${serverHost} in new window` })
				.click();
		});
		await expectShowing(first, serverHost);
		await switchTo(mainWindow, serverHost);
		await mainWindow.keyboard.press('Escape');
		await first.keyboard.press('Escape');
		for (const window of [first, mainWindow]) {
			if ((await projectIds(window)).length > 0) continue;
			await window.getByLabel('Create project').click();
			await expect(window.locator('.project-tab[role="tab"]')).toHaveCount(1);
			await expect(window.locator('[data-pending-project-id]')).toHaveCount(0);
		}
		const [closing, kept] =
			closed === 'opened' ? [first, mainWindow] : [mainWindow, first];
		const rows = kept.locator(
			'.project-workspace--active .terminal-panel:visible .xterm-rows',
		);
		await submitTerminalCommand(kept, 'echo before-$((40+2))');
		await expect(rows).toContainText('before-42', { timeout: 15_000 });

		const closingNativeWindow = await electronApp.browserWindow(closing);
		await closingNativeWindow.evaluate((window) => window.close());
		await expect.poll(() => closing.isClosed(), { timeout: 15_000 }).toBe(true);

		// The window left behind never loses its connection, and its terminal
		// still answers.
		const reconnecting = kept.locator('.session-workspace__reconnecting');
		for (let elapsed = 0; elapsed < 45_000; elapsed += 250) {
			expect(await reconnecting.count()).toBe(0);
			await kept.waitForTimeout(250);
		}
		await submitTerminalCommand(kept, 'echo after-$((40+2))');
		await expect(rows).toContainText('after-42', { timeout: 15_000 });
		await expectShowing(kept, serverHost);
		await expect(
			connectionMenu(kept)
				.locator('[data-connection-phase="ready"]')
				.filter({ hasText: serverHost }),
		).toContainText('Connected');
	} finally {
		await server.stop();
	}
});
}

/** Quit the way the Quit menu item does and wait for the process to go. */
async function quitDesktop(electronApp: ElectronApplication): Promise<void> {
	const child = electronApp.process();
	const exited = new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
	await electronApp
		.evaluate(({ app, dialog }) => {
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response: 1,
			});
			setImmediate(() => app.quit());
		})
		.catch(() => undefined);
	await Promise.race([
		exited,
		new Promise<void>((_, reject) =>
			setTimeout(() => reject(new Error('Desktop did not quit')), 30_000),
		),
	]);
}

/** Record every workspace document a launch loads. The loading document is a
 * `data:` URL, so anything else is a workspace being mounted. */
async function recordWorkspaceLoads(electronApp: ElectronApplication) {
	await electronApp.evaluate(({ app, BrowserWindow }) => {
		const loads: string[] = [];
		(globalThis as { __workspaceLoads?: string[] }).__workspaceLoads = loads;
		const watch = (contents: Electron.WebContents) =>
			contents.on('did-navigate', (_event, url) => {
				if (!url.startsWith('data:')) loads.push(url);
			});
		for (const window of BrowserWindow.getAllWindows())
			watch(window.webContents);
		app.on('web-contents-created', (_event, contents) => watch(contents));
	});
	return () =>
		electronApp.evaluate(
			() =>
				(globalThis as { __workspaceLoads?: string[] }).__workspaceLoads ?? [],
		);
}

test('Desktop reopens straight onto the server its window last showed', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(360_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	const launches: Awaited<ReturnType<typeof launchDesktopApp>>[] = [];
	const relaunch = async () => {
		const launched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		launches.push(launched);
		const workspaceLoads = await recordWorkspaceLoads(launched.electronApp);
		const window = await prepareWindow(await launched.electronApp.firstWindow());
		return { launched, window, workspaceLoads };
	};
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		await quitDesktop(electronApp);

		// Closed on the server: it opens there, and Local is never mounted on
		// the way.
		const onServer = await relaunch();
		await expectShowing(onServer.window, serverHost);
		expect(await onServer.workspaceLoads()).toHaveLength(1);

		// Closed on Local: it opens on Local.
		await switchTo(onServer.window, 'Local');
		await quitDesktop(onServer.launched.electronApp);
		const onLocal = await relaunch();
		await expectShowing(onLocal.window, 'Local');
		expect(await onLocal.workspaceLoads()).toHaveLength(1);

		// Closed on a server that then stops answering: it opens on Local.
		await switchTo(onLocal.window, serverHost);
		await quitDesktop(onLocal.launched.electronApp);
		await server.stop();
		const unreachable = await relaunch();
		await expectShowing(unreachable.window, 'Local');
		expect(await unreachable.workspaceLoads()).toHaveLength(1);
	} finally {
		for (const launched of launches)
			await launched.close().catch(() => undefined);
		await server.stop();
	}
});
