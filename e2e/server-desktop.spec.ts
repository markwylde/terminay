import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

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
	const request = path.join(directory, 'request');
	const trigger = path.join(directory, 'desktop-setup');
	const statusFile = path.join(directory, 'status.json');
	// A system-scope install's upgrader: its check names the helper's request
	// file, and the desktop trigger sits beside it.
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
	await writeFile(request, '');
	await writeFile(trigger, '');
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
	window.locator('[data-in-page-window="server-desktop"]');
const stateOf = (window: Page, state: string) =>
	desktopWindow(window).locator(`[data-server-desktop-state="${state}"]`);
const step = (window: Page, name: string) =>
	desktopWindow(window).locator(`[data-server-desktop-step="${name}"]`);

test('Show Desktop opens one window, and setup carries on while it is closed', async ({
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

		// Activating it twice shows one window. The second activation is sent
		// to the control itself: the open window is modal over the header.
		await button.click();
		await expect(desktopWindow(mainWindow)).toHaveCount(1);
		await button.evaluate((element: HTMLElement) => element.click());
		await expect(desktopWindow(mainWindow)).toHaveCount(1);
		await expect(button).toHaveAttribute('aria-pressed', 'true');
		await expect(desktopWindow(mainWindow)).toContainText(
			`Desktop · ${serverHost}`,
		);

		// Nothing is installed here, and this install has a helper: the window
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

		// Closing the window ends nothing: setup moves on, and the window
		// reopens on where it has got to.
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

		// Back on this device's own server there is no control and no window.
		await mainWindow.keyboard.press('Escape');
		await expect(desktopWindow(mainWindow)).toHaveCount(0);
	} finally {
		await server.stop();
	}
});
