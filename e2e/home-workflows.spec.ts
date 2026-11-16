import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMacroLauncher } from './support/app';
import { activeHome, closeFrontHomeTab, frontHomeTab } from './support/home-tabs';
import { createStartedProject } from './support/project-start';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	createTerminal,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * Home's Workflows section (workspace-dashboard): every workflow on a
 * terminal the dashboard lists, as columns, with filters, grouping, sort and
 * density, a needs-you count on the sidebar, and Show workflows in the
 * Command Bar. Terminals drive their workflows over MCP, as agents would.
 */

const READY_TIMEOUT_MS = 20_000;

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
	const script = path.join(userDataDir, 'home-workflows-e2e.mjs');
	return async (panel: Locator, op: string, params: Record<string, unknown>): Promise<Response> => {
		if (sequence === 0) await writeFile(script, MCP_SCRIPT);
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `home-workflows-${n}.json`);
		const outFile = path.join(userDataDir, `home-workflows-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`, panel);
		await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
		const response = JSON.parse(await readFile(outFile, 'utf8')) as Response;
		expect(response.ok, JSON.stringify(response)).toBe(true);
		return response;
	};
}

/**
 * A long-running MCP client in one terminal: it takes jobs from files, so a
 * test can change workflows while that terminal is not on screen.
 */
const AGENT_SCRIPT = `
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
const dir = process.argv[2];
const call = (op, params) => new Promise((resolve) => {
	const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
	let buffer = '';
	socket.on('connect', () => socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n'));
	socket.on('data', (chunk) => {
		buffer += chunk;
		const end = buffer.indexOf('\\n');
		if (end < 0) return;
		socket.end();
		resolve(buffer.slice(0, end));
	});
	socket.on('error', (error) => resolve(JSON.stringify({ ok: false, error: { code: 'socket', message: error.message } })));
});
let busy = false;
setInterval(async () => {
	if (busy) return;
	busy = true;
	for (const name of readdirSync(dir).filter((file) => file.endsWith('.job')).sort()) {
		const job = path.join(dir, name);
		const { op, params } = JSON.parse(readFileSync(job, 'utf8'));
		renameSync(job, job + '.taken');
		writeFileSync(job.replace(/\\.job$/, '.out'), await call(op, params));
	}
	busy = false;
}, 100);
`;

async function agentIn(page: Page, userDataDir: string, panel: Locator) {
	const dir = path.join(userDataDir, 'home-workflows-agent');
	await mkdir(dir, { recursive: true });
	const script = path.join(userDataDir, 'home-workflows-agent.mjs');
	await writeFile(script, AGENT_SCRIPT);
	await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' '${dir}'`, panel);
	let sequence = 0;
	return async (op: string, params: Record<string, unknown>): Promise<Response> => {
		const n = String(++sequence).padStart(4, '0');
		const out = path.join(dir, `${n}.out`);
		await writeFile(path.join(dir, `${n}.tmp`), JSON.stringify({ op, params }));
		await rename(path.join(dir, `${n}.tmp`), path.join(dir, `${n}.job`));
		await expect.poll(() => existsSync(out), { timeout: 30_000 }).toBe(true);
		const response = JSON.parse(await readFile(out, 'utf8')) as Response;
		expect(response.ok, JSON.stringify(response)).toBe(true);
		return response;
	};
}

const homeControl = (page: Page) => page.getByRole('button', { name: 'Home', exact: true });
const workflowsItem = (page: Page) => page.locator('[data-terminay-home-section-tab="workflows"]');
const section = (page: Page) => frontHomeTab(page).locator('[data-terminay-home-workflows]');
const columns = (page: Page) => section(page).locator('[data-workflows-home-column]');
const column = (page: Page, terminal: string) =>
	section(page).locator(`[data-workflows-home-column="${terminal}"]`);

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	await page.screenshot({ path: testInfo.outputPath('screenshots', `${name}.png`) });
}

const OPENSPEC = ['Propose', 'Review', 'Amend', 'Implement', 'Verify', 'Open PR', 'CI green'];

