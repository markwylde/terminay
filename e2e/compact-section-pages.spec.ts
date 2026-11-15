import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { frontHomeTab } from './support/home-tabs';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	createTerminal,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * Compact section pages (workspace-dashboard): on a phone each Home list
 * section is a page with a header row, status tabs with counts, dense rows,
 * and a View options sheet. The workspace is seeded the way an agent would
 * seed it, over the MCP control socket, so every page is populated.
 */

test.describe.configure({ timeout: 300_000 });

const READY = 20_000;
const PHONE = { width: 390, height: 780 } as const;

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
	result?: {
		workflow?: { steps: { id: string }[] };
		automation?: { id: string };
		id?: string;
	};
	error?: { code: string; message: string };
};

function mcpFrom(page: Page, userDataDir: string) {
	let sequence = 0;
	const script = path.join(userDataDir, 'compact-pages-e2e.mjs');
	return async (panel: Locator, op: string, params: Record<string, unknown>): Promise<Response> => {
		if (sequence === 0) await writeFile(script, MCP_SCRIPT);
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `compact-pages-${n}.json`);
		const outFile = path.join(userDataDir, `compact-pages-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`, panel);
		// An operation that asks first is allowed for this session.
		const allow = page.getByRole('button', { name: 'Allow This Session' });
		await expect
			.poll(
				async () => {
					if (existsSync(outFile)) return true;
					if (await allow.isVisible()) await allow.click();
					return false;
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		const response = JSON.parse(await readFile(outFile, 'utf8')) as Response;
		expect(response.ok, JSON.stringify(response)).toBe(true);
		return response;
	};
}

async function setSize(
	page: Page,
	electronApp: ElectronApplication,
	size: Readonly<{ width: number; height: number }>,
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		const bounds = window.getBounds();
		window.setBounds({ x: bounds.x, y: bounds.y, ...next });
	}, size);
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	await page.screenshot({ path: testInfo.outputPath('screenshots', `${name}.png`) });
}

const homeControl = (page: Page) => page.getByRole('button', { name: 'Home', exact: true });
const sectionItem = (page: Page, section: string) =>
	page.locator(`[data-terminay-home-section-tab="${section}"]`);
const compactPage = (page: Page, section: string) =>
	frontHomeTab(page).locator(`[data-compact-section="${section}"]`);
const tab = (page: Locator, id: string) => page.locator(`[data-compact-tab="${id}"]`);
const count = (page: Locator, id: string) => tab(page, id).locator('[data-compact-tab-count]');

/** Opens a Home section on a wide window, then narrows to a phone. */
async function openOnPhone(
	page: Page,
	electronApp: ElectronApplication,
	section: string,
): Promise<void> {
	await setSize(page, electronApp, { width: 1280, height: 820 });
	await expect(page.locator('[data-compact-chrome="true"]')).toHaveCount(0, { timeout: READY });
	await homeControl(page).click();
	await sectionItem(page, section).click();
	await setSize(page, electronApp, PHONE);
	await expect(page.locator('[data-compact-chrome="true"]')).toBeVisible({ timeout: READY });
}

