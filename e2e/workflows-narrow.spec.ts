import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * A workflow panel in a pane too narrow for it expanded (ADR-0097): it stays
 * a rail, and its overlay never resizes the terminal or takes its keys.
 */

const READY_TIMEOUT_MS = 20_000;

const MCP_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile] = process.argv.slice(2);
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
	const response = JSON.parse(buffer.slice(0, end));
	const steps = response.ok ? (response.result.workflow?.steps ?? []) : [];
	console.log(['RESULT', op, response.ok ? steps.map((step) => step.status).join(',') : response.error.code, 'END'].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`;

const panelFor = (page: Page, sessionId: string): Locator =>
	page.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
const workflowPanel = (page: Page, sessionId: string): Locator =>
	panelFor(page, sessionId).locator('.workflow-panel');
const markers = (page: Page, sessionId: string): Locator =>
	workflowPanel(page, sessionId).locator('.workflow-marker[data-status]');
const rail = (page: Page, sessionId: string): Locator => workflowPanel(page, sessionId).locator('.workflow-rail');
const overlayOf = (page: Page, sessionId: string): Locator =>
	workflowPanel(page, sessionId).getByRole('dialog', { name: 'Workflow' });

/** The overlay replaces the rail: nothing of the rail shows behind it. */
async function expectRailHidden(page: Page, sessionId: string): Promise<void> {
	await expect(rail(page, sessionId)).toHaveCount(0);
	await expect(workflowPanel(page, sessionId).locator('.workflow-rail-step')).toHaveCount(0);
	await expect(workflowPanel(page, sessionId).getByRole('button', { name: 'Expand workflow' })).toHaveCount(0);
}

/** Once the overlay closes in a narrow pane, the rail is back whole. */
async function expectRailBack(page: Page, sessionId: string): Promise<void> {
	await expect(overlayOf(page, sessionId)).toHaveCount(0);
	await expect(rail(page, sessionId)).toHaveCount(1);
	await expect(workflowPanel(page, sessionId).locator('.workflow-rail-step')).toHaveCount(2);
	await expect(workflowPanel(page, sessionId).getByRole('button', { name: 'Expand workflow' })).toBeVisible();
}

/** Make an MCP call from a terminal, as its agent would. */
async function callFrom(
	page: Page,
	sessionId: string,
	userDataDir: string,
	op: string,
	params: Record<string, unknown>,
): Promise<string> {
	const script = path.join(userDataDir, 'workflow-narrow-e2e.mjs');
	const file = path.join(userDataDir, 'workflow-narrow-params.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(file, JSON.stringify(params));
	const rows = panelFor(page, sessionId).locator('.xterm-rows');
	const pattern = new RegExp(`RESULT ${op} (\\S+) END`, 'gu');
	const results = async () => [...((await rows.textContent()) ?? '').matchAll(pattern)].map((match) => match[1]);
	const before = (await results()).length;
	await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${file}'`, panelFor(page, sessionId));
	await expect.poll(async () => (await results()).length).toBeGreaterThan(before);
	return (await results()).at(-1) ?? '';
}