test('Home shows every workflow as columns, filters, groups and remembers its view, and counts what needs you', async ({
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(300_000);
	const mcp = mcpFrom(mainWindow, userDataDir);

	// Project 1: terminal A runs an OpenSpec workflow, terminal B a release.
	const a = await activeTerminalSessionId(mainWindow);
	const openspec = await mcp(terminalPanelForSession(mainWindow, a), 'create_workflow', {
		name: 'OpenSpec: Propose → Ship',
		opening_prompt: 'Ship the Workflows section',
		steps: OPENSPEC.map((title) => ({ title })),
	});
	const idsA = (openspec.result?.workflow?.steps ?? []).map((step) => step.id);
	const b = await createTerminal(mainWindow);
	const panelB = terminalPanelForSession(mainWindow, b);
	const release = await mcp(panelB, 'create_workflow', {
		name: 'Release beta',
		steps: [{ title: 'Bump version' }, { title: 'Notarize' }, { title: 'Publish' }],
	});
	const idsB = (release.result?.workflow?.steps ?? []).map((step) => step.id);
	// B keeps answering while Home or another tab is in front, as an agent would.
	const agent = await agentIn(mainWindow, userDataDir, panelB);
	const setA = (index: number, status: string, note?: string) =>
		agent('update_workflow_step', { terminal: a, step_id: idsA[index], status, ...(note === undefined ? {} : { note }) });
	const setB = (index: number, status: string, note?: string) =>
		agent('update_workflow_step', { terminal: b, step_id: idsB[index], status, ...(note === undefined ? {} : { note }) });
	for (const index of [0, 1, 2]) await setA(index, 'done', `Step ${index + 1} done`);
	await setA(3, 'running', 'Editing the section');
	await agent('rename_terminal', { terminal: a, name: 'claude · home' });
	// A, in front again, names B.
	await mainWindow.locator(`.project-workspace--active [data-folder-terminal-session="${a}"]`).click();
	await expect.poll(() => activeTerminalSessionId(mainWindow)).toBe(a);
	await mcp(terminalPanelForSession(mainWindow, a), 'rename_terminal', { terminal: b, name: 'release' });

	// Project 2: terminal C has a finished OpenSpec workflow.
	await createStartedProject(mainWindow);
	let c = '';
	await expect
		.poll(async () => {
			c = await activeTerminalSessionId(mainWindow);
			return c !== a && c !== b;
		}, { timeout: READY_TIMEOUT_MS })
		.toBe(true);
	const panelC = terminalPanelForSession(mainWindow, c);
	const finished = await mcp(panelC, 'create_workflow', {
		name: 'OpenSpec: Propose → Ship',
		steps: OPENSPEC.map((title) => ({ title })),
	});
	for (const step of finished.result?.workflow?.steps ?? [])
		await mcp(panelC, 'update_workflow_step', { step_id: step.id, status: 'done' });

	// Show workflows from a project opens the section in Home.
	await openMacroLauncher(mainWindow);
	const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' });
	await mainWindow.getByRole('searchbox', { name: 'Search commands' }).fill('show workflows');
	await commandBar.getByText('Show workflows', { exact: true }).click();
	await expect(activeHome(mainWindow)).toHaveAttribute('data-terminay-home-view', 'workflows');
	await expect(workflowsItem(mainWindow)).toHaveAttribute('aria-selected', 'true');

	// Three columns across two projects, each naming its terminal.
	await expect(columns(mainWindow)).toHaveCount(3, { timeout: READY_TIMEOUT_MS });
	await expect(section(mainWindow).locator('[data-workflows-home-count]')).toHaveText('3 of 3 workflows · 2 projects');
	const columnA = column(mainWindow, 'claude · home');
	await expect(columnA).toContainText('3 of 7 done');
	await expect(columnA).toContainText('Editing the section');
	await expect(columnA.locator('.workflow-step--active')).toHaveCount(1);
	await shot(mainWindow, testInfo, '01-columns');

	// A step that needs the user: the column is marked, and the sidebar counts it.
	await setB(0, 'done');
	await setB(1, 'needs_input', 'Notarize with which identity?');
	const columnB = column(mainWindow, 'release');
	await expect(columnB).toHaveAttribute('data-tone', 'alert', { timeout: READY_TIMEOUT_MS });
	await expect(columnB).toContainText('Notarize with which identity?');
	const badge = mainWindow.locator('[data-terminay-home-section-badge="workflows"]');
	await expect(badge).toHaveText('1');
	await expect(workflowsItem(mainWindow)).toHaveAttribute('aria-label', 'Workflows, 1 workflow needs you');
	// Needs you first: the waiting workflow leads.
	await expect(columns(mainWindow).first()).toHaveAttribute('data-workflows-home-column', 'release');
	await shot(mainWindow, testInfo, '02-needs-you');

	// Live: a step update shows without leaving the section.
	await setA(3, 'done', 'Implemented');
	await expect(columnA).toContainText('4 of 7 done', { timeout: READY_TIMEOUT_MS });

	// Text filter.
	const filter = section(mainWindow).getByRole('searchbox', { name: 'Filter workflows' });
	await filter.fill('release');
	await expect(columns(mainWindow)).toHaveCount(1);
	await expect(section(mainWindow).locator('[data-workflows-home-count]')).toHaveText('1 of 3 workflows · 1 project');
	await filter.fill('');

	// Status filters combine; none selected means all.
	const status = (name: string) => section(mainWindow).locator(`[data-workflows-home-status="${name}"]`);
	await status('done').click();
	await expect(status('done')).toHaveAttribute('aria-pressed', 'true');
	await expect(columns(mainWindow)).toHaveCount(1);
	await status('alert').click();
	await expect(columns(mainWindow)).toHaveCount(2);
	await status('done').click();
	await status('alert').click();
	await expect(columns(mainWindow)).toHaveCount(3);

	// Project filter: leave the second project out.
	await section(mainWindow).locator('[data-workflows-home-projects]').click();
	const projectBoxes = section(mainWindow).locator('[data-workflows-home-project]');
	await expect(projectBoxes).toHaveCount(2);
	await projectBoxes.nth(1).uncheck();
	await expect(columns(mainWindow)).toHaveCount(2);
	await mainWindow.keyboard.press('Escape');
	await expect(projectBoxes).toHaveCount(0);

	// Group by project, as rows; fold the first by keyboard.
	await section(mainWindow).locator('[data-workflows-home-projects]').click();
	await section(mainWindow).getByRole('button', { name: 'Include all' }).click();
	await mainWindow.keyboard.press('Escape');
	await expect(columns(mainWindow)).toHaveCount(3);
	await section(mainWindow).locator('[data-workflows-home-option="group:project"]').click();
	await section(mainWindow).locator('[data-workflows-home-option="layout:rows"]').click();
	const groups = section(mainWindow).locator('[data-workflows-home-group]');
	await expect(groups).toHaveCount(2);
	await expect(section(mainWindow).locator('.workflows-home__row-scroller')).toHaveCount(2);
	await expect(columnA.locator('.workflows-home__project')).toHaveCount(0);
	await shot(mainWindow, testInfo, '03-project-rows');
	const fold = groups.first().locator('[data-workflows-home-fold]');
	await fold.focus();
	await mainWindow.keyboard.press('Enter');
	await expect(fold).toHaveAttribute('aria-expanded', 'false');
	await expect(groups.first().locator('[data-workflows-home-column]')).toHaveCount(0);
	await expect(groups.first().locator('.workflow-dial')).toHaveCount(2);
	await shot(mainWindow, testInfo, '04-folded');

	// The view survives closing the tab and reloading the client.
	await closeFrontHomeTab(mainWindow);
	await workflowsItem(mainWindow).click();
	await expect(section(mainWindow).locator('[data-workflows-home-layout="rows"]')).toBeVisible();
	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	await homeControl(mainWindow).click().catch(() => undefined);
	await workflowsItem(mainWindow).click();
	await expect(section(mainWindow).locator('[data-workflows-home-layout="rows"]')).toBeVisible({ timeout: READY_TIMEOUT_MS });
	await expect(section(mainWindow).locator('[data-workflows-home-fold][aria-expanded="false"]')).toHaveCount(1);

	// Group by workflow, side by side, notes for the current step only.
	await section(mainWindow).locator('[data-workflows-home-option="group:workflow"]').click();
	await section(mainWindow).locator('[data-workflows-home-option="layout:side"]').click();
	await section(mainWindow).locator('[data-workflows-home-option="notes:current"]').click();
	await expect(section(mainWindow).locator('[data-workflows-home-group="OpenSpec: Propose → Ship"] [data-workflows-home-column]')).toHaveCount(2);
	await expect(column(mainWindow, 'claude · home')).not.toContainText('Step 1 done');
	await expect(column(mainWindow, 'release')).toContainText('Notarize with which identity?');
	await shot(mainWindow, testInfo, '05-by-workflow');

	// Reset view returns every option to its default.
	await section(mainWindow).getByRole('button', { name: 'Reset view' }).click();
	await expect(section(mainWindow).locator('[data-workflows-home-layout="flat"]')).toBeVisible();
	await expect(columns(mainWindow)).toHaveCount(3);

	// The sidebar count holds with the tab closed, and drops when answered.
	await closeFrontHomeTab(mainWindow);
	await expect(badge).toHaveText('1');
	await setB(1, 'running');
	await expect(badge).toHaveCount(0, { timeout: READY_TIMEOUT_MS });

	// Show workflows from Home.
	await mainWindow.keyboard.press('ControlOrMeta+l');
	await expect(commandBar).toBeVisible();
	await mainWindow.getByRole('searchbox', { name: 'Search commands' }).fill('show workflows');
	await commandBar.getByText('Show workflows', { exact: true }).click();
	await expect(activeHome(mainWindow)).toHaveAttribute('data-terminay-home-view', 'workflows');

	// With the Workflows tab behind another, Show workflows brings it forward.
	await mainWindow.locator('[data-terminay-home-section-tab="tabs"]').click();
	await expect(activeHome(mainWindow)).toHaveAttribute('data-terminay-home-view', 'tabs');
	await mainWindow.keyboard.press('ControlOrMeta+l');
	await mainWindow.getByRole('searchbox', { name: 'Search commands' }).fill('show workflows');
	await commandBar.getByText('Show workflows', { exact: true }).click();
	await expect(activeHome(mainWindow)).toHaveAttribute('data-terminay-home-view', 'workflows');
	await expect(mainWindow.locator('[data-terminay-home-workflows]')).toHaveCount(1);

	// A renamed terminal shows its new title.
	await agent('rename_terminal', { terminal: a, name: 'claude · home 2' });
	await expect(column(mainWindow, 'claude · home 2')).toHaveCount(1, { timeout: READY_TIMEOUT_MS });

	// The open control leaves Home and focuses the terminal.
	await section(mainWindow).locator('[data-workflows-home-open="claude · home 2"]').click();
	await expect(activeHome(mainWindow)).toHaveCount(0);
	await expect(terminalPanelForSession(mainWindow, a)).toBeVisible();
	await expect.poll(() => activeTerminalSessionId(mainWindow)).toBe(a);

	// A terminal that is closed loses its column.
	await agent('close_terminal', { terminal: a });
	await homeControl(mainWindow).click();
	await workflowsItem(mainWindow).click();
	await expect(column(mainWindow, 'claude · home 2')).toHaveCount(0, { timeout: READY_TIMEOUT_MS });
	await expect(columns(mainWindow)).toHaveCount(2);

	// A workflow removed from its terminal loses its column.
	await section(mainWindow).locator('[data-workflows-home-open="release"]').click();
	const panelOfB = terminalPanelForSession(mainWindow, b).locator('.workflow-panel');
	await expect(panelOfB).toBeVisible({ timeout: READY_TIMEOUT_MS });
	const expand = panelOfB.getByRole('button', { name: 'Expand workflow' });
	if (await expand.isVisible()) await expand.click();
	// Removal is in the workflow options menu, behind a confirmation.
	await panelOfB.getByRole('button', { name: 'Workflow options' }).click();
	await panelOfB.getByRole('menuitem', { name: 'Remove workflow…' }).click();
	await panelOfB.getByRole('menuitem', { name: 'Remove', exact: true }).click();
	await homeControl(mainWindow).click();
	await workflowsItem(mainWindow).click();
	await expect(column(mainWindow, 'release')).toHaveCount(0, { timeout: READY_TIMEOUT_MS });
	await expect(columns(mainWindow)).toHaveCount(1);
});

const PHONE = { width: 390, height: 740 } as const;

async function setWindowSize(
	page: Page,
	electronApp: import('@playwright/test').ElectronApplication,
	size: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => window.setBounds(next), size);
}

