import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;

/** What `daemon upgrade --check` prints: one line describing the install. */
function checkAnswer(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		environment: 'user',
		installed: { channel: 'tag', version: '5.1.1', revision: 'aaaa111' },
		available: { version: '5.2.0', revision: 'bbbb222' },
		canUpgrade: true,
		modes: ['in-place'],
		trigger: { kind: 'spawn' },
		unavailable: null,
		lastResult: null,
		...overrides,
	};
}

type FakeUpgrader = Readonly<{
	path: string;
	/** What the next check answers. */
	answer: (value: Record<string, unknown>) => Promise<void>;
	/** What a check answers once a started upgrade has run its course. */
	answerAfterUpgrade: (value: Record<string, unknown>) => Promise<void>;
	/** The argument vectors it was started with, checks excluded. */
	upgrades: () => Promise<string[]>;
}>;

/**
 * A stand-in for the release's `bin/terminay`. A check prints the answer the
 * test last wrote; an upgrade records how it was started, takes a while, and
 * then leaves the answer the test prepared for afterwards.
 */
async function fakeUpgrader(
	root: string,
	options: Readonly<{ upgradeSeconds: number }>,
): Promise<FakeUpgrader> {
	const directory = path.join(root, 'fake-upgrader');
	await mkdir(directory, { recursive: true });
	const script = path.join(directory, 'terminay');
	const check = path.join(directory, 'check.json');
	const after = path.join(directory, 'after.json');
	const calls = path.join(directory, 'calls');
	await writeFile(
		script,
		`#!/bin/sh
if [ "$3" = "--check" ]; then
	cat '${check}'
	exit 0
fi
printf '%s\\n' "$*" >> '${calls}'
sleep ${options.upgradeSeconds}
if [ -f '${after}' ]; then
	cp '${after}' '${check}'
fi
`,
	);
	await chmod(script, 0o755);
	await writeFile(check, `${JSON.stringify(checkAnswer())}\n`);
	return {
		path: script,
		answer: (value) => writeFile(check, `${JSON.stringify(value)}\n`),
		answerAfterUpgrade: (value) =>
			writeFile(after, `${JSON.stringify(value)}\n`),
		upgrades: async () =>
			(await readFile(calls, 'utf8').catch(() => ''))
				.split('\n')
				.filter(Boolean),
	};
}

type StandaloneServer = Readonly<{
	pairingUrl: string;
	stop: () => Promise<void>;
}>;

/** Start the compiled standalone server as a release would: with the upgrader
 * its launcher names. A port is given to bring the same server back. */