test('in a narrow pane the expanded panel opens over the terminal and gives the keyboard back on Escape', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(120_000);
	const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
	const panel = panelFor(mainWindow, sessionId);
	expect(
		await callFrom(mainWindow, sessionId, userDataDir, 'create_workflow', {
			name: 'Narrow',
			steps: [{ title: 'One' }, { title: 'Two' }],
		}),
	).toBe('not_started,not_started');
	await expect(markers(mainWindow, sessionId)).toHaveCount(2);

	// Narrow the window until the pane cannot fit 60 columns beside the panel.
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(560, 640);
	});
	// With the setting collapsed, expanding a narrow pane opens the overlay at
	// once and leaves the setting alone.
	await expect(workflowPanel(mainWindow, sessionId)).toHaveAttribute('data-workflow-mode', 'forced-collapsed', { timeout: READY_TIMEOUT_MS });
	await mainWindow.screenshot({ path: testInfo.outputPath('narrow-rail.png') });
	await workflowPanel(mainWindow, sessionId).getByRole('button', { name: 'Expand workflow' }).click();
	await expect(overlayOf(mainWindow, sessionId)).toBeFocused();
	await expectRailHidden(mainWindow, sessionId);
	await mainWindow.screenshot({ path: testInfo.outputPath('narrow-overlay.png') });
	await mainWindow.keyboard.press('Escape');
	await expectRailBack(mainWindow, sessionId);
	await mainWindow.screenshot({ path: testInfo.outputPath('narrow-rail-restored.png') });
	expect(await mainWindow.evaluate(() => localStorage.getItem('terminay.workflowPanel.v1'))).toBeNull();

	await mainWindow.evaluate(() => localStorage.setItem('terminay.workflowPanel.v1', 'expanded'));
	await mainWindow.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'terminay.workflowPanel.v1' })));
	await expect(workflowPanel(mainWindow, sessionId)).toHaveAttribute('data-workflow-mode', 'forced-collapsed', { timeout: READY_TIMEOUT_MS });

	// The terminal's own width: what its column count is fitted to.
	const columns = () => panel.evaluate((element) => element.querySelector('.xterm-screen')?.getBoundingClientRect().width ?? -1);
	const before = await columns();
	await workflowPanel(mainWindow, sessionId).getByRole('button', { name: 'Expand workflow' }).click();
	const overlay = workflowPanel(mainWindow, sessionId).getByRole('dialog', { name: 'Workflow' });
	await expect(overlay).toBeFocused();
	await expectRailHidden(mainWindow, sessionId);
	// Keys pressed in the overlay never reach the terminal.
	const typedBefore = (await panel.locator('.xterm-rows').textContent()) ?? '';
	await mainWindow.keyboard.type('zqzqzq');
	expect((await panel.locator('.xterm-rows').textContent()) ?? '').toBe(typedBefore);
	expect(await columns()).toBe(before);
	await mainWindow.keyboard.press('Escape');
	await expect(overlay).toHaveCount(0);
	await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
	await expectRailBack(mainWindow, sessionId);
	// The setting itself is unchanged.
	expect(await mainWindow.evaluate(() => localStorage.getItem('terminay.workflowPanel.v1'))).toBe('expanded');

	// The overlay's own collapse control closes it and brings the rail back.
	await workflowPanel(mainWindow, sessionId).getByRole('button', { name: 'Expand workflow' }).click();
	await expect(overlay).toBeFocused();
	await expectRailHidden(mainWindow, sessionId);
	await overlay.getByRole('button', { name: 'Collapse workflow' }).click();
	await expectRailBack(mainWindow, sessionId);
	await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
	expect(await columns()).toBe(before);
	expect(await mainWindow.evaluate(() => localStorage.getItem('terminay.workflowPanel.v1'))).toBe('expanded');

	// Moving focus to the terminal closes it and brings the rail back.
	await workflowPanel(mainWindow, sessionId).getByRole('button', { name: 'Expand workflow' }).click();
	await expect(overlay).toBeFocused();
	await expectRailHidden(mainWindow, sessionId);
	await panel.locator('.xterm-helper-textarea').focus();
	await expectRailBack(mainWindow, sessionId);
	expect(await columns()).toBe(before);
	expect(await mainWindow.evaluate(() => localStorage.getItem('terminay.workflowPanel.v1'))).toBe('expanded');

	// Widening the pane while the overlay is open gives the expanded panel, not the rail.
	await workflowPanel(mainWindow, sessionId).getByRole('button', { name: 'Expand workflow' }).click();
	await expect(overlay).toBeFocused();
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
		window?.setSize(1400, 900);
	});
	await expect(workflowPanel(mainWindow, sessionId)).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });
	await expect(overlay).toHaveCount(0);
	await expect(rail(mainWindow, sessionId)).toHaveCount(0);
	await expect(workflowPanel(mainWindow, sessionId).getByRole('button', { name: 'Collapse workflow' })).toBeVisible();
	await mainWindow.evaluate(() => localStorage.removeItem('terminay.workflowPanel.v1'));
});