async function showWorkflows(page: Page): Promise<void> {
	await openMacroLauncher(page);
	await page.getByRole('searchbox', { name: 'Search commands' }).fill('show workflows');
	await page.getByRole('dialog', { name: 'Command bar' }).getByText('Show workflows', { exact: true }).click();
	await expect(section(page)).toBeVisible({ timeout: READY_TIMEOUT_MS });
}

test('On a phone, Workflows is a compact section page with tabs, a View options sheet, and a detail page, and keeps the stored view', async ({
	mainWindow,
	electronApp,
	userDataDir,
}, testInfo) => {
	test.setTimeout(300_000);
	const mcp = mcpFrom(mainWindow, userDataDir);
	const nativeWindow = await electronApp.browserWindow(mainWindow);
	const desktop = await nativeWindow.evaluate((window) => window.getBounds());

	// A long workflow and a short one, in two terminals of one project.
	const a = await activeTerminalSessionId(mainWindow);
	const steps = Array.from({ length: 14 }, (_, index) => ({ title: `Step ${index + 1}` }));
	const long = await mcp(terminalPanelForSession(mainWindow, a), 'create_workflow', {
		name: 'Long workflow',
		steps,
	});
	const longIds = (long.result?.workflow?.steps ?? []).map((step) => step.id);
	for (const id of longIds.slice(0, 3))
		await mcp(terminalPanelForSession(mainWindow, a), 'update_workflow_step', {
			step_id: id,
			status: 'done',
			note: 'A note long enough to wrap onto a second line on a phone-width column',
		});
	await mcp(terminalPanelForSession(mainWindow, a), 'rename_terminal', { terminal: a, name: 'long' });
	const b = await createTerminal(mainWindow);
	const panelB = terminalPanelForSession(mainWindow, b);
	await mcp(panelB, 'create_workflow', { name: 'Short workflow', steps: [{ title: 'One' }, { title: 'Two' }] });
	await mcp(panelB, 'rename_terminal', { terminal: b, name: 'short' });
	// Changes made while Home is in front go through a long-running agent.
	const agent = await agentIn(mainWindow, userDataDir, panelB);

	// Wide: every option is shown directly; there is no View options control.
	await showWorkflows(mainWindow);
	await expect(columns(mainWindow)).toHaveCount(2, { timeout: READY_TIMEOUT_MS });
	await expect(section(mainWindow)).toHaveAttribute('data-workflows-home-compact', 'false');
	await expect(section(mainWindow).locator('[data-workflows-home-options-toggle]')).toHaveCount(0);
	// Remember a non-default view: by project, as rows, with narrow columns.
	await section(mainWindow).locator('[data-workflows-home-option="group:project"]').click();
	await section(mainWindow).locator('[data-workflows-home-option="layout:rows"]').click();
	await section(mainWindow).getByLabel('Narrow columns').check();
	await shot(mainWindow, testInfo, '10-desktop');

	// A Home tab exactly 600px wide is narrow; 601px is not.
	const sectionWidth = (width: number | undefined) =>
		section(mainWindow).evaluate((element, next) => {
			const style = (element as HTMLElement).style;
			if (next === undefined) {
				style.removeProperty('right');
				style.removeProperty('width');
			} else {
				style.right = 'auto';
				style.width = `${next}px`;
			}
		}, width);
	await sectionWidth(600);
	await expect(section(mainWindow)).toHaveAttribute('data-workflows-home-compact', 'true');
	// A narrow Home tab in a wide window keeps its toolbar on the page, behind View options.
	const toggle = section(mainWindow).locator('[data-workflows-home-options-toggle]');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(toggle).toHaveAccessibleName('View options, changed');
	await expect(section(mainWindow).getByRole('searchbox', { name: 'Filter workflows' })).toBeVisible();
	await sectionWidth(601);
	await expect(section(mainWindow)).toHaveAttribute('data-workflows-home-compact', 'false');
	await sectionWidth(undefined);

	// Phone width: a compact section page — header, status tabs, rows.
	await setWindowSize(mainWindow, electronApp, { x: desktop.x, y: desktop.y, ...PHONE });
	const phone = section(mainWindow).locator('[data-compact-section="workflows"]');
	await expect(phone).toBeVisible({ timeout: READY_TIMEOUT_MS });
	await expect(toggle).toHaveCount(0);
	await expect(phone.getByRole('searchbox')).toHaveCount(0);
	await expect(phone.getByRole('tablist', { name: 'Workflows status' })).toBeVisible();
	const tab = (id: string) => phone.locator(`[data-compact-tab="${id}"]`);
	const count = (id: string) => tab(id).locator('[data-compact-tab-count]');
	const rows = phone.locator('[data-workflows-home-row]');
	await expect(rows).toHaveCount(2);
	await expect(count('all')).toHaveText('2');
	await expect(count('alert')).toHaveText('0');
	// The stored grouping (Project) groups the rows under a sticky header.
	await expect(phone.locator('[data-compact-group]')).toHaveCount(1);
	// Grouping is not a filter: no marker, no token row.
	const viewOptions = phone.locator('[data-compact-view-options]');
	await expect(viewOptions).toHaveAttribute('data-applied', 'false');
	await expect(viewOptions).toHaveAccessibleName('View options');
	await expect(phone.locator('[data-compact-applied]')).toHaveCount(0);
	expect(await phone.evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(true);

	// A step that needs the user: Needs you counts it, marked, and the row says what.
	await agent('update_workflow_step', {
		terminal: a,
		step_id: longIds[3],
		status: 'needs_input',
		note: 'Pick a database',
	});
	await expect(count('alert')).toHaveText('1', { timeout: READY_TIMEOUT_MS });
	await expect(count('alert')).toHaveAttribute('data-marked', 'true');
	const longRow = phone.locator('[data-workflows-home-column="long"]');
	await expect(longRow.locator('.crow__detail--attention')).toContainText('Pick a database');
	await expect(longRow.locator('.crow__trailing')).toHaveText('3/14');
	await shot(mainWindow, testInfo, '11-phone-list');
	await tab('alert').click();
	await expect(tab('alert')).toHaveAttribute('aria-selected', 'true');
	await expect(rows).toHaveCount(1);
	await tab('all').click();

	// The sheet: Sort, Group, Finished; no Notes, Layout, or Narrow columns.
	await viewOptions.click();
	const sheet = mainWindow.locator('[data-compact-sheet="true"]');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('combobox', { name: 'Sort' })).toBeVisible();
	await expect(sheet.locator('[data-compact-sheet-option="Group:project"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(sheet.getByRole('switch', { name: 'Finished workflows' })).toBeChecked();
	await expect(sheet.getByText('Notes', { exact: true })).toHaveCount(0);
	await expect(sheet.getByText('Narrow columns')).toHaveCount(0);
	await expect(sheet.locator('[data-compact-sheet-option^="Layout:"]')).toHaveCount(0);
	await shot(mainWindow, testInfo, '12-phone-sheet');
	const heights = await sheet.evaluate((root) =>
		[...root.querySelectorAll<HTMLElement>('button, select, input[role="switch"]')]
			.filter((element) => element.getClientRects().length > 0)
			.map((element) => ({ what: element.outerHTML.slice(0, 80), height: element.getBoundingClientRect().height })),
	);
	for (const { what, height } of heights) expect(height, what).toBeGreaterThanOrEqual(26);
	// Escape closes only the sheet, and focus goes back to View options.
	await mainWindow.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await expect(viewOptions).toBeFocused();
	// Hiding finished workflows is a filter: marker, token, and its own reset.
	await viewOptions.click();
	await sheet.getByRole('switch', { name: 'Finished workflows' }).uncheck();
	await sheet.locator('[data-compact-sheet-done]').click();
	await expect(viewOptions).toHaveAttribute('data-applied', 'true');
	await expect(viewOptions).toHaveAccessibleName('View options, filters applied');
	await phone.locator('[data-compact-applied-token="finished"]').click();
	await expect(viewOptions).toHaveAttribute('data-applied', 'false');
	// Reduced motion: the sheet appears without an entrance animation.
	await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
	await viewOptions.click();
	expect(await sheet.evaluate((element) => element.getAnimations().length)).toBe(0);
	// One compact drawer at a time: the Command Bar closes the sheet.
	await openMacroLauncher(mainWindow);
	await expect(sheet).toHaveCount(0);
	await mainWindow.keyboard.press('Escape');
	await expect(mainWindow.getByRole('dialog', { name: 'Command bar' })).toHaveCount(0);
	// ...and so does the switcher.
	await viewOptions.click();
	await expect(sheet).toBeVisible();
	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	await expect(sheet).toHaveCount(0);
	await mainWindow.keyboard.press('Escape');
	await mainWindow.emulateMedia({ reducedMotion: 'no-preference' });

	// Search replaces the header; counts follow it; Cancel restores it.
	await phone.locator('[data-compact-search-open]').click();
	const field = phone.locator('[data-compact-search-field]');
	await expect(field).toBeFocused();
	expect(await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
	await field.fill('short');
	await expect(count('all')).toHaveText('1');
	await expect(count('alert')).toHaveText('0');
	await field.fill('zzz');
	await expect(phone.locator('[data-compact-empty]')).toContainText('No workflow matches “zzz”');
	await phone.getByRole('button', { name: 'Clear search' }).click();
	await expect(rows).toHaveCount(2);
	// Clearing keeps the field open, for another try.
	await expect(field).toHaveValue('');
	await field.fill('long');
	await phone.locator('[data-compact-search-cancel]').click();
	await expect(field).toHaveCount(0);
	await expect(phone.locator('[data-compact-search-open]')).toBeFocused();
	await expect(rows).toHaveCount(2);

	// A row opens its detail page: brief, every step, the one that needs you.
	await longRow.locator('.crow__main').click();
	const detail = section(mainWindow).locator('[data-workflows-home-detail]');
	await expect(detail).toBeVisible();
	await expect(detail.locator('.cdetail__step')).toHaveCount(14);
	const waiting = detail.locator('.cdetail__step[data-status="needs_input"]');
	await expect(waiting).toHaveClass(/cdetail__step--attention/);
	await expect(waiting).toContainText('Pick a database');
	await expect(waiting.getByRole('button', { name: 'Open terminal' })).toBeVisible();
	await expect(detail.getByText('3 of 14 done', { exact: false })).toBeVisible();
	await shot(mainWindow, testInfo, '13-phone-detail');
	// It updates live.
	await agent('update_workflow_step', { terminal: a, step_id: longIds[3], status: 'done' });
	await expect(detail.locator('.cdetail__step[data-status="needs_input"]')).toHaveCount(0, { timeout: READY_TIMEOUT_MS });
	// Escape goes back, to the same row.
	await mainWindow.keyboard.press('Escape');
	await expect(detail).toHaveCount(0);
	await expect(longRow.locator('.crow__main')).toBeFocused();

	// Reload while compact: the stored view is still Project / Rows / Narrow columns.
	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	await showWorkflows(mainWindow);
	await expect(phone).toBeVisible({ timeout: READY_TIMEOUT_MS });
	await expect(phone.locator('[data-compact-group]')).toHaveCount(1);

	// Two tones chosen on a wide window are one token on a phone, and survive.
	await setWindowSize(mainWindow, electronApp, desktop);
	await expect(section(mainWindow)).toHaveAttribute('data-workflows-home-compact', 'false', {
		timeout: READY_TIMEOUT_MS,
	});
	await section(mainWindow).locator('[data-workflows-home-status="alert"]').click();
	await section(mainWindow).locator('[data-workflows-home-status="running"]').click();
	await setWindowSize(mainWindow, electronApp, { x: desktop.x, y: desktop.y, ...PHONE });
	await expect(phone).toBeVisible({ timeout: READY_TIMEOUT_MS });
	await expect(tab('all')).toHaveAttribute('aria-selected', 'true');
	await expect(phone.locator('[data-compact-applied-token="statuses"]')).toHaveText('Needs you, Running');
	await expect(rows).toHaveCount(0);
	// A search typed on the phone is the wide filter's text.
	await phone.locator('[data-compact-search-open]').click();
	await field.fill('short');
	await setWindowSize(mainWindow, electronApp, desktop);
	await expect(section(mainWindow)).toHaveAttribute('data-workflows-home-compact', 'false', {
		timeout: READY_TIMEOUT_MS,
	});
	await expect(section(mainWindow).getByRole('searchbox', { name: 'Filter workflows' })).toHaveValue('short');
	await expect(section(mainWindow).locator('[data-workflows-home-status="alert"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(section(mainWindow).locator('[data-workflows-home-status="running"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(section(mainWindow).locator('[data-workflows-home-option="group:project"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(section(mainWindow).locator('[data-workflows-home-option="layout:rows"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(section(mainWindow).getByLabel('Narrow columns')).toBeChecked();
});