test('compact section pages: seeded Tabs, Workflows, Automations, and Recordings on a phone', async ({
	mainWindow,
	electronApp,
	userDataDir,
}, testInfo) => {
	const mcp = mcpFrom(mainWindow, userDataDir);
	const first = await activeTerminalSessionId(mainWindow);
	const panel = terminalPanelForSession(mainWindow, first);
	await mcp(panel, 'rename_terminal', { terminal: first, name: 'api server' });

	// Workflows: one waiting on the user, one running, one finished.
	const ship = await mcp(panel, 'create_workflow', {
		name: 'Ship token refresh fix',
		opening_prompt: 'Refresh tokens expire a minute early on mobile. Find the clock skew, fix it, and ship it behind the existing flag.',
		steps: ['Reproduce', 'Find the skew', 'Fix', 'Write tests', 'Review', 'Changelog', 'Approve rollout', 'Deploy', 'Watch metrics'].map((title) => ({ title })),
	});
	const shipIds = (ship.result?.workflow?.steps ?? []).map((step) => step.id);
	for (const [index, note] of ['Seen on iOS 18 only', 'Server clock leads by 61s', 'Leeway now 90s', '4 new cases', 'Approved by Sam', 'Added under Fixed'].entries())
		await mcp(panel, 'update_workflow_step', { step_id: shipIds[index], status: 'done', note });
	await mcp(panel, 'update_workflow_step', {
		step_id: shipIds[6],
		status: 'needs_input',
		note: 'Roll out to 10% or 100%?',
	});
	const second = await createTerminal(mainWindow);
	const panel2 = terminalPanelForSession(mainWindow, second);
	await mcp(panel2, 'rename_terminal', { terminal: second, name: 'docs' });
	const docs = await mcp(panel2, 'create_workflow', {
		name: 'Rewrite onboarding docs',
		steps: [{ title: 'Outline' }, { title: 'Draft' }, { title: 'Screenshots' }, { title: 'Review' }],
	});
	const docIds = (docs.result?.workflow?.steps ?? []).map((step) => step.id);
	await mcp(panel2, 'update_workflow_step', { step_id: docIds[0], status: 'done' });
	await mcp(panel2, 'update_workflow_step', { step_id: docIds[1], status: 'running', note: 'Section 3 of 5' });

	// Automations: schedules, events, one off, one failing, one that ran and
	// kept its terminal; recorded, so Recordings has rows too.
	const make = (name: string, trigger: Record<string, unknown>, command: string, extra: Record<string, unknown> = {}) =>
		mcp(panel2, 'create_automation', {
			name,
			trigger,
			action: { kind: 'runCommand', command },
			settings: { recordSession: true, keepTerminalAfterRun: true },
			...extra,
		});
	const nightly = await make('Nightly backup', { kind: 'schedule', cron: '0 2 * * *' }, 'echo backed up');
	const lint = await make('Lint on finish', { kind: 'event', event: 'agent.finished' }, 'exit 3');
	await make('Ping when blocked', { kind: 'event', event: 'agent.blocked' }, 'echo blocked');
	const weeklyReport = await make('Weekly report', { kind: 'schedule', cron: '0 9 * * 1' }, 'echo report');
	const idOf = (response: Response) => response.result?.automation?.id ?? response.result?.id;
	await mcp(panel2, 'set_automation_enabled', { automation_id: idOf(weeklyReport), enabled: false });
	await mcp(panel2, 'run_automation', { automation_id: idOf(nightly) });
	await mcp(panel2, 'run_automation', { automation_id: idOf(lint) });

	// Tabs on a phone: no Home sidebar, no toggle; tabs with counts; rows by project.
	await openOnPhone(mainWindow, electronApp, 'tabs');
	const tabs = compactPage(mainWindow, 'tabs');
	await expect(tabs).toBeVisible({ timeout: READY });
	await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toHaveCount(0);
	await expect(mainWindow.locator('[data-compact-sidebar-toggle="true"]')).toHaveCount(0);
	// The shortcut and the command do nothing on a compact Home.
	await sendAppCommand(mainWindow, 'toggle-file-explorer-sidebar');
	await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toHaveCount(0);
	await expect(tab(tabs, 'all')).toHaveAttribute('aria-selected', 'true');
	await expect(tabs.locator('[data-compact-group]').first()).toBeVisible();
	await expect(tabs.locator('[data-terminay-dashboard-panel]').first()).toBeVisible();
	// Arrow keys move along the tabs.
	await tab(tabs, 'all').focus();
	await mainWindow.keyboard.press('ArrowRight');
	await expect(tab(tabs, 'attention')).toHaveAttribute('aria-selected', 'true');
	await expect(tab(tabs, 'attention')).toBeFocused();
	await mainWindow.keyboard.press('Home');
	await expect(tab(tabs, 'all')).toHaveAttribute('aria-selected', 'true');
	await shot(mainWindow, testInfo, '01-tabs');
	// The sheet offers List or Projects and Untracked tabs, never Board.
	await tabs.locator('[data-compact-view-options]').click();
	const sheet = mainWindow.locator('[data-compact-sheet="true"]');
	await expect(sheet.locator('[data-compact-sheet-option="Layout:list"]')).toBeVisible();
	await expect(sheet.locator('[data-compact-sheet-option="Layout:board"]')).toHaveCount(0);
	await sheet.locator('[data-compact-sheet-option="Layout:projects"]').click();
	await shot(mainWindow, testInfo, '02-tabs-sheet');
	await sheet.locator('[data-compact-sheet-done]').click();
	await shot(mainWindow, testInfo, '03-tabs-projects');
	// The wide window shows the Home sidebar as it was.
	await setSize(mainWindow, electronApp, { width: 1280, height: 820 });
	await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toBeVisible({ timeout: READY });

	// Workflows: Needs you is marked; the row shows progress and what it needs.
	await openOnPhone(mainWindow, electronApp, 'workflows');
	const workflows = compactPage(mainWindow, 'workflows');
	await expect(workflows).toBeVisible({ timeout: READY });
	await expect(count(workflows, 'alert')).toHaveText('1');
	await expect(count(workflows, 'alert')).toHaveAttribute('data-marked', 'true');
	await expect(count(workflows, 'running')).toHaveText('1');
	await shot(mainWindow, testInfo, '04-workflows');
	await workflows.locator('[data-compact-view-options]').click();
	await shot(mainWindow, testInfo, '05-workflows-sheet');
	await mainWindow.keyboard.press('Escape');
	await workflows.locator('[data-compact-search-open]').click();
	await workflows.locator('[data-compact-search-field]').fill('docs');
	await shot(mainWindow, testInfo, '06-workflows-search');
	await workflows.locator('[data-compact-search-cancel]').click();
	await workflows.locator('[data-workflows-home-column="api server"] .crow__main').click();
	const detail = frontHomeTab(mainWindow).locator('[data-workflows-home-detail]');
	await expect(detail.locator('.cdetail__step')).toHaveCount(9);
	await shot(mainWindow, testInfo, '07-workflow-detail');
	await detail.locator('[data-workflows-home-back]').click();

	// Automations: tabs by health and trigger; the switch works in place.
	await openOnPhone(mainWindow, electronApp, 'automations');
	const automations = compactPage(mainWindow, 'automations');
	await expect(automations).toBeVisible({ timeout: READY });
	await expect(count(automations, 'all')).toHaveText('4');
	await expect(count(automations, 'schedules')).toHaveText('2');
	await expect(count(automations, 'events')).toHaveText('2');
	await expect(count(automations, 'off')).toHaveText('1');
	await expect(count(automations, 'failing')).toHaveText('1', { timeout: READY });
	// One server: no View options.
	await expect(automations.locator('[data-compact-view-options]')).toHaveCount(0);
	await expect(automations.locator('[data-terminay-automation-terminals-link]')).toBeVisible({ timeout: READY });
	await shot(mainWindow, testInfo, '08-automations');
	const weekly = automations.locator('[data-terminay-automation-row]').filter({ hasText: 'Weekly report' });
	await weekly.getByRole('switch').click();
	await expect(weekly.getByRole('switch')).toBeChecked({ timeout: READY });
	await expect(count(automations, 'off')).toHaveText('0', { timeout: READY });
	await tab(automations, 'failing').click();
	await expect(automations.locator('[data-terminay-automation-row]')).toHaveCount(1);
	await shot(mainWindow, testInfo, '09-automations-failing');
	await tab(automations, 'all').click();
	await automations.locator('[data-terminay-automation-terminals-link]').click();
	await expect(frontHomeTab(mainWindow).locator('[data-compact-section="automation-terminals"]')).toBeVisible();
	await shot(mainWindow, testInfo, '10-automation-terminals');
	await frontHomeTab(mainWindow).locator('[data-compact-section="automation-terminals"] .cdetail__back').click();
	await expect(automations).toBeVisible();

	// Recordings: day groups, tabs, a more control that offers Delete.
	await openOnPhone(mainWindow, electronApp, 'recordings');
	const recordings = compactPage(mainWindow, 'recordings');
	await expect(recordings).toBeVisible({ timeout: READY });
	await expect(recordings.locator('[data-terminay-recording-row]').first()).toBeVisible({ timeout: READY });
	await expect(tab(recordings, 'today')).toBeVisible();
	await shot(mainWindow, testInfo, '11-recordings');
	await recordings.locator('[data-terminay-recording-more]').first().click();
	await expect(recordings.getByRole('button', { name: /^Delete / })).toBeVisible();
	await shot(mainWindow, testInfo, '12-recordings-more');
	await recordings.locator('[data-compact-view-options]').click();
	await expect(mainWindow.locator('[data-terminay-recordings-refresh]')).toBeVisible();
	await shot(mainWindow, testInfo, '13-recordings-sheet');
});
