import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

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
