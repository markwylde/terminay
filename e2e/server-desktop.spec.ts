import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';

/**
 * The server desktop window, in Terminay Desktop, against a real standalone
 * server.
 *
 * This container has none of the desktop's packages, so the server reports
 * `needs-setup`. Root's side of setup is a stand-in: the test is the helper.
 * It sees the server change the trigger file and writes the status file the
 * real helper would, which the server is told to read from a path the test
 * owns. Everything between — the server's setup, its state machine, the
 * events, and the window — is the real thing.
 */

type StandaloneServer = Readonly<{
	pairingUrl: string;
	stop: () => Promise<void>;
}>;

type FakeHelper = Readonly<{
	upgrader: string;
	statusFile: string;
	/** How many times the server has changed the trigger. */
	triggered: () => Promise<number>;
	/** Record how far the stand-in run has got. */
	report: (status: Record<string, unknown>) => Promise<void>;
}>;

async function fakeHelper(root: string): Promise<FakeHelper> {
	const directory = path.join(root, 'fake-helper');
	await mkdir(directory, { recursive: true });
	const upgrader = path.join(directory, 'terminay');
	// The E2E base image provisions the desktop trigger with a root-owned parent.
	const request = '/var/lib/terminay-upgrade/request';
	const trigger = '/var/lib/terminay-desktop-setup/desktop-setup';
	const statusFile = path.join(directory, 'status.json');
	// A system-scope install's upgrader: its check names the helper's request
	// file, and the desktop trigger lives in its own sibling directory.
	const check = {
		schemaVersion: 1,
		environment: 'system',
		installed: { channel: 'tag', version: '5.1.1', revision: 'aaaa111' },
		available: null,
		canUpgrade: false,
		modes: ['in-place'],
		trigger: { kind: 'request-file', path: request },
		unavailable: null,
		lastResult: null,
	};
	await writeFile(
		upgrader,
		`#!/bin/sh\nif [ "$3" = "--check" ]; then\n\tcat <<'JSON'\n${JSON.stringify(check)}\nJSON\n\texit 0\nfi\nexit 1\n`,
	);
	await chmod(upgrader, 0o755);
	const created = (await stat(trigger)).mtimeMs;
	let seen = created;
	let count = 0;
	return {
		upgrader,
		statusFile,
		triggered: async () => {
			const now = (await stat(trigger)).mtimeMs;
			if (now !== seen) {
				seen = now;
				count += 1;
			}
			return count;
		},
		report: async (status) => {
			// Whole, then renamed into place, as the real helper writes it.
			const temporary = `${statusFile}.tmp`;
			await writeFile(
				temporary,
				`${JSON.stringify({ version: 1, pid: process.pid, startedAt: Date.now(), ...status })}\n`,
			);
			await rename(temporary, statusFile);
		},
	};
}

