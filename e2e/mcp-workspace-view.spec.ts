import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * The MCP workspace view end to end (mcp-workspace-view, ADR-0070). A script
 * in a real terminal makes MCP requests on that terminal's own control socket
 * and capability, framed exactly as the stdio adapter frames them, and saves
 * each whole response. Every result is checked against what this window
 * actually shows: an agent must be told the truth about the layout.
 */

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

type Tab = { tab: string; terminal?: string; kind: string; title: string; active: boolean };
type Node = { size?: number; split?: 'row' | 'column'; children?: Node[]; pane?: string; tabs?: Tab[] };
type Layout = {
	visible: boolean;
	folder?: string;
	folders: { folder: string; name: string; kind: string; selected: boolean }[];
	root?: Node;
	focused_tab?: string;
};
type Response = { ok: boolean; result?: Record<string, unknown>; error?: { code: string; message: string } };

/** An MCP caller bound to one terminal's capability. */
function mcpFrom(page: Page, userDataDir: string) {
	let sequence = 0;
	const script = path.join(userDataDir, 'mcp-view-e2e.mjs');
	let written = false;
	return async (
		panel: Locator,
		op: string,
		params: Record<string, unknown> = {},
	): Promise<Response> => {
		if (!written) {
			await writeFile(script, MCP_SCRIPT);
			written = true;
		}
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `mcp-view-${n}.json`);
		const outFile = path.join(userDataDir, `mcp-view-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(
			page,
			`'${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`,
			panel,
		);
		await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
		return JSON.parse(await readFile(outFile, 'utf8')) as Response;
	};
}

const groups = (page: Page) => page.locator('.project-workspace--active .dv-groupview');
const terminalTabs = (page: Page) =>
	page.locator('.project-workspace--active .terminal-tab-content');

async function centre(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await locator.boundingBox();
	if (box === null) throw new Error('element has no box');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
}

/** The terminals of a layout's panes, column by column, top to bottom. */
function columnsOf(root: Node | undefined): (string | undefined)[][] {
	if (root === undefined) return [];
	const column = (node: Node): (string | undefined)[] =>
		node.split === 'column'
			? (node.children ?? []).map((child) => child.tabs?.[0]?.terminal)
			: [node.tabs?.[0]?.terminal];
	return root.split === 'row' ? (root.children ?? []).map(column) : [column(root)];
}

function allTabs(root: Node | undefined): Tab[] {
	if (root === undefined) return [];
	if (root.tabs !== undefined) return root.tabs;
	return (root.children ?? []).flatMap(allTabs);
}

/** The layout a view tool's result carries. */
function layoutIn(response: Response): Layout {
	const layout = response.result?.layout;
	if (layout === undefined) throw new Error(`no layout in ${JSON.stringify(response)}`);
	return layout as Layout;
}

function focusedTerminal(layout: Layout): string | undefined {
	return allTabs(layout.root).find((tab) => tab.tab === layout.focused_tab)?.terminal;
}

test('an agent builds a 2x2 grid with split_terminal, each call opening one terminal, and reads the real layout back', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(150_000);
	const mcp = mcpFrom(mainWindow, userDataDir);
	const caller = await activeTerminalSessionId(mainWindow);
	const from = terminalPanelForSession(mainWindow, caller);

	const before = await mcp(from, 'get_layout');
	expect(before.ok).toBe(true);
	const first = before.result as unknown as Layout;
	expect(first.visible).toBe(true);
	expect(allTabs(first.root).map((tab) => tab.terminal)).toEqual([caller]);
	expect(focusedTerminal(first)).toBe(caller);

	const right = await mcp(from, 'split_terminal', { terminal: caller, direction: 'right' });
	expect(right.ok).toBe(true);
	expect(right.result?.placed).toBe(true);
	expect(right.result?.opened).toBe(1);
	const topRight = right.result?.terminal as string;
	expect(topRight).not.toBe(caller);
	await expect(groups(mainWindow)).toHaveCount(2);

	const belowLeft = await mcp(from, 'split_terminal', { terminal: caller, direction: 'below' });
	const belowRight = await mcp(from, 'split_terminal', { terminal: topRight, direction: 'below' });
	for (const result of [belowLeft, belowRight]) {
		expect(result.ok).toBe(true);
		expect(result.result?.placed).toBe(true);
	}
	const bottomLeft = belowLeft.result?.terminal as string;
	const bottomRight = belowRight.result?.terminal as string;

	// Three calls, three terminals: four in all, each in its own pane.
	await expect(terminalTabs(mainWindow)).toHaveCount(4);
	await expect(groups(mainWindow)).toHaveCount(4);
	const [tl, tr, bl, br] = await Promise.all(
		[caller, topRight, bottomLeft, bottomRight].map((id) =>
			centre(terminalPanelForSession(mainWindow, id)),
		),
	);
	expect(tl.x).toBeLessThan(tr.x);
	expect(bl.x).toBeLessThan(br.x);
	expect(tl.y).toBeLessThan(bl.y);
	expect(tr.y).toBeLessThan(br.y);

	// What the agent is told is what is on screen.
	const layout = layoutIn(belowRight);
	expect(layout.root?.split).toBe('row');
	expect(columnsOf(layout.root)).toEqual([
		[caller, bottomLeft],
		[topRight, bottomRight],
	]);
	// Splitting never took the user's focus.
	expect(focusedTerminal(layout)).toBe(caller);
	const after = await mcp(from, 'get_layout');
	expect(columnsOf((after.result as unknown as Layout).root)).toEqual(columnsOf(layout.root));
});