async function startStandaloneServer(
	root: string,
	upgraderPath: string,
	port = 0,
): Promise<StandaloneServer> {
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
			String(port),
		],
		{
			env: { ...process.env, TERMINAY_UPGRADER: upgraderPath },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
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

/** Pair a standalone server from Settings › Remote Access and wait until the workspace
 * window is showing it. */
async function pairAndLand(
	appHarness: {
		openChildWindow: (action: () => Promise<void>) => Promise<Page>;
	},
	mainWindow: Page,
	server: { pairingUrl: string },
) {
	const serverHost = new URL(server.pairingUrl).host;
	const manager = await appHarness.openChildWindow(async () => {
		await mainWindow
			.getByRole('button', { name: /Open connection menu/ })
			.click();
		await mainWindow
			.getByRole('button', { name: 'Manage connections' })
			.click();
	});
	await manager.getByRole('button', { name: 'Add server…' }).click();
	await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
	await manager
		.getByRole('button', { name: 'Continue pairing', exact: true })
		.click();
	await expectShowing(mainWindow, serverHost);
	await mainWindow.keyboard.press('Escape');
	return serverHost;
}

async function resize(
	page: Page,
	electronApp: ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
}

const headerControl = (window: Page) =>
	window.getByRole('button', { name: /Open connection menu/ });
const upgradeIndicator = (window: Page) =>
	window.locator('[data-server-upgrade-indicator]');
const upgradeRow = (scope: ReturnType<typeof connectionMenu>) =>
	scope.locator('[data-server-upgrade-profile-id]');
const confirmationOf = (window: Page) =>
	window.locator('[data-server-upgrade-dialog]');

test('a server with an upgrade is marked, confirmed, followed, and told once', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	// Local is updated with Terminay Desktop and never shows a server upgrade.
	await expect(upgradeIndicator(mainWindow)).toHaveCount(0);
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 6 });
	const server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);

		// The header warns for the server the window is working in.
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			'5.2.0',
			{ timeout: 30_000 },
		);
		await expect(headerControl(mainWindow)).toHaveAccessibleName(
			/, upgrade to 5\.2\.0 available$/,
		);

		// Its menu row is marked with the version and offers the action.
		let menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toContainText('Update available · 5.2.0');
		await menu.getByRole('menuitem', { name: 'Upgrade server…' }).click();

		// The confirmation names both versions and the brief disconnect, and
		// dismissing it sends nothing.
		const confirmation = confirmationOf(mainWindow);
		await expect(confirmation).toContainText(`${serverHost} is running 5.1.1.`);
		await expect(confirmation).toContainText('Version 5.2.0 is available.');
		await expect(confirmation).toContainText(
			'The connection to this server drops briefly while it restarts. Its terminals keep running.',
		);
		expect(await upgrader.upgrades()).toEqual([]);
		await confirmation.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirmation).toHaveCount(0);
		expect(await upgrader.upgrades()).toEqual([]);
		await expect(upgradeIndicator(mainWindow)).toHaveCount(1);

		// Confirmed: the request names the mode and nothing else.
		await upgrader.answerAfterUpgrade(
			checkAnswer({
				installed: { channel: 'tag', version: '5.2.0', revision: 'bbbb222' },
				available: null,
				lastResult: {
					from: '5.1.1',
					to: '5.2.0',
					outcome: 'succeeded',
					// A real upgrader stamps its record when it finishes. This
					// answer is written before the upgrade begins, and an outcome
					// older than the upgrade's start is rightly not taken for its.
					at: new Date(Date.now() + 60_000).toISOString(),
				},
			}),
		);
		menu = await openConnectionMenu(mainWindow);
		await menu.getByRole('menuitem', { name: 'Upgrade server…' }).click();
		await confirmation.getByRole('button', { name: 'Upgrade', exact: true }).click();
		await expect(confirmation).toHaveCount(0);
		await expect
			.poll(() => upgrader.upgrades(), { timeout: 15_000 })
			.toEqual(['daemon upgrade --user']);

		// While it runs the row says so and offers no action.
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toContainText('Upgrading…');
		await expect(
			menu.getByRole('menuitem', { name: 'Upgrade server…' }),
		).toHaveCount(0);
		await mainWindow.keyboard.press('Escape');

		// The outcome is told once, and the warning is gone.
		const notice = mainWindow.locator('[data-server-upgrade-notice]');
		await expect(notice).toHaveText(`${serverHost} is now on 5.2.0.`, {
			timeout: 45_000,
		});
		await expect(notice).toHaveCount(1);
		await expect(upgradeIndicator(mainWindow)).toHaveCount(0);
		await expect(headerControl(mainWindow)).not.toHaveAccessibleName(/upgrade/);
		await notice.getByRole('button', { name: 'Dismiss' }).click();
		await expect(notice).toHaveCount(0);
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toHaveCount(0);
		await expect(notice).toHaveCount(0);
	} finally {
		await server.stop();
	}
});

test('a server that cannot upgrade itself shows why and a command to copy, and Local shows nothing', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 1 });
	await upgrader.answer(
		checkAnswer({
			environment: 'system',
			canUpgrade: false,
			trigger: { kind: 'request-file', path: '/run/terminay-upgrade/request' },
			unavailable: {
				reason: 'The upgrade helper is not installed on this server.',
				command: 'sudo terminay daemon upgrade',
			},
		}),
	);
	const server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		await pairAndLand(appHarness, mainWindow, server);
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			'5.2.0',
			{ timeout: 30_000 },
		);
		let menu = await openConnectionMenu(mainWindow);
		const row = upgradeRow(menu);
		await expect(row).toContainText('Update available · 5.2.0');
		await expect(row).toContainText(
			'The upgrade helper is not installed on this server.',
		);
		await expect(row.locator('code')).toHaveText('sudo terminay daemon upgrade');
		await expect(
			row.getByRole('button', { name: 'Copy upgrade command' }),
		).toBeVisible();
		await expect(
			menu.getByRole('menuitem', { name: 'Upgrade server…' }),
		).toHaveCount(0);

		// Local, in the same window: no icon, no row, no action.
		await menu.getByRole('menuitemradio', { name: 'Local', exact: true }).click();
		await expectShowing(mainWindow, 'Local');
		await expect(upgradeIndicator(mainWindow)).toHaveCount(0);
		await expect(headerControl(mainWindow)).not.toHaveAccessibleName(/upgrade/);
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toHaveCount(0);
		expect(await upgrader.upgrades()).toEqual([]);
	} finally {
		await server.stop();
	}
});

