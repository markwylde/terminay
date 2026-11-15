import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { createStartedProject } from './support/project-start';
import { submitTerminalCommand } from './support/terminal';

/**
 * Desktop connected to a standalone server whose terminal has four large
 * agent windows open. Reconnecting to that server — switching away and back,
 * or relaunching Desktop — must land on a working session: the terminal
 * answers, and the session connect never times out.
 *
 * Each window's view loads as a frame inside the workspace document; that
 * load is not the document reloading, and must not cost it its server lane.
 */

/** A review document of about `kib` KiB: a script-driven page carrying an
 * inline image, as an agent's review window does. */
function reviewDocument(
	index: number,
	kib: number,
): { title: string; html: string } {
	const image = Buffer.alloc(kib * 768, index + 1).toString('base64');
	return {
		title: `Large review ${index + 1}/4`,
		html: `<!doctype html><html><body><p id="count">loading</p><img alt="shot" src="data:image/png;base64,${image}"><script>document.getElementById('count').textContent = '1 / 1';</script></body></html>`,
	};
}
const fixtures = [450, 440, 420, 225].map((kib, index) =>
	reviewDocument(index, kib),
);

const MCP_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile] = process.argv.slice(2);
const params = paramsFile ? JSON.parse(readFileSync(paramsFile, 'utf8')) : {};
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	console.log(['RESULT', op, response.ok ? (response.result.window ?? 'ok') : response.error.code, 'END'].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`;

type StandaloneServer = Readonly<{
	pairingUrl: string;
	stop: () => Promise<void>;
}>;

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
		LOG.push(`${stamp()} server.err ${String(chunk).trimEnd().slice(0, 2000)}`);
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
async function expectShowing(window: Page, label: string) {
	await expect(async () => {
		const menu = await openConnectionMenu(window);
		await expect(
			menu.getByRole('menuitemradio', { name: label, exact: true }),
		).toHaveAttribute('aria-checked', 'true', { timeout: 2_000 });
	}).toPass({ timeout: 45_000 });
	await window.keyboard.press('Escape');
}
async function switchTo(window: Page, label: string) {
	const menu = await openConnectionMenu(window);
	await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
	await expectShowing(window, label);
}
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
	return serverHost;
}
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

const activeTerminal = (window: Page): Locator =>
	window.locator('.project-workspace--active .terminal-panel:visible').first();
const windowTitled = (window: Page, title: string): Locator =>
	window.locator('.app-window', {
		has: window.locator('.app-window__title', { hasText: title }),
	});

const LOG: string[] = [];
const stamp = () => new Date().toISOString().slice(11, 23);
/** Record main-process output and every page's console, including later windows. */
async function instrument(electronApp: ElectronApplication) {
	const child = electronApp.process();
	child.stdout?.on('data', (chunk) =>
		LOG.push(`${stamp()} main.out ${String(chunk).trimEnd()}`),
	);
	child.stderr?.on('data', (chunk) =>
		LOG.push(`${stamp()} main.err ${String(chunk).trimEnd()}`),
	);
	const hook = (page: Page) => {
		page.on('console', (m) =>
			LOG.push(
				`${stamp()} ${page.url().slice(0, 40)} ${m.type()} ${m.text().slice(0, 400)}`,
			),
		);
		page.on('pageerror', (e) => LOG.push(`${stamp()} pageerror ${e.message}`));
		page.on('crash', () => LOG.push(`${stamp()} crash`));
		page.on('load', () => {
			LOG.push(`${stamp()} load ${page.url().slice(0, 60)}`);
			void page
				.evaluate(() => {
					(
						globalThis as { __terminayClientDiagnostic?: (p: string) => void }
					).__terminayClientDiagnostic = (phase) => {
						if (!phase.startsWith('client.complete'))
							console.debug('[diag]', Math.round(performance.now()), phase);
					};
				})
				.catch(() => undefined);
		});
	};
	for (const page of electronApp.windows()) hook(page);
	electronApp.on('window', hook);
}

/** Watch a Desktop window for the failure the user sees, and its connections. */
function watch(window: Page) {
	const notes: string[] = [];
	window.on('crash', () => notes.push('renderer crashed'));
	window.on('load', () => notes.push('renderer loaded'));
	window.on('pageerror', (error) => notes.push(`pageerror: ${error.message}`));
	window.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning')
			notes.push(`${message.type()}: ${message.text().slice(0, 300)}`);
	});
	return notes;
}

/** The session works: no connect timeout, no stall, and the terminal answers. */
async function expectWorkingSession(
	window: Page,
	marker: string,
	notes: string[],
) {
	const why = () => notes.join('\n');
	await expect(
		window.getByText(/Session connect timed out/u),
		why(),
	).toHaveCount(0);
	const terminal = activeTerminal(window);
	await expect(terminal, why()).toBeVisible({ timeout: 45_000 });
	await expect(
		window.getByText('Terminal stream stalled. Reconnecting…'),
		why(),
	).toHaveCount(0, {
		timeout: 30_000,
	});
	await submitTerminalCommand(window, `echo ${marker}-$((6*7))`, terminal);
	await expect(terminal.locator('.xterm-rows'), why()).toContainText(
		`${marker}-42`,
		{ timeout: 30_000 },
	);
}

test('a remote server holding four large agent windows can be reconnected to', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(420_000);
	LOG.length = 0;
	await instrument(electronApp);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	const launches: Awaited<ReturnType<typeof launchDesktopApp>>[] = [];
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		await mainWindow.keyboard.press('Escape');
		if ((await mainWindow.locator('.project-tab[role="tab"]').count()) === 0) {
			await createStartedProject(mainWindow);
			await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
				0,
			);
		}
		const notes = watch(mainWindow);
		await expectWorkingSession(mainWindow, 'before-windows', notes);

		// The agent in this server terminal shows its four review windows.
		const script = path.join(tempDir, 'show-window.mjs');
		await writeFile(script, MCP_SCRIPT);
		const rows = activeTerminal(mainWindow).locator('.xterm-rows');
		for (const [index, fixture] of fixtures.entries()) {
			const file = path.join(tempDir, `show-window-${index}.json`);
			await writeFile(
				file,
				JSON.stringify({ title: fixture.title, html: fixture.html }),
			);
			await submitTerminalCommand(
				mainWindow,
				`'${process.execPath}' '${script}' show_window '${file}'`,
				activeTerminal(mainWindow),
			);
			await expect
				.poll(
					async () =>
						[
							...((await rows.textContent()) ?? '').matchAll(
								/RESULT show_window win_/gu,
							),
						].length,
					{
						timeout: 30_000,
						message: notes.join('\n'),
					},
				)
				.toBe(index + 1);
		}
		await expect(
			windowTitled(mainWindow, fixtures.at(-1)!.title),
		).toHaveAttribute('data-placement', 'window', {
			timeout: 30_000,
		});
		await expectWorkingSession(mainWindow, 'with-windows', notes);

		// Reconnect by switching away and back.
		await switchTo(mainWindow, 'Local');
		await switchTo(mainWindow, serverHost);
		await expectWorkingSession(mainWindow, 'after-switch', notes);

		// Reloading the window's document starts it a fresh lane.
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expectShowing(mainWindow, serverHost);
		await expectWorkingSession(mainWindow, 'after-reload', notes);

		// Reconnect by relaunching Desktop: it reopens on the server.
		await quitDesktop(electronApp);
		const launched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		launches.push(launched);
		LOG.push(`${stamp()} --- relaunch ---`);
		await instrument(launched.electronApp);
		const window = await prepareWindow(
			await launched.electronApp.firstWindow(),
		);
		const relaunchNotes = watch(window);
		await expectShowing(window, serverHost);
		await expectWorkingSession(window, 'after-relaunch', relaunchNotes);
		await expect(windowTitled(window, fixtures.at(-1)!.title)).toBeVisible({
			timeout: 30_000,
		});
		testInfo.annotations.push({
			type: 'notes',
			description: [...notes, ...relaunchNotes].join('\n') || 'none',
		});
	} finally {
		await writeFile(testInfo.outputPath('desktop-log.txt'), LOG.join('\n'));
		for (const launched of launches)
			await launched.close().catch(() => undefined);
		await server.stop();
	}
});