async function startStandaloneServer(
	root: string,
	helper: FakeHelper,
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
			'desktop-box',
			'--data-root',
			dataRoot,
			'--project-root',
			projectRoot,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
		],
		{
			env: {
				...process.env,
				// A system-scope install on a host, whatever runs this test.
				TERMINAY_MANAGED_BY: '',
				TERMINAY_UPGRADER: helper.upgrader,
				TERMINAY_DESKTOP_SETUP_STATUS_FILE: helper.statusFile,
			},
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

const connectionMenu = (window: Page) =>
	window.locator('[role="menu"][aria-label="Connection menu"]:visible').first();

async function expectShowing(window: Page, label: string) {
	await expect(async () => {
		await window.locator('.project-tabbar').waitFor({ state: 'visible' });
		const menu = connectionMenu(window);
		if (!(await menu.isVisible().catch(() => false)))
			await window
				.getByRole('button', { name: /Open connection menu/ })
				.click();
		await expect(
			menu.getByRole('menuitemradio', { name: label, exact: true }),
		).toHaveAttribute('aria-checked', 'true', { timeout: 2_000 });
	}).toPass({ timeout: 45_000 });
}

const desktopButton = (window: Page) =>
	window.locator('[data-server-desktop-button="true"]');
const desktopWindow = (window: Page) =>
	// The Show Desktop dropdown.
	window.locator('[data-server-desktop-dropdown="true"]');
const stateOf = (window: Page, state: string) =>
	desktopWindow(window).locator(`[data-server-desktop-state="${state}"]`);
const step = (window: Page, name: string) =>
	desktopWindow(window).locator(`[data-server-desktop-step="${name}"]`);

/** Pair this window with the standalone server and wait until it shows it. */
async function pairWith(
	appHarness: { openChildWindow: (open: () => Promise<void>) => Promise<Page> },
	window: Page,
	server: StandaloneServer,
): Promise<string> {
	const serverHost = new URL(server.pairingUrl).host;
	const manager = await appHarness.openChildWindow(async () => {
		await window.getByRole('button', { name: /Open connection menu/ }).click();
		await window.getByRole('button', { name: 'Manage connections' }).click();
	});
	await manager.getByRole('button', { name: 'Add server…' }).click();
	await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
	await manager
		.getByRole('button', { name: 'Continue pairing', exact: true })
		.click();
	await expectShowing(window, serverHost);
	await window.keyboard.press('Escape');
	return serverHost;
}

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;
const WIDE = { x: 40, y: 40, width: 1280, height: 800 } as const;

async function resize(
	page: Page,
	electronApp: ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
	await expect(page.locator('.app-shell')).toHaveAttribute(
		'data-terminay-compact-chrome',
		bounds.width <= 640 ? 'true' : 'false',
	);
}

const drawerOf = (page: Page) =>
	page.getByRole('dialog', { name: 'Switch terminal' });

async function openDrawer(page: Page): Promise<Locator> {
	await page.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = drawerOf(page);
	await expect(drawer).toBeVisible();
	// A press measured mid-entrance lands where the row used to be.
	await drawer.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
	return drawer;
}

/** The drawer's Servers panel, opened from its rail. */
async function openServersPanel(page: Page): Promise<Locator> {
	const drawer = await openDrawer(page);
	await drawer.locator('[data-compact-switcher-server="true"]').click();
	const panel = drawer.locator('[data-compact-servers-panel="true"]');
	await expect(panel).toBeVisible();
	return panel;
}

const showDesktopRow = (page: Page) =>
	drawerOf(page).locator('[data-compact-show-desktop="true"]');
const desktopTab = (page: Page) =>
	page.locator('[data-server-desktop-tab]:visible');
const desktopBack = (page: Page) =>
	page.locator('[data-server-desktop-back="true"]:visible');
const desktopRow = (page: Page) =>
	drawerOf(page).locator(
		'[data-compact-switcher-panel]:not([data-compact-switcher-terminal])',
		{ hasText: 'Desktop' },
	);

test('at phone width Show Desktop is a row of the Servers panel, and its tab is found and closed without a tab strip', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });

	// This device's own server offers no desktop: no row at phone width.
	await resize(mainWindow, electronApp, PHONE);
	await openServersPanel(mainWindow);
	await expect(showDesktopRow(mainWindow)).toHaveCount(0);
	await mainWindow.keyboard.press('Escape');
	await expect(drawerOf(mainWindow)).toHaveCount(0);
	await resize(mainWindow, electronApp, WIDE);

	const helper = await fakeHelper(tempDir);
	const server = await startStandaloneServer(tempDir, helper);
	try {
		const serverHost = await pairWith(appHarness, mainWindow, server);
		await createStartedProject(mainWindow);

		// A dropdown left open does not come back after the window has been
		// phone width.
		await desktopButton(mainWindow).click();
		await expect(desktopWindow(mainWindow)).toHaveCount(1);
		await resize(mainWindow, electronApp, PHONE);
		await expect(desktopWindow(mainWindow)).toHaveCount(0);
		await resize(mainWindow, electronApp, WIDE);
		await expect(desktopButton(mainWindow)).toBeVisible();
		await expect(desktopWindow(mainWindow)).toHaveCount(0);

		// At phone width the control is a row beneath the server list. It
		// closes the drawer and opens the desktop as a tab of the project in
		// front, showing the state the dropdown would.
		await resize(mainWindow, electronApp, PHONE);
		await expect(desktopButton(mainWindow)).toHaveCount(0);
		await openServersPanel(mainWindow);
		const row = showDesktopRow(mainWindow);
		await expect(row).toHaveAccessibleName(`Show desktop of ${serverHost}`);
		await row.click();
		await expect(drawerOf(mainWindow)).toHaveCount(0);
		await expect(desktopWindow(mainWindow)).toHaveCount(0);
		await expect(desktopTab(mainWindow)).toHaveCount(1);
		await expect(
			desktopTab(mainWindow).locator(
				'[data-server-desktop-state="needs-setup"]',
			),
		).toBeVisible();
		// The compact row names a project's tab; the tab draws no header.
		await expect(desktopBack(mainWindow)).toHaveCount(0);

		// The drawer lists it as a desktop under its own title, never as a
		// terminal, and the project still holds one terminal.
		let drawer = await openDrawer(mainWindow);
		await expect(desktopRow(mainWindow)).toHaveCount(1);
		await expect(desktopRow(mainWindow)).toContainText(
			`Desktop · ${serverHost}`,
		);
		await expect(desktopRow(mainWindow)).toHaveAttribute(
			'aria-current',
			'true',
		);
		await expect(
			drawer.locator('[data-compact-switcher-terminal]'),
		).toHaveCount(1);

		// With the terminal in front, the desktop's row brings the tab back.
		await drawer.locator('[data-compact-switcher-terminal]').click();
		await expect(drawerOf(mainWindow)).toHaveCount(0);
		await expect(desktopTab(mainWindow)).toHaveCount(0);
		drawer = await openDrawer(mainWindow);
		await desktopRow(mainWindow).click();
		await expect(drawerOf(mainWindow)).toHaveCount(0);
		await expect(desktopTab(mainWindow)).toHaveCount(1);

		// The Tabs dashboard also activates this non-terminal by panel id.
		drawer = await openDrawer(mainWindow);
		await drawer.locator('[data-compact-switcher-terminal]').click();
		drawer = await openDrawer(mainWindow);
		await drawer.locator('[data-compact-switcher-home="true"]').click();
		await drawer.locator('[data-compact-home-section="tabs"]').click();
		await mainWindow
			.locator('[data-terminay-dashboard-panel]', { hasText: `Desktop · ${serverHost}` })
			.click();
		await expect(desktopTab(mainWindow)).toHaveCount(1);

		// Its row menu opens and closes it, and offers nothing a terminal's
		// does besides.
		drawer = await openDrawer(mainWindow);
		await desktopRow(mainWindow).click({ button: 'right' });
		const menu = drawer.locator('[data-compact-sheet="true"]');
		await expect(menu).toBeVisible();
		await expect(menu.locator('[data-compact-sheet-item]')).toHaveText([
			'Open',
			'Close',
		]);
		await menu.locator('[data-compact-sheet-item="close"]').click();
		await expect(desktopRow(mainWindow)).toHaveCount(0);
		await mainWindow.keyboard.press('Escape');
		await expect(drawerOf(mainWindow)).toHaveCount(0);
		await expect(desktopTab(mainWindow)).toHaveCount(0);

		// Closed is forgotten: it is not there after a reload.
		await mainWindow.reload();
		await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-compact-chrome',
			'true',
		);
		drawer = await openDrawer(mainWindow);
		await expect(
			drawer.locator('[data-compact-switcher-terminal]'),
		).toHaveCount(1);
		await expect(desktopRow(mainWindow)).toHaveCount(0);

		// From Home the tab opens in Home. The drawer does not list Home's
		// tabs, so the tab carries its own way out, even before the desktop
		// has been set up.
		await drawer.locator('[data-compact-switcher-home="true"]').click();
		await drawer.locator('[data-compact-home-section="automations"]').click();
		await expect(drawerOf(mainWindow)).toHaveCount(0);
		const automations = mainWindow.locator(
			'[data-terminay-automations]:visible',
		);
		await expect(automations).toHaveCount(1);
		await openServersPanel(mainWindow);
		await showDesktopRow(mainWindow).click();
		await expect(drawerOf(mainWindow)).toHaveCount(0);
		await expect(desktopTab(mainWindow)).toHaveCount(1);
		await expect(automations).toHaveCount(0);
		await expect(
			desktopTab(mainWindow).locator(
				'[data-server-desktop-state="needs-setup"]',
			),
		).toBeVisible();
		await expect(desktopBack(mainWindow)).toHaveCount(1);

		// A wide window has a tab strip, so the tab draws no control of its own.
		await resize(mainWindow, electronApp, WIDE);
		await expect(desktopTab(mainWindow)).toHaveCount(1);
		await expect(desktopBack(mainWindow)).toHaveCount(0);
		await resize(mainWindow, electronApp, PHONE);

		// Closing returns to the tab that was in front.
		await desktopBack(mainWindow).click();
		await expect(desktopTab(mainWindow)).toHaveCount(0);
		await expect(automations).toHaveCount(1);
	} finally {
		await server.stop();
	}
});

