import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * The expanded workflow panel's width (terminal-workflows, issue #538): a
 * separator on its left edge resizes it live without covering the terminal,
 * the keyboard steps it, the width is the device's for every terminal, and a
 * pane draws it narrower rather than squeeze its terminal below 60 columns.
 */

const READY_TIMEOUT_MS = 20_000;
const SETTING_KEY = 'terminay.workflowPanel.v1';
const WIDTH_KEY = 'terminay.workflowPanelWidth.v1';

const MCP_SCRIPT = `
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile, outFile] = process.argv.slice(2);
const params = JSON.parse(readFileSync(paramsFile, 'utf8'));
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	writeFileSync(outFile, buffer.slice(0, end));
	socket.end();
});
socket.on('error', (error) => {
	writeFileSync(outFile, JSON.stringify({ ok: false, error: { code: 'socket', message: error.message } }));
});
`;

type Response = { ok: boolean; result?: Record<string, unknown>; error?: { code: string } };

function mcpFrom(page: Page, userDataDir: string) {
	let sequence = 0;
	const script = path.join(userDataDir, 'workflow-width-e2e.mjs');
	return async (panel: Locator, op: string, params: Record<string, unknown>): Promise<Response> => {
		await writeFile(script, MCP_SCRIPT);
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `workflow-width-${n}.json`);
		const outFile = path.join(userDataDir, `workflow-width-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`, panel);
		await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
		return JSON.parse(await readFile(outFile, 'utf8')) as Response;
	};
}

const workflowPanel = (page: Page, sessionId: string): Locator =>
	terminalPanelForSession(page, sessionId).locator('.workflow-panel');
const separatorOf = (page: Page, sessionId: string): Locator =>
	workflowPanel(page, sessionId).getByRole('separator', { name: 'Resize workflow panel' });

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await locator.boundingBox();
	if (box === null) throw new Error('element has no box');
	return box;
}

const panelWidth = async (page: Page, sessionId: string) => Math.round((await boxOf(workflowPanel(page, sessionId))).width);
const storedWidth = (page: Page) => page.evaluate((key) => localStorage.getItem(key), WIDTH_KEY);

/**
 * The terminal's drawn right edge ends at or before the panel's left edge
 * once the terminal has refitted (it refits on the next animation frame).
 */
async function expectTerminalUncovered(page: Page, sessionId: string): Promise<void> {
	await expect
		.poll(async () => {
			const screen = await boxOf(terminalPanelForSession(page, sessionId).locator('.xterm-screen'));
			const panel = await boxOf(workflowPanel(page, sessionId));
			return screen.x + screen.width - (panel.x + 1);
		})
		.toBeLessThanOrEqual(0);
}

const terminalScreenWidth = (page: Page, sessionId: string) =>
	terminalPanelForSession(page, sessionId)
		.locator('.xterm-screen')
		.evaluate((element) => Math.round(element.getBoundingClientRect().width));

/** Another window of this device changing a setting, as the app hears it. */
async function setFromAnotherWindow(page: Page, key: string, value: string): Promise<void> {
	await page.evaluate(
		([k, v]) => {
			localStorage.setItem(k, v);
			window.dispatchEvent(new StorageEvent('storage', { key: k }));
		},
		[key, value] as const,
	);
}

