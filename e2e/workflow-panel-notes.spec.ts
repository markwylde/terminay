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
 * How the workflow panel shows step notes (terminal-workflows, issue #539):
 * Full, 2 lines, or Current only, chosen from a dropdown in the panel's
 * header, as Home's Workflows section offers. One device-local choice for
 * every terminal, separate from Home's.
 */

const READY_TIMEOUT_MS = 20_000;
const SETTING_KEY = 'terminay.workflowPanel.v1';
const WIDTH_KEY = 'terminay.workflowPanelWidth.v1';
const NOTES_KEY = 'terminay.workflowPanelNotes.v1';
const HOME_VIEW_KEY = 'terminay.workflowsHome.view.v1';

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

type Step = { id: string; status: string };
type Response = {
	ok: boolean;
	result?: { terminal?: string; workflow?: { steps: Step[] } } & Record<string, unknown>;
	error?: { code: string };
};

function mcpFrom(page: Page, userDataDir: string) {
	let sequence = 0;
	const script = path.join(userDataDir, 'workflow-notes-e2e.mjs');
	return async (panel: Locator, op: string, params: Record<string, unknown>): Promise<Response> => {
		await writeFile(script, MCP_SCRIPT);
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `workflow-notes-${n}.json`);
		const outFile = path.join(userDataDir, `workflow-notes-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`, panel);
		await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
		return JSON.parse(await readFile(outFile, 'utf8')) as Response;
	};
}

const workflowPanel = (page: Page, sessionId: string): Locator =>
	terminalPanelForSession(page, sessionId).locator('.workflow-panel');
const notesSelect = (scope: Locator): Locator => scope.getByRole('combobox', { name: 'Step notes' });
const shownNotes = (scope: Locator): Promise<string[]> =>
	scope.locator('.workflow-step-note').allTextContents();

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await locator.boundingBox();
	if (box === null) throw new Error('element has no box');
	return box;
}

/** The control lies wholly inside the container. */
async function expectInside(control: Locator, container: Locator): Promise<void> {
	const inner = await boxOf(control);
	const outer = await boxOf(container);
	expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
	expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
	expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
	expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 0.5);
}

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

const storedNotes = (page: Page) => page.evaluate((key) => localStorage.getItem(key), NOTES_KEY);

// One line of at most 200 characters, long enough to wrap in the panel.
const LONG_NOTE = `long: ${'proposal written and every scenario checked against the spec '.repeat(3)}`
	.slice(0, 200)
	.trim();

