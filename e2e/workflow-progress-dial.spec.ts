import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	createTerminal,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * A terminal's workflow progress as a dial (terminal-workflows): on its tab
 * just before the close button, on its Tabs sidebar row and its compact
 * switcher row, coloured by state, named in words, and hidden once a finished
 * workflow has been seen. Terminal B drives terminal A's workflow over MCP,
 * as another agent would, so A stays in the background while it changes.
 */

const READY_TIMEOUT_MS = 20_000;
const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;

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

type Response = {
	ok: boolean;
	result?: { workflow?: { steps: { id: string; status: string }[] } };
	error?: { code: string; message: string };
};

function mcpFrom(page: Page, userDataDir: string) {
	let sequence = 0;
	const script = path.join(userDataDir, 'workflow-dial-e2e.mjs');
	return async (panel: Locator, op: string, params: Record<string, unknown>): Promise<Response> => {
		if (sequence === 0) await writeFile(script, MCP_SCRIPT);
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `workflow-dial-${n}.json`);
		const outFile = path.join(userDataDir, `workflow-dial-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`, panel);
		await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
		const response = JSON.parse(await readFile(outFile, 'utf8')) as Response;
		expect(response.ok, JSON.stringify(response)).toBe(true);
		return response;
	};
}

const sidebarRow = (page: Page, sessionId: string): Locator =>
	page.locator(`.project-workspace--active [data-folder-terminal-session="${sessionId}"]`);

async function tabFor(page: Page, sessionId: string): Promise<Locator> {
	const panelId = await sidebarRow(page, sessionId).getAttribute('data-folder-panel');
	expect(panelId).toBeTruthy();
	return page.locator(`.project-workspace--active .terminal-tab-content[data-panel-id="${panelId}"]`);
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	await page.screenshot({ path: testInfo.outputPath('screenshots', `${name}.png`) });
}

async function resize(page: Page, electronApp: ElectronApplication, bounds: typeof PHONE): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => window.setBounds(next), bounds);
}

const TITLES = ['Propose', 'Review', 'Amend', 'Implement', 'Verify', 'E2E', 'Open PR', 'CI green'];

test('a workflow shows as a dial on its tab and rows, named in words, and hides once its completion is seen', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(240_000);
	const mcp = mcpFrom(mainWindow, userDataDir);

	const a = await activeTerminalSessionId(mainWindow);
	const panelA = terminalPanelForSession(mainWindow, a);
	const created = await mcp(panelA, 'create_workflow', {
		name: 'OpenSpec: Propose → Ship',
		steps: TITLES.map((title) => ({ title })),
	});
	const ids = (created.result?.workflow?.steps ?? []).map((step) => step.id);
	expect(ids).toHaveLength(8);

	// B drives A's workflow; A stays in the background.
	const b = await createTerminal(mainWindow);
	const panelB = terminalPanelForSession(mainWindow, b);
	const set = (index: number, status: string) =>
		mcp(panelB, 'update_workflow_step', { terminal: a, step_id: ids[index], status });

	const panelIdA = await sidebarRow(mainWindow, a).getAttribute('data-folder-panel');
	const tabA = await tabFor(mainWindow, a);
	const tabDial = tabA.locator('.workflow-dial');
	const rowDial = sidebarRow(mainWindow, a).locator('.workflow-dial');

	// Not started: a grey dial that names the next step.
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'idle', { timeout: READY_TIMEOUT_MS });
	await expect(tabDial).toHaveAttribute('aria-label', 'Next: Propose · 0 of 8');

	// Three done and the fourth running: amber, three eighths, no count text.
	for (const index of [0, 1, 2]) await set(index, 'done');
	await set(3, 'running');
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'running', { timeout: READY_TIMEOUT_MS });
	await expect(tabDial).toHaveAttribute('data-workflow-dial-done', '3');
	await expect(tabDial).toHaveAttribute('data-workflow-dial-total', '8');
	await expect(tabDial).toHaveAttribute('aria-label', /^Implement · 3 of 8 · \d+s$/u);
	await expect(tabA).not.toContainText('3/8');
	await expect(rowDial).toHaveAttribute('aria-label', (await tabDial.getAttribute('aria-label')) ?? '');

	// The dial sits just before the close button, keeps its size, and does not
	// move when the close button shows.
	expect(
		await tabDial.evaluate((element) => element.nextElementSibling?.classList.contains('terminal-tab-close') ?? false),
	).toBe(true);
	const before = await tabDial.boundingBox();
	expect(Math.round(before?.width ?? 0)).toBe(12);
	await tabA.hover();
	const after = await tabDial.boundingBox();
	expect(after).toEqual(before);
	await shot(mainWindow, testInfo, '01-running-tab-and-sidebar');

	// A failed step beside the running one: red, and the name says both.
	await set(1, 'failed');
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'alert', { timeout: READY_TIMEOUT_MS });
	await expect(tabDial).toHaveAttribute('aria-label', /^Implement · 2 of 8 · \d+s · Review failed$/u);
	await shot(mainWindow, testInfo, '02-failed-beside-running');
	await set(1, 'done');

	// Needing the user: red, and named as needing you.
	await set(3, 'needs_input');
	await expect(tabDial).toHaveAttribute('aria-label', /^Implement needs you · 3 of 8 · \d+s$/u, { timeout: READY_TIMEOUT_MS });
	await expect(rowDial).toHaveAttribute('data-workflow-dial', 'alert');
	await shot(mainWindow, testInfo, '03-needs-input');

	// Finished in the background: full green on the tab and the row.
	for (const index of [3, 4, 5, 6, 7]) await set(index, 'done');
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'done', { timeout: READY_TIMEOUT_MS });
	await expect(tabDial).toHaveAttribute('aria-label', 'All 8 steps done');
	await expect(rowDial).toHaveAttribute('data-workflow-dial', 'done');
	await shot(mainWindow, testInfo, '04-finished-unseen');

	// Looking at A keeps it; moving on hides it on the tab and the row.
	await tabA.click();
	await expect(tabA).toHaveClass(/terminal-tab-content--active/u);
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'done');
	await (await tabFor(mainWindow, b)).click();
	await expect(tabDial).toHaveCount(0, { timeout: READY_TIMEOUT_MS });
	await expect(rowDial).toHaveCount(0);
	await shot(mainWindow, testInfo, '05-seen-hidden');

	// Reopened after being seen: amber again, then a new green completion.
	await set(7, 'running');
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'running', { timeout: READY_TIMEOUT_MS });
	await set(7, 'done');
	await expect(tabDial).toHaveAttribute('data-workflow-dial', 'done', { timeout: READY_TIMEOUT_MS });

	// At phone width the compact switcher row shows it too.
	await resize(mainWindow, electronApp, PHONE);
	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	const switcher = mainWindow.getByRole('dialog', { name: 'Switch terminal' });
	await expect(switcher).toBeVisible();
	const switcherDial = switcher.locator(`[data-compact-switcher-terminal$=":${encodeURIComponent(panelIdA ?? '')}"] .workflow-dial`);
	await expect(switcherDial).toHaveAttribute('data-workflow-dial', 'done', { timeout: READY_TIMEOUT_MS });
	await shot(mainWindow, testInfo, '06-compact-switcher');
});