test('arrange, move, resize, open, and focus change this window and report exactly what it shows', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(180_000);
	const mcp = mcpFrom(mainWindow, userDataDir);
	const caller = await activeTerminalSessionId(mainWindow);
	const from = terminalPanelForSession(mainWindow, caller);

	// Opening without focus leaves the user where they were.
	const opened: string[] = [];
	for (const name of ['Two', 'Three', 'Four']) {
		const result = await mcp(from, 'open_terminal', { name });
		expect(result.ok).toBe(true);
		expect(result.result?.placed).toBeUndefined();
		opened.push(result.result?.terminal as string);
	}
	await expect(terminalTabs(mainWindow)).toHaveCount(4);
	await expect(from).toBeVisible();
	const [two, three, four] = opened as [string, string, string];

	// A grid: four tabs, two columns of two, in the order they were listed.
	const grid = await mcp(from, 'arrange_tabs', { arrangement: 'grid', tabs: [caller, two, three, four] });
	expect(grid.ok).toBe(true);
	await expect(groups(mainWindow)).toHaveCount(4);
	expect(columnsOf(layoutIn(grid).root)).toEqual([
		[caller, three],
		[two, four],
	]);
	const [a, b, c, d] = await Promise.all(
		[caller, two, three, four].map((id) => centre(terminalPanelForSession(mainWindow, id))),
	);
	expect(Math.abs(a.y - b.y)).toBeLessThan(4);
	expect(Math.abs(c.y - d.y)).toBeLessThan(4);
	expect(Math.abs(a.x - c.x)).toBeLessThan(4);
	expect(a.y).toBeLessThan(c.y);
	expect(a.x).toBeLessThan(b.x);
	// Equal panes.
	expect(Math.abs(a.width - b.width)).toBeLessThan(a.width * 0.1);

	// Resizing a pane to a fraction of the workspace.
	const workspace = await centre(mainWindow.locator('.project-workspace--active .workspace'));
	const resized = await mcp(from, 'resize_pane', { tab: caller, width: 0.3 });
	expect(resized.ok).toBe(true);
	await expect
		.poll(async () => (await centre(terminalPanelForSession(mainWindow, caller))).width / workspace.width)
		.toBeLessThan(0.36);
	const sizes = layoutIn(resized).root?.children?.map((child) => child.size ?? 0) ?? [];
	expect(sizes[0]).toBeLessThan(0.36);

	// Moving a tab into another pane, and beside one.
	const moved = await mcp(from, 'move_tab', { tab: four, beside: caller, position: 'center' });
	expect(moved.ok).toBe(true);
	await expect(groups(mainWindow)).toHaveCount(3);
	const callerPane = allTabs(layoutIn(moved).root).filter(
		(tab) => tab.terminal === caller || tab.terminal === four,
	);
	expect(callerPane).toHaveLength(2);

	// One pane of tabs, then side-by-side columns.
	const stacked = await mcp(from, 'arrange_tabs', { arrangement: 'tabs' });
	expect(stacked.ok).toBe(true);
	await expect(groups(mainWindow)).toHaveCount(1);
	expect(layoutIn(stacked).root?.tabs).toHaveLength(4);
	const columns = await mcp(from, 'arrange_tabs', { arrangement: 'columns' });
	expect(columns.ok).toBe(true);
	await expect(groups(mainWindow)).toHaveCount(4);
	const ys = await Promise.all(
		[caller, two, three, four].map(async (id) => (await centre(terminalPanelForSession(mainWindow, id))).y),
	);
	expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(4);

	// Back to one pane, then focus: the named tab comes to the front.
	await mcp(from, 'arrange_tabs', { arrangement: 'tabs' });
	await expect(groups(mainWindow)).toHaveCount(1);
	const focused = await mcp(from, 'focus_tab', { tab: three });
	expect(focused.ok).toBe(true);
	expect(focusedTerminal(layoutIn(focused))).toBe(three);
	await expect(terminalPanelForSession(mainWindow, three)).toBeVisible();
	await expect(terminalPanelForSession(mainWindow, caller)).toBeHidden();

	// Opening with focus brings the new terminal to the front.
	const front = await mcp(terminalPanelForSession(mainWindow, three), 'open_terminal', { focus: true });
	expect(front.ok).toBe(true);
	expect(front.result?.focused).toBe(true);
	const newest = front.result?.terminal as string;
	expect(focusedTerminal(layoutIn(front))).toBe(newest);
	await expect(terminalPanelForSession(mainWindow, newest)).toBeVisible();
	await expect(terminalPanelForSession(mainWindow, three)).toBeHidden();
});

