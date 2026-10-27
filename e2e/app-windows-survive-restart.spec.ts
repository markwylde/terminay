import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
	ElectronApplication,
	FrameLocator,
	Locator,
	Page,
} from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { waitUntilBusy } from './support/busy-terminals';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * A window a terminal opened is still there when the terminal is.
 *
 * The window record is server-owned (terminal-app-windows), so a renderer
 * reload must not lose it; and a relaunch that brings the terminal back from
 * the session holder (ADR-0035) must bring its window back with it.
 */

const READY_TIMEOUT_MS = 20_000;

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

const panelFor = (page: Page, sessionId: string): Locator =>
	page.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
const windowTitled = (page: Page, title: string): Locator =>
	page.locator('.app-window', {
		has: page.locator('.app-window__title', { hasText: title }),
	});
const view = (card: Locator): FrameLocator =>
	card.frameLocator('.app-window__frame').frameLocator('iframe');

let paramsSequence = 0;

/** Make an MCP call from a terminal, as its agent would, and return what it printed. */
async function callFrom(
	page: Page,
	sessionId: string,
	userDataDir: string,
	op: string,
	params: Record<string, unknown>,
): Promise<string> {
	const script = path.join(userDataDir, 'app-window-restart-e2e.mjs');
	const file = path.join(
		userDataDir,
		`app-window-restart-params-${++paramsSequence}.json`,
	);
	await writeFile(script, MCP_SCRIPT);
	await writeFile(file, JSON.stringify(params));
	const rows = panelFor(page, sessionId).locator('.xterm-rows');
	// Rows run together in the text, so each result is fenced by its own END.
	const pattern = new RegExp(`RESULT ${op} (\\S+) END`, 'gu');
	const results = async () =>
		[...((await rows.textContent()) ?? '').matchAll(pattern)].map(
			(match) => match[1],
		);
	const before = (await results()).length;
	await submitTerminalCommand(
		page,
		`'${process.execPath}' '${script}' ${op} '${file}'`,
		panelFor(page, sessionId),
	);
	await expect
		.poll(async () => (await results()).length)
		.toBeGreaterThan(before);
	return (await results()).at(-1) ?? '';
}

/** Open a window from a terminal and return its handle. */
async function showWindow(
	page: Page,
	sessionId: string,
	userDataDir: string,
	title: string,
): Promise<string> {
	const handle = await callFrom(page, sessionId, userDataDir, 'show_window', {
		title,
		html: `<h1 id="greeting">${title} is still here</h1>`,
	});
	expect(handle).toMatch(/^win_/u);
	const card = windowTitled(page, title);
	await expect(card).toHaveAttribute('data-placement', 'window');
	await expect(view(card).locator('#greeting')).toHaveText(
		`${title} is still here`,
	);
	return handle;
}

function holderPids(userDataDir: string): number[] {
	const directory = path.join(userDataDir, 'session-holder');
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.flatMap((name) => {
			try {
				return [
					JSON.parse(readFileSync(path.join(directory, name), 'utf8'))
						.pid as number,
				];
			} catch {
				return [];
			}
		});
}

/** Quit the way the Quit menu item does, answering whether to keep the terminals. */
async function quitChoosing(
	electronApp: ElectronApplication,
	button: 'keep' | 'end',
): Promise<void> {
	await electronApp.evaluate(
		({ dialog }, response) => {
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response,
			});
		},
		button === 'keep' ? 0 : 1,
	);
	const child = electronApp.process();
	const exited = new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
	await electronApp
		.evaluate(({ app }) => {
			setImmediate(() => app.quit());
		})
		.catch(() => undefined);
	await Promise.race([
		exited,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('Terminay did not quit')), 30_000),
		),
	]);
}

/** Keep a foreground process running, like an agent at work, so quitting asks about it. */
async function keepBusy(
	electronApp: ElectronApplication,
	page: Page,
	sessionId: string,
): Promise<void> {
	await submitTerminalCommand(page, 'sleep 600', panelFor(page, sessionId));
	await waitUntilBusy(electronApp, page);
}

function killHolders(userDataDir: string): void {
	for (const pid of holderPids(userDataDir)) {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			/* already gone */
		}
	}
}

test('a window a terminal opened is still there after the workspace reloads', async ({
	electronApp,
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const sessionId = await settledTerminalSessionId(
		mainWindow.locator('.terminal-panel:visible'),
	);
	await showWindow(mainWindow, sessionId, userDataDir, 'Survivor');

	await mainWindow.reload({ waitUntil: 'domcontentloaded' });

	await expect(panelFor(mainWindow, sessionId)).toBeVisible({
		timeout: READY_TIMEOUT_MS,
	});
	const card = windowTitled(mainWindow, 'Survivor');
	await expect(card).toHaveAttribute('data-placement', 'window', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(view(card).locator('#greeting')).toHaveText(
		'Survivor is still here',
	);

	// Nothing may outlive the test: quit, ending the terminals.
	await keepBusy(electronApp, mainWindow, sessionId);
	await quitChoosing(electronApp, 'end');
});

test('the windows a terminal opened come back with that terminal after a relaunch, and its agent can still close them', async ({
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
	try {
		const sessionId = await settledTerminalSessionId(
			mainWindow.locator('.terminal-panel:visible'),
		);
		const first = await showWindow(mainWindow, sessionId, userDataDir, 'First');
		await showWindow(mainWindow, sessionId, userDataDir, 'Second');
		await expect(windowTitled(mainWindow, 'First')).toHaveAttribute(
			'data-placement',
			'tab',
		);
		await keepBusy(electronApp, mainWindow, sessionId);

		await quitChoosing(electronApp, 'keep');
		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const window = await prepareWindow(
			await relaunched.electronApp.firstWindow(),
		);

		// The terminal came back from the holder, and so did both its windows,
		// each as it was left.
		await expect(panelFor(window, sessionId)).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		const second = windowTitled(window, 'Second');
		await expect(second).toHaveAttribute('data-placement', 'window', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(view(second).locator('#greeting')).toHaveText(
			'Second is still here',
		);
		await expect(windowTitled(window, 'First')).toHaveAttribute(
			'data-placement',
			'tab',
		);

		// The agent's handle from before the quit still names its window.
		await panelFor(window, sessionId).locator('.xterm-helper-textarea').focus();
		await window.keyboard.press('Control+C');
		expect(
			await callFrom(window, sessionId, userDataDir, 'close_window', {
				window: first,
			}),
		).toBe(first);
		await expect(windowTitled(window, 'First')).toHaveCount(0);
		await expect(windowTitled(window, 'Second')).toHaveCount(1);
	} finally {
		await relaunched?.close().catch(() => undefined);
		killHolders(userDataDir);
	}
});

test('a window ends with its terminal when quitting ends the terminals', async ({
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
	try {
		const sessionId = await settledTerminalSessionId(
			mainWindow.locator('.terminal-panel:visible'),
		);
		await showWindow(mainWindow, sessionId, userDataDir, 'Ephemeral');
		await keepBusy(electronApp, mainWindow, sessionId);

		await quitChoosing(electronApp, 'end');
		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const window = await prepareWindow(
			await relaunched.electronApp.firstWindow(),
		);
		await expect(window.locator('.terminal-panel:visible')).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		await expect(window.locator('.app-window')).toHaveCount(0);
		const store = path.join(userDataDir, 'app-windows');
		expect(existsSync(store) ? readdirSync(store) : []).toEqual([]);
	} finally {
		await relaunched?.close().catch(() => undefined);
		killHolders(userDataDir);
	}
});