test('the expanded workflow panel resizes by drag and keyboard, never covers its terminal, and keeps its width', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(1600, 900);
	});
	const mcp = mcpFrom(mainWindow, userDataDir);
	const caller = await activeTerminalSessionId(mainWindow);
	const callerPanel = terminalPanelForSession(mainWindow, caller);
	const created = await mcp(callerPanel, 'create_workflow', {
		name: 'Resizable',
		steps: [{ title: 'Propose the change' }, { title: 'Implement every task in the change' }, { title: 'Open the pull request' }],
	});
	expect(created.ok).toBe(true);
	await setFromAnotherWindow(mainWindow, SETTING_KEY, 'expanded');
	await expect(workflowPanel(mainWindow, caller)).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });

	// The default width, with the rail and overlay offering no separator.
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(264);
	const separator = separatorOf(mainWindow, caller);
	await expect(separator).toHaveAttribute('tabindex', '0');
	await expect(separator).toHaveAttribute('aria-valuenow', '264');
	await expect(separator).toHaveAttribute('aria-valuemin', '200');
	await expectTerminalUncovered(mainWindow, caller);
	await mainWindow.screenshot({ path: testInfo.outputPath('workflow-panel-default.png') });

	// Drag 100px to the left: the panel grows live and the terminal narrows with it.
	const before = await terminalScreenWidth(mainWindow, caller);
	const handle = await boxOf(separator);
	const startX = handle.x + handle.width / 2;
	const y = handle.y + handle.height / 2;
	await mainWindow.mouse.move(startX, y);
	await mainWindow.mouse.down();
	await mainWindow.mouse.move(startX - 50, y, { steps: 5 });
	await mainWindow.mouse.move(startX - 100, y, { steps: 5 });
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(364);
	await expect.poll(() => terminalScreenWidth(mainWindow, caller)).toBeLessThan(before);
	await expectTerminalUncovered(mainWindow, caller);
	expect(await storedWidth(mainWindow), 'nothing is committed mid-drag').toBeNull();
	await mainWindow.mouse.up();
	await expect.poll(() => storedWidth(mainWindow)).toBe('364');
	await expect(separator).toHaveAttribute('aria-valuenow', '364');
	await expectTerminalUncovered(mainWindow, caller);
	await mainWindow.screenshot({ path: testInfo.outputPath('workflow-panel-widened.png') });

	// A cancelled drag puts the panel and terminal back and commits nothing.
	const widenedTerminal = await terminalScreenWidth(mainWindow, caller);
	const cancelFrom = await boxOf(separator);
	await mainWindow.mouse.move(cancelFrom.x + cancelFrom.width / 2, y);
	await mainWindow.mouse.down();
	await mainWindow.mouse.move(cancelFrom.x - 80, y, { steps: 5 });
	await expect.poll(() => panelWidth(mainWindow, caller)).toBeGreaterThan(364);
	await mainWindow.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
	await mainWindow.mouse.up();
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(364);
	await expect.poll(() => terminalScreenWidth(mainWindow, caller)).toBe(widenedTerminal);
	expect(await storedWidth(mainWindow)).toBe('364');

	// The keyboard: Tab-reachable, 16px a press.
	await separator.focus();
	await expect(separator).toBeFocused();
	await mainWindow.keyboard.press('ArrowRight');
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(348);
	await mainWindow.keyboard.press('ArrowLeft');
	await mainWindow.keyboard.press('ArrowLeft');
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(380);
	expect(await storedWidth(mainWindow)).toBe('380');

	// Bounds: the minimum, and the maximum or the pane's 60-column limit.
	const dragBy = async (dx: number) => {
		const from = await boxOf(separator);
		const x = from.x + from.width / 2;
		await mainWindow.mouse.move(x, y);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(x + dx, y, { steps: 10 });
		await mainWindow.mouse.up();
	};
	await dragBy(600);
	await expect.poll(() => storedWidth(mainWindow)).toBe('200');
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(200);
	await dragBy(-1200);
	const max = Number(await separator.getAttribute('aria-valuemax'));
	expect(max).toBeLessThanOrEqual(640);
	await expect.poll(() => panelWidth(mainWindow, caller)).toBe(max);
	await expectTerminalUncovered(mainWindow, caller);

	// The width survives a reload.
	await dragBy(Math.round((await panelWidth(mainWindow, caller)) - 420));
	await expect.poll(() => storedWidth(mainWindow)).toBe('420');
	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	await expect(workflowPanel(mainWindow, caller)).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });
	await expect.poll(() => panelWidth(mainWindow, caller), { timeout: READY_TIMEOUT_MS }).toBe(420);
});

test('split panes share one chosen width, each drawing it narrower as its own space requires', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	// Wide enough that each half keeps 60 columns beside the minimum panel,
	// and narrow enough that neither fits the widest one.
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(2400, 1000);
	});
	const mcp = mcpFrom(mainWindow, userDataDir);
	const caller = await activeTerminalSessionId(mainWindow);
	const callerPanel = terminalPanelForSession(mainWindow, caller);
	const split =await mcp(callerPanel, 'split_terminal', { terminal: caller, direction: 'right' });
	expect(split.ok).toBe(true);
	const other = split.result?.terminal as string;
	for (const terminal of [caller, other]) {
		const created = await mcp(callerPanel, 'create_workflow', {
			terminal,
			name: `Split ${terminal === caller ? 'left' : 'right'}`,
			steps: [{ title: 'One' }, { title: 'Two' }],
		});
		expect(created.ok).toBe(true);
	}
	await setFromAnotherWindow(mainWindow, SETTING_KEY, 'expanded');
	for (const terminal of [caller, other])
		await expect(workflowPanel(mainWindow, terminal)).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });

	// Resizing one panel resizes the other.
	await separatorOf(mainWindow, caller).focus();
	await mainWindow.keyboard.press('ArrowLeft');
	await expect.poll(() => storedWidth(mainWindow)).toBe('280');
	for (const terminal of [caller, other]) await expect.poll(() => panelWidth(mainWindow, terminal)).toBe(280);

	// The widest choice: each half-width pane draws it narrower to keep 60 columns.
	await setFromAnotherWindow(mainWindow, WIDTH_KEY, '640');
	for (const terminal of [caller, other]) {
		const separator = separatorOf(mainWindow, terminal);
		await expect.poll(async () => Number(await separator.getAttribute('aria-valuemax'))).toBeLessThan(640);
		const max = Number(await separator.getAttribute('aria-valuemax'));
		await expect.poll(() => panelWidth(mainWindow, terminal)).toBe(max);
		await expectTerminalUncovered(mainWindow, terminal);
	}
	await mainWindow.screenshot({ path: testInfo.outputPath('workflow-panel-split.png') });

	// Clicking a narrowed panel's separator keeps the chosen width.
	const handle = await boxOf(separatorOf(mainWindow, other));
	await mainWindow.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
	expect(await storedWidth(mainWindow)).toBe('640');
});