test('folders, file tabs, and closing tabs; nothing outside the calling project is reachable', async ({
	createWorkspace,
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(180_000);
	const mcp = mcpFrom(mainWindow, userDataDir);
	const elsewhere = await activeTerminalSessionId(mainWindow);
	const workspace = await createWorkspace({ seed: { files: { 'notes.md': '# Notes from the agent test\n' } } });
	await createStartedProject(mainWindow, { folder: workspace.rootDir });
	const caller = await activeTerminalSessionId(mainWindow);
	expect(caller).not.toBe(elsewhere);
	const from = terminalPanelForSession(mainWindow, caller);

	// Another project's terminal is not this agent's to see or move.
	const refused = await mcp(from, 'focus_tab', { tab: elsewhere });
	expect(refused.ok).toBe(false);
	expect(refused.error?.code).toBe('not_found');
	const named = await mcp(from, 'get_layout', { project: 'prj_AAAAAAAAAAAAAAAAAAAAAA' });
	expect(named.ok).toBe(false);
	expect(named.error?.code).toBe('bad_request');

	// A file opens in a viewer tab; the agent gets the tab, not the file.
	const file = await mcp(from, 'open_file', { path: 'notes.md' });
	expect(file.ok).toBe(true);
	expect(JSON.stringify(file)).not.toContain('Notes from the agent test');
	const fileTab = file.result?.tab as string;
	expect(allTabs(layoutIn(file).root).find((tab) => tab.tab === fileTab)?.kind).toBe('file');
	await expect(mainWindow.locator('.project-workspace--active .dv-tab', { hasText: 'notes.md' })).toBeVisible();
	// The file tab is in front now; the user goes back to the terminal.
	await mainWindow.locator('.project-workspace--active .terminal-tab-content').first().click();
	await expect(from).toBeVisible();
	const outside = await mcp(from, 'open_file', { path: '../outside.md' });
	expect(outside.ok).toBe(false);
	expect(outside.error?.code).toBe('bad_request');

	// Closing a tab as the user would.
	const closed = await mcp(from, 'close_tab', { tab: fileTab });
	expect(closed.ok).toBe(true);
	expect(closed.result?.closed).toBe(true);
	await expect(mainWindow.locator('.project-workspace--active .dv-tab', { hasText: 'notes.md' })).toHaveCount(0);

	// A folder, a terminal moved into it, and the folder shown.
	const created = await mcp(from, 'create_folder', { name: 'Builds' });
	expect(created.ok).toBe(true);
	const folder = created.result?.folder as string;
	const renamed = await mcp(from, 'rename_folder', { folder, name: 'CI' });
	expect(renamed.ok).toBe(true);
	const worker = await mcp(from, 'open_terminal', { name: 'Worker' });
	const workerId = worker.result?.terminal as string;
	const moved = await mcp(from, 'move_tab_to_folder', { tab: workerId, folder });
	expect(moved.ok).toBe(true);
	const listed = await mcp(from, 'get_layout');
	const folders = (listed.result as unknown as Layout).folders;
	expect(folders.map((entry) => entry.name)).toEqual(['General', 'CI']);
	expect(folders.find((entry) => entry.name === 'General')?.selected).toBe(true);

	const shown = await mcp(from, 'select_folder', { folder });
	expect(shown.ok).toBe(true);
	const layout = layoutIn(shown);
	expect(layout.folder).toBe(folder);
	expect(layout.folders.find((entry) => entry.folder === folder)?.selected).toBe(true);
	expect(allTabs(layout.root).map((tab) => tab.terminal)).toEqual([workerId]);
	await expect(terminalPanelForSession(mainWindow, workerId)).toBeVisible();
	await expect(terminalPanelForSession(mainWindow, caller)).toBeHidden();
});