test('a server that restarts and rolls back says why and keeps its warning', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(300_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	// Long enough that the server is still mid-upgrade when it goes away.
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 120 });
	let server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		const port = Number(new URL(server.pairingUrl).port);
		let menu = await openConnectionMenu(mainWindow);
		await menu
			.getByRole('menuitem', { name: 'Upgrade server…' })
			.click({ timeout: 30_000 });
		await confirmationOf(mainWindow)
			.getByRole('button', { name: 'Upgrade', exact: true })
			.click();
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toContainText('Upgrading…');
		await mainWindow.keyboard.press('Escape');

		// The server goes away mid-upgrade and the previous release comes back.
		await server.stop();
		await upgrader.answer(
			checkAnswer({
				lastResult: {
					from: '5.1.1',
					to: '5.2.0',
					outcome: 'rolled-back',
					reason: 'the new release did not become ready',
					at: new Date().toISOString(),
				},
			}),
		);
		server = await startStandaloneServer(tempDir, upgrader.path, port);

		// The window reconnects by itself: nobody presses Retry. While the
		// server was away the workspace may have given way to the reconnecting
		// screen, so what was being followed has to outlive it.
		await mainWindow
			.locator('.project-tabbar')
			.waitFor({ state: 'visible', timeout: 120_000 });

		const notice = mainWindow.locator('[data-server-upgrade-notice="failure"]');
		await expect(notice).toHaveText(
			`Upgrading ${serverHost} failed: the new release did not become ready. 5.1.1 is running again.`,
			{ timeout: 120_000 },
		);
		await expect(notice).toHaveCount(1);
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			'5.2.0',
		);
		// The row carries the same outcome for a device that attaches later.
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toContainText('5.1.1 is running again.');
		await expect(
			menu.getByRole('menuitem', { name: 'Upgrade server…' }),
		).toBeVisible();
	} finally {
		await server.stop();
	}
});

test.describe('server upgrade at phone width', () => {
	test('the connection glyph warns, the switcher lists the row, and the confirmation fits', async ({
		appHarness,
		electronApp,
		mainWindow,
		tempDir,
	}) => {
		test.setTimeout(240_000);
		await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
		const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 1 });
		await upgrader.answer(checkAnswer({ modes: ['in-place', 'recreate'] }));
		const server = await startStandaloneServer(tempDir, upgrader.path);
		try {
			await pairAndLand(appHarness, mainWindow, server);
			await expect(upgradeIndicator(mainWindow)).toHaveCount(1, {
				timeout: 30_000,
			});
			await resize(mainWindow, electronApp, PHONE);
			await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible();

			const glyph = mainWindow.locator('[data-compact-connection="true"]');
			await expect(glyph).toHaveAccessibleName(
				/, upgrade to 5\.2\.0 available$/,
			);
			await expect(
				glyph.locator('[data-server-upgrade-indicator="5.2.0"]'),
			).toBeVisible();

			await glyph.click();
			const row = mainWindow.locator('[data-server-upgrade-profile-id]');
			await expect(row).toContainText('Update available · 5.2.0');
			await row.getByRole('button', { name: 'Upgrade server…' }).click();

			// Both modes, in place preselected, and what recreate costs.
			const confirmation = confirmationOf(mainWindow);
			await expect(confirmation).toBeVisible();
			await expect(
				confirmation.getByRole('radio', { name: /Upgrade in place/ }),
			).toBeChecked();
			const recreate = confirmation.getByRole('radio', {
				name: /Recreate the container/,
			});
			await expect(recreate).not.toBeChecked();
			await expect(confirmation).toContainText(
				'Ends every terminal on this server.',
			);
			await expect(confirmation).toContainText('Its terminals keep running.');
			await recreate.check();
			await expect(confirmation).toContainText(
				'Every terminal on this server ends.',
			);
			await expect(confirmation).not.toContainText('keep running');

			// Every control of the confirmation is inside the phone's viewport.
			for (const name of ['Cancel', 'Upgrade']) {
				const box = await confirmation
					.getByRole('button', { name, exact: true })
					.boundingBox();
				expect(box, `${name} is drawn`).not.toBeNull();
				expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
					PHONE.width,
				);
				expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
					PHONE.height,
				);
			}
			await confirmation.getByRole('button', { name: 'Cancel' }).click();
			await expect(confirmation).toHaveCount(0);
			expect(await upgrader.upgrades()).toEqual([]);
		} finally {
			await server.stop();
		}
	});
});