test('Show Desktop opens a dropdown, and setup carries on while it is closed', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	// This device's own server offers no desktop, so there is no control.
	await expect(desktopButton(mainWindow)).toHaveCount(0);

	const helper = await fakeHelper(tempDir);
	const server = await startStandaloneServer(tempDir, helper);
	try {
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

		// The standalone server offers one: the control sits beside the
		// notifications bell and names the server.
		const button = desktopButton(mainWindow);
		await expect(button).toBeVisible();
		await expect(button).toHaveAttribute(
			'aria-label',
			`Show desktop of ${serverHost}`,
		);
		await expect(desktopWindow(mainWindow)).toHaveCount(0);

		// Activating it opens its dropdown, and activating it again closes it.
		await button.click();
		await expect(desktopWindow(mainWindow)).toHaveCount(1);
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		await button.click();
		await expect(desktopWindow(mainWindow)).toHaveCount(0);
		await button.click();
		await expect(desktopWindow(mainWindow)).toHaveCount(1);
		await expect(desktopWindow(mainWindow)).toContainText(
			`Desktop · ${serverHost}`,
		);

		// Nothing is installed here, and this install has a helper: the dropdown
		// offers setup and shows no command to copy.
		await expect(stateOf(mainWindow, 'needs-setup')).toBeVisible();
		const setUp = desktopWindow(mainWindow).locator(
			'[data-server-desktop-action="setup"]',
		);
		await expect(setUp).toHaveText('Set up desktop');
		await expect(
			desktopWindow(mainWindow).locator('[data-server-desktop-command]'),
		).toHaveCount(0);
		expect(await helper.triggered()).toBe(0);

		// Setup: the server changes the trigger and sends nothing else. The
		// stand-in helper then reports as the real one does.
		await setUp.click();
		await expect
			.poll(() => helper.triggered(), { timeout: 20_000 })
			.toBeGreaterThan(0);
		await helper.report({ run: 'e2e-run', step: 'preparing', fraction: 0.05 });
		await expect(stateOf(mainWindow, 'setting-up')).toBeVisible({
			timeout: 20_000,
		});
		await helper.report({ run: 'e2e-run', step: 'downloading', fraction: 0.4 });
		const progress = desktopWindow(mainWindow).locator('[role="progressbar"]');
		await expect(progress).toHaveAttribute('aria-valuenow', '40', {
			timeout: 20_000,
		});
		await expect(step(mainWindow, 'preparing')).toHaveAttribute(
			'data-step-state',
			'done',
		);
		await expect(step(mainWindow, 'downloading')).toHaveAttribute(
			'data-step-state',
			'current',
		);
		await expect(
			desktopWindow(mainWindow).locator('[data-server-desktop-action]'),
		).toHaveCount(0);

		// Closing the dropdown ends nothing: setup moves on, and it reopens on
		// where it has got to.
		await mainWindow.keyboard.press('Escape');
		await expect(desktopWindow(mainWindow)).toHaveCount(0);
		await helper.report({ run: 'e2e-run', step: 'installing', fraction: 0.8 });
		await button.click();
		await expect(desktopWindow(mainWindow)).toHaveCount(1);
		await expect(stateOf(mainWindow, 'setting-up')).toBeVisible();
		await expect(progress).toHaveAttribute('aria-valuenow', '80', {
			timeout: 20_000,
		});
		await expect(step(mainWindow, 'installing')).toHaveAttribute(
			'data-step-state',
			'current',
		);

		// A failure names its step and reason and offers another try.
		await helper.report({
			run: 'e2e-run',
			step: 'installing',
			fraction: 0.8,
			outcome: {
				ok: false,
				step: 'installing',
				reason: 'dpkg: error processing archive: no space left on device',
			},
		});
		await expect(stateOf(mainWindow, 'failed')).toBeVisible({
			timeout: 20_000,
		});
		await expect(step(mainWindow, 'installing')).toHaveAttribute(
			'data-step-state',
			'failed',
		);
		await expect(desktopWindow(mainWindow)).toContainText(
			'no space left on device',
		);
		await expect(
			desktopWindow(mainWindow).locator('[data-server-desktop-action="setup"]'),
		).toHaveText('Try again');

		// Escape closes the dropdown.
		await mainWindow.keyboard.press('Escape');
		await expect(desktopWindow(mainWindow)).toHaveCount(0);
	} finally {
		await server.stop();
	}
});