test('the panel shows notes Full, cut to 2 lines, or for Current only, and remembers the choice apart from Home', async ({
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
	const terminal = await activeTerminalSessionId(mainWindow);
	const terminalPanel = terminalPanelForSession(mainWindow, terminal);
	const created = await mcp(terminalPanel, 'create_workflow', {
		name: 'OpenSpec: Propose → Ship, a name longer than the narrowest panel',
		steps: [
			{ title: 'Propose' },
			{ title: 'Review' },
			{ title: 'Amend' },
			{ title: 'Implement' },
			{ title: 'Verify' },
		],
	});
	expect(created.ok).toBe(true);
	const ids = (created.result?.workflow?.steps ?? []).map((step) => step.id);
	expect(ids).toHaveLength(5);
	const update = async (index: number, status: string, note?: string) => {
		const response = await mcp(terminalPanel, 'update_workflow_step', {
			step_id: ids[index],
			status,
			...(note === undefined ? {} : { note }),
		});
		expect(response.ok, `${status} ${index}`).toBe(true);
	};
	await update(0, 'done', LONG_NOTE);
	await update(1, 'failed', 'codex: 2 findings');
	await update(2, 'skipped', 'not needed');
	await update(3, 'running', 'writing the select');
	// Home's own choice, to show the panel never touches it.
	await setFromAnotherWindow(mainWindow, HOME_VIEW_KEY, JSON.stringify({ notes: 'full' }));
	await setFromAnotherWindow(mainWindow, SETTING_KEY, 'expanded');
	const panel = workflowPanel(mainWindow, terminal);
	await expect(panel).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });
	const select = notesSelect(panel);
	const firstNote = panel.locator('.workflow-step .workflow-step-note').first();

	// Full by default: every note, whole.
	await expect(select).toHaveValue('full');
	expect(await storedNotes(mainWindow)).toBeNull();
	await expect.poll(() => shownNotes(panel)).toEqual([LONG_NOTE, 'codex: 2 findings', 'not needed', 'writing the select']);
	const fullHeight = (await boxOf(firstNote)).height;
	const lineHeight = await firstNote.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
	expect(fullHeight).toBeGreaterThan(lineHeight * 2.5);
	await mainWindow.screenshot({ path: testInfo.outputPath('notes-full.png') });
	await panel.screenshot({ path: testInfo.outputPath('notes-full-panel.png') });

	// 2 lines: the long note is cut to two lines; its text is unchanged.
	await select.selectOption('short');
	await expect(panel).toHaveClass(/workflow-panel--notes-short/);
	await expect.poll(() => storedNotes(mainWindow)).toBe('short');
	await expect.poll(async () => (await boxOf(firstNote)).height).toBeLessThanOrEqual(lineHeight * 2 + 1);
	await expect(firstNote).toHaveAttribute('title', LONG_NOTE);
	expect(await shownNotes(panel)).toHaveLength(4);
	await panel.screenshot({ path: testInfo.outputPath('notes-2-lines-panel.png') });

	// Current only: the failed and running steps' notes; every step still listed.
	await select.selectOption('current');
	await expect.poll(() => shownNotes(panel)).toEqual(['codex: 2 findings', 'writing the select']);
	await expect(panel.locator('.workflow-step')).toHaveCount(5);
	await panel.screenshot({ path: testInfo.outputPath('notes-current-only-panel.png') });

	// The shown note follows its step's status.
	await update(3, 'done');
	await update(4, 'needs_input', 'Merge now?');
	await expect.poll(() => shownNotes(panel)).toEqual(['codex: 2 findings', 'Merge now?']);

	// Home keeps its own choice, and its changes leave the panel alone.
	expect(JSON.parse((await mainWindow.evaluate((key) => localStorage.getItem(key), HOME_VIEW_KEY)) ?? '{}').notes).toBe('full');
	await setFromAnotherWindow(mainWindow, HOME_VIEW_KEY, JSON.stringify({ notes: 'short' }));
	await expect(select).toHaveValue('current');

	// Back to Full: every note, whole again.
	await select.selectOption('full');
	await expect.poll(() => shownNotes(panel)).toEqual([LONG_NOTE, 'codex: 2 findings', 'not needed', 'writing the select', 'Merge now?']);
	await expect.poll(async () => (await boxOf(firstNote)).height).toBeGreaterThan(lineHeight * 2.5);

	// The choice survives a reload.
	await select.selectOption('current');
	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	await expect(workflowPanel(mainWindow, terminal)).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });
	await expect(notesSelect(workflowPanel(mainWindow, terminal))).toHaveValue('current');
	await expect.poll(() => shownNotes(workflowPanel(mainWindow, terminal))).toEqual(['codex: 2 findings', 'Merge now?']);

	// A stored value that is not one of the three reads as Full.
	await setFromAnotherWindow(mainWindow, NOTES_KEY, 'none');
	await expect(notesSelect(workflowPanel(mainWindow, terminal))).toHaveValue('full');

	// At the narrowest panel, a long name wraps and both controls stay whole.
	await setFromAnotherWindow(mainWindow, WIDTH_KEY, '200');
	const narrow = workflowPanel(mainWindow, terminal);
	await expect.poll(async () => Math.round((await boxOf(narrow)).width)).toBe(200);
	await expectInside(notesSelect(narrow), narrow);
	await expectInside(narrow.getByRole('button', { name: 'Collapse workflow' }), narrow);
	await narrow.screenshot({ path: testInfo.outputPath('notes-panel-200px.png') });

	await mainWindow.evaluate((keys) => {
		for (const key of keys) localStorage.removeItem(key);
	}, [SETTING_KEY, WIDTH_KEY, NOTES_KEY, HOME_VIEW_KEY]);
});

test('split panes share one note density', async ({ electronApp, mainWindow, userDataDir }) => {
	test.setTimeout(180_000);
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(2400, 1000);
	});
	const mcp = mcpFrom(mainWindow, userDataDir);
	const caller = await activeTerminalSessionId(mainWindow);
	const callerPanel = terminalPanelForSession(mainWindow, caller);
	const split = await mcp(callerPanel, 'split_terminal', { terminal: caller, direction: 'right' });
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

	await notesSelect(workflowPanel(mainWindow, other)).selectOption('short');
	for (const terminal of [caller, other]) {
		await expect(workflowPanel(mainWindow, terminal)).toHaveClass(/workflow-panel--notes-short/);
		await expect(notesSelect(workflowPanel(mainWindow, terminal))).toHaveValue('short');
	}
	await mainWindow.evaluate((keys) => {
		for (const key of keys) localStorage.removeItem(key);
	}, [SETTING_KEY, NOTES_KEY]);
});

test('in a narrow pane the overlay takes a density from the keyboard without reaching the terminal', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	const mcp = mcpFrom(mainWindow, userDataDir);
	const terminal = await activeTerminalSessionId(mainWindow);
	const terminalPanel = terminalPanelForSession(mainWindow, terminal);
	const created = await mcp(terminalPanel, 'create_workflow', {
		name: 'A workflow name much longer than the overlay is wide',
		steps: [{ title: 'One' }, { title: 'Two' }],
	});
	expect(created.ok).toBe(true);
	const ids = (created.result?.workflow?.steps ?? []).map((step) => step.id);
	expect((await mcp(terminalPanel, 'update_workflow_step', { step_id: ids[0], status: 'done', note: 'first done' })).ok).toBe(true);
	expect((await mcp(terminalPanel, 'update_workflow_step', { step_id: ids[1], status: 'running', note: 'second running' })).ok).toBe(true);

	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(480, 640);
	});
	const panel = workflowPanel(mainWindow, terminal);
	await expect(panel).toHaveAttribute('data-workflow-mode', 'forced-collapsed', { timeout: READY_TIMEOUT_MS });
	await panel.getByRole('button', { name: 'Expand workflow' }).click();
	const overlay = panel.getByRole('dialog', { name: 'Workflow' });
	await expect(overlay).toBeFocused();
	await expect.poll(() => shownNotes(overlay)).toEqual(['first done', 'second running']);

	// The header fits however narrow the overlay is.
	const select = notesSelect(overlay);
	await expectInside(select, overlay);
	await expectInside(overlay.getByRole('button', { name: 'Collapse workflow' }), overlay);
	testInfo.annotations.push({ type: 'overlay width', description: String(Math.round((await boxOf(overlay)).width)) });

	// Choose Current only with the keyboard: the overlay stays, the terminal hears nothing.
	const rows = terminalPanel.locator('.xterm-rows');
	const typedBefore = (await rows.textContent()) ?? '';
	await select.focus();
	await mainWindow.keyboard.press('ArrowDown');
	await mainWindow.keyboard.press('ArrowDown');
	await expect(select).toHaveValue('current');
	await expect(overlay).toBeVisible();
	await expect.poll(() => shownNotes(overlay)).toEqual(['second running']);
	expect((await rows.textContent()) ?? '').toBe(typedBefore);
	await mainWindow.screenshot({ path: testInfo.outputPath('notes-overlay-current-only.png') });

	// Escape still closes it, and reopening keeps the choice.
	await mainWindow.keyboard.press('Escape');
	await expect(overlay).toHaveCount(0);
	await panel.getByRole('button', { name: 'Expand workflow' }).click();
	await expect(overlay).toBeFocused();
	await expect(notesSelect(overlay)).toHaveValue('current');
	await mainWindow.keyboard.press('Escape');
	await expect(overlay).toHaveCount(0);

	// An overlay narrower than the panel's minimum still shows both controls whole.
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(220, 640);
	});
	await expect
		.poll(async () => Math.round((await boxOf(terminalPanel)).width), { timeout: READY_TIMEOUT_MS })
		.toBeLessThan(230);
	await panel.getByRole('button', { name: 'Expand workflow' }).click();
	await expect(overlay).toBeFocused();
	expect((await boxOf(overlay)).width).toBeLessThan(200);
	await expectInside(notesSelect(overlay), overlay);
	await expectInside(overlay.getByRole('button', { name: 'Collapse workflow' }), overlay);
	await mainWindow.screenshot({ path: testInfo.outputPath('notes-overlay-narrowest.png') });
	await mainWindow.keyboard.press('Escape');
	await mainWindow.evaluate((key) => localStorage.removeItem(key), NOTES_KEY);
});
