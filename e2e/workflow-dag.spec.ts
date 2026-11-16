import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * Workflows whose steps form a dependency graph (ADR-0128): brackets in the
 * vertical panel, capsules on the rail, the horizontal metro drawer and its
 * strip, the ⋯ options menu, tracing, and the outline template editor.
 */

const READY_TIMEOUT_MS = 20_000;

const MCP_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile, tag] = process.argv.slice(2);
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
	const steps = response.ok ? (response.result.workflow?.steps ?? []) : [];
	const summary = response.ok
		? (response.result.workflow === null ? 'none' : steps.map((step) => step.status).join(','))
		: response.error.code;
	console.log(['RESULT', tag, op, summary || 'ok', steps.map((step) => step.id).join(',') || 'none', 'END'].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`;

const panelFor = (page: Page, sessionId: string): Locator =>
	page.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
const workflowPanel = (page: Page, sessionId: string): Locator => panelFor(page, sessionId).locator('.workflow-panel');
const drawerOf = (page: Page, sessionId: string): Locator => panelFor(page, sessionId).locator('.workflow-drawer');
const stepRow = (scope: Locator, title: string): Locator =>
	scope.locator('.workflow-step').filter({ has: scope.page().locator('.workflow-step-title', { hasText: new RegExp(`^${title}`) }) });
const station = (scope: Locator, title: string): Locator => scope.locator(`.workflow-station[title="${title}"]`);

let sequence = 0;

/** An MCP call from the terminal, as its agent would make it: the statuses and step ids. */
async function call(
	page: Page,
	sessionId: string,
	userDataDir: string,
	op: string,
	params: Record<string, unknown>,
): Promise<{ summary: string; ids: string[] }> {
	const script = path.join(userDataDir, 'workflow-dag-e2e.mjs');
	const file = path.join(userDataDir, `workflow-dag-params-${++sequence}.json`);
	await writeFile(script, MCP_SCRIPT);
	await writeFile(file, JSON.stringify(params));
	const rows = panelFor(page, sessionId).locator('.xterm-rows');
	const tag = `dag${sequence}`;
	const pattern = new RegExp(`RESULT ${tag} ${op} (\\S+) (\\S+) END`, 'gu');
	const results = async () =>
		[...((await rows.textContent()) ?? '').matchAll(pattern)].map((match) => ({
			summary: match[1] ?? '',
			ids: match[2] === 'none' || match[2] === undefined ? [] : match[2].split(','),
		}));
	await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${file}' ${tag}`, panelFor(page, sessionId));
	await expect.poll(async () => (await results()).length, { timeout: READY_TIMEOUT_MS }).toBeGreaterThan(0);
	return (await results()).at(-1) ?? { summary: '', ids: [] };
}

/** Two reviews of one proposal, then Amend waiting on both, then PR. */
const REVIEWS = {
	name: 'Reviews',
	opening_prompt: 'Review the proposal twice, at the same time.',
	steps: [
		{ id: 'propose', title: 'Propose', icon: 'lightbulb' },
		{ id: 'codex', title: 'Codex review', after: ['propose'] },
		{ id: 'specs', title: 'Spec review', after: ['propose'] },
		{ id: 'amend', title: 'Amend', after: ['codex', 'specs'] },
		{ id: 'pr', title: 'PR', after: ['amend'] },
	],
};

/** Steps by title, after the workflow is created: propose, codex, specs, amend, pr. */
async function startReviews(page: Page, sessionId: string, userDataDir: string, specs: 'running' | 'needs_input' = 'running') {
	const created = await call(page, sessionId, userDataDir, 'create_workflow', REVIEWS);
	expect(created.summary).toBe('not_started,not_started,not_started,not_started,not_started');
	const [propose, codex, review] = created.ids;
	const update = (stepId: string | undefined, status: string) =>
		call(page, sessionId, userDataDir, 'update_workflow_step', { step_id: stepId, status });
	await update(propose, 'running');
	await update(propose, 'done');
	// Both reviews start together: neither waits on the other.
	await update(codex, 'running');
	expect((await update(review, specs)).summary).toBe(`done,running,${specs},not_started,not_started`);
	return created.ids;
}

/** The terminal's viewport ends where the workflow chrome begins. */
async function expectTerminalClear(panel: Locator, chrome: Locator, edge: 'bottom' | 'right'): Promise<void> {
	await expect
		.poll(async () => {
			const screen = await panel.locator('.xterm-screen').boundingBox();
			const box = await chrome.boundingBox();
			if (screen === null || box === null) return Number.NaN;
			return edge === 'bottom' ? box.y - (screen.y + screen.height) : box.x - (screen.x + screen.width);
		})
		.toBeGreaterThanOrEqual(0);
}

function killHolders(userDataDir: string): void {
	const directory = path.join(userDataDir, 'session-holder');
	if (!existsSync(directory)) return;
	for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json'))) {
		try {
			process.kill(JSON.parse(readFileSync(path.join(directory, name), 'utf8')).pid as number, 'SIGKILL');
		} catch {
			/* already gone */
		}
	}
}

async function resizeWindow(electronApp: ElectronApplication, width: number, height: number): Promise<void> {
	await electronApp.evaluate(
		({ BrowserWindow }, size) => {
			const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
			window?.setSize(size.width, size.height);
		},
		{ width, height },
	);
}

test('steps that run alongside each other are a bracket, the rail a capsule, and tracing lights what a step waits on', async ({
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(120_000);
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		await startReviews(mainWindow, sessionId, userDataDir);
		const panel = workflowPanel(mainWindow, sessionId);

		// Collapsed: one capsule round the two reviews, coloured as running, on a 36px rail.
		await expect(panel.locator('.workflow-capsule')).toHaveCount(1, { timeout: READY_TIMEOUT_MS });
		await expect(panel.locator('.workflow-capsule')).toHaveAttribute('data-workflow-group-tone', 'running');
		await expect(panel.locator('.workflow-capsule .workflow-rail-step')).toHaveCount(2);
		expect((await panel.boundingBox())?.width).toBe(36);
		await expectTerminalClear(panelFor(mainWindow, sessionId), panel, 'right');
		await panel.screenshot({ path: testInfo.outputPath('dag-rail-capsule.png') });

		// Expanded: a bracket of two tracks, no "after" text, both reviews highlighted.
		await panel.getByRole('button', { name: 'Expand workflow' }).click();
		const expanded = panel.locator('.workflow-expanded');
		await expect(expanded.locator('.workflow-group')).toHaveCount(1);
		await expect(expanded.locator('.workflow-group')).toHaveAttribute('data-workflow-group-tone', 'running');
		await expect(expanded.locator('.workflow-group .workflow-track')).toHaveCount(2);
		await expect(expanded.locator('.workflow-step-after')).toHaveCount(0);
		await expect(expanded.locator('.workflow-step--active')).toHaveCount(2);
		await expect(expanded.locator('.workflow-progress')).toContainText('1 of 5 done · 2 running');
		// The progress line takes the header's whole width, and wraps only between its parts.
		for (const part of await expanded.locator('.workflow-progress-part').all())
			expect((await part.boundingBox())?.height).toBeLessThanOrEqual(17);
		expect((await expanded.locator('.workflow-progress').boundingBox())?.width).toBeGreaterThan(
			((await expanded.locator('.workflow-header-buttons').boundingBox())?.x ?? 0) - ((await panel.boundingBox())?.x ?? 0),
		);
		await expectTerminalClear(panelFor(mainWindow, sessionId), panel, 'right');
		await panel.screenshot({ path: testInfo.outputPath('dag-vertical-expanded.png') });

		// Hovering Codex review lights Propose, Amend and PR, and dims Spec review.
		await stepRow(expanded, 'Codex review').hover();
		for (const title of ['Propose', 'Codex review', 'Amend', 'PR'])
			await expect(stepRow(expanded, title)).toHaveClass(/workflow-step--traced/u);
		await expect(stepRow(expanded, 'Spec review')).toHaveClass(/workflow-step--dimmed/u);
		await panel.screenshot({ path: testInfo.outputPath('dag-vertical-tracing.png') });
		await mainWindow.mouse.move(5, 5);
		await expect(expanded.locator('.workflow-step--dimmed, .workflow-step--traced')).toHaveCount(0);

		// Focusing a step from the keyboard does the same, and moving focus clears it.
		await stepRow(expanded, 'Spec review').focus();
		await expect(stepRow(expanded, 'Codex review')).toHaveClass(/workflow-step--dimmed/u);
		await expect(stepRow(expanded, 'Amend')).toHaveClass(/workflow-step--traced/u);
		await panelFor(mainWindow, sessionId).locator('.xterm-helper-textarea').focus();
		await expect(expanded.locator('.workflow-step--dimmed, .workflow-step--traced')).toHaveCount(0);

		// A tap traces until a tap elsewhere.
		await stepRow(expanded, 'Codex review').dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
		await expect(stepRow(expanded, 'Spec review')).toHaveClass(/workflow-step--dimmed/u);
		await expanded.locator('.workflow-header').dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
		await expect(expanded.locator('.workflow-step--dimmed, .workflow-step--traced')).toHaveCount(0);
	} finally {
		killHolders(userDataDir);
	}
});

test('a dependency the brackets cannot show reads "after", and a nested bracket widens the rail to 44px', async ({
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(120_000);
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const created = await call(mainWindow, sessionId, userDataDir, 'create_workflow', {
			name: 'Partial',
			steps: [
				{ id: 'amend', title: 'Amend' },
				{ id: 'server', title: 'Server', after: ['amend'] },
				{ id: 'ui', title: 'UI', after: ['amend'] },
				{ id: 'docs', title: 'Docs', after: ['amend'] },
				{ id: 'verify', title: 'Verify', after: ['server', 'ui'] },
				{ id: 'e2e', title: 'E2E', after: ['ui'] },
				{ id: 'pr', title: 'PR', after: ['verify', 'e2e', 'docs'] },
			],
		});
		expect(created.ids).toHaveLength(7);
		const panel = workflowPanel(mainWindow, sessionId);
		await expect(panel.locator('.workflow-capsule .workflow-capsule').first()).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect.poll(async () => (await panel.boundingBox())?.width).toBe(44);
		await expectTerminalClear(panelFor(mainWindow, sessionId), panel, 'right');
		await panel.screenshot({ path: testInfo.outputPath('dag-rail-nested.png') });

		await panel.getByRole('button', { name: 'Expand workflow' }).click();
		const expanded = panel.locator('.workflow-expanded');
		await expect(expanded.locator('.workflow-step-after')).toHaveCount(1);
		await expect(stepRow(expanded, 'E2E').locator('.workflow-step-after')).toHaveText('after UI');
		await expect(expanded.locator('.workflow-group--divided')).toHaveCount(1);
		await panel.screenshot({ path: testInfo.outputPath('dag-vertical-after.png') });
	} finally {
		killHolders(userDataDir);
	}
});

test('the options menu switches to the horizontal drawer, whose map, strip and stations work, and removes the workflow', async ({
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(150_000);
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const terminal = panelFor(mainWindow, sessionId);
		await startReviews(mainWindow, sessionId, userDataDir, 'needs_input');
		const panel = workflowPanel(mainWindow, sessionId);
		await expect(panel.locator('.workflow-capsule')).toHaveAttribute('data-workflow-group-tone', 'alert', { timeout: READY_TIMEOUT_MS });

		// The vertical panel is expanded; the horizontal layout keeps its own (collapsed) setting.
		await panel.getByRole('button', { name: 'Expand workflow' }).click();
		await expect(panel).toHaveAttribute('data-workflow-mode', 'expanded');

		// The menu is keyboard operable, sends nothing to the terminal, and Escape returns focus.
		const options = panel.getByRole('button', { name: 'Workflow options' });
		await options.click();
		const menu = panel.getByRole('menu', { name: 'Workflow options' });
		await expect(menu).toBeVisible();
		await expect(menu.getByRole('menuitemradio', { name: /Vertical/u })).toHaveAttribute('aria-checked', 'true');
		await expect(menu.getByRole('menuitemradio', { name: /Vertical/u })).toBeFocused();
		// Step notes are chosen here too, under Show as.
		await expect(menu.getByRole('menuitemradio', { name: 'Step notes: Full' })).toHaveAttribute('aria-checked', 'true');
		// Wider than the panel, the menu still lies wholly inside the window.
		const menuBox = await menu.boundingBox();
		const viewport = mainWindow.viewportSize() ?? (await mainWindow.evaluate(() => ({ width: innerWidth, height: innerHeight })));
		expect(menuBox?.x).toBeGreaterThanOrEqual(0);
		expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
		expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
		const clipX = Math.max(0, (menuBox?.x ?? 0) - 40);
		await mainWindow.screenshot({
			path: testInfo.outputPath('dag-options-menu.png'),
			clip: {
				x: clipX,
				y: 0,
				width: viewport.width - clipX,
				height: Math.min(viewport.height, (menuBox?.y ?? 0) + (menuBox?.height ?? 0) + 60),
			},
		});
		const rowsBefore = (await terminal.locator('.xterm-rows').textContent()) ?? '';
		await mainWindow.keyboard.type('zqzq');
		await mainWindow.keyboard.press('ArrowDown');
		await expect(menu.getByRole('menuitemradio', { name: /Horizontal/u })).toBeFocused();
		await mainWindow.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(options).toBeFocused();
		expect((await terminal.locator('.xterm-rows').textContent()) ?? '').toBe(rowsBefore);

		// Choosing Horizontal puts the workflow in a strip along the bottom.
		await options.click();
		await menu.getByRole('menuitemradio', { name: /Horizontal/u }).click();
		const drawer = drawerOf(mainWindow, sessionId);
		await expect(drawer).toHaveAttribute('data-workflow-mode', 'collapsed', { timeout: READY_TIMEOUT_MS });
		await expect(panel).toHaveCount(0);
		expect(await mainWindow.evaluate(() => localStorage.getItem('terminay.workflowLayout.v1'))).toBe('horizontal');
		expect((await drawer.boundingBox())?.height).toBe(46);
		await expect(drawer.locator('.workflow-strip-count')).toHaveText('1/5');
		await expect(drawer.locator('.workflow-strip-dot')).toHaveCount(5);
		await expect(drawer.locator('.workflow-strip-now')).toHaveText('Codex review · Spec review needs you');
		await expectTerminalClear(terminal, drawer, 'bottom');
		await drawer.screenshot({ path: testInfo.outputPath('dag-horizontal-strip.png') });

		// Expanded: the metro map, reviews stacked in one column between Propose and Amend.
		await drawer.getByRole('button', { name: 'Expand workflow' }).click();
		await expect(drawer).toHaveAttribute('data-workflow-mode', 'expanded');
		await expect(drawer.locator('.workflow-progress')).toContainText('1 of 5 done · 1 running · 1 needs you');
		const box = async (title: string) => (await station(drawer, title).boundingBox()) ?? { x: Number.NaN, y: Number.NaN };
		const propose = await box('Propose');
		const codex = await box('Codex review');
		const specs = await box('Spec review');
		const amend = await box('Amend');
		expect(codex.x).toBeGreaterThan(propose.x);
		expect(specs.x).toBe(codex.x);
		expect(specs.y).toBeGreaterThan(codex.y);
		expect(amend.x).toBeGreaterThan(codex.x);
		await expect(drawer.locator('.workflow-edge--done')).toHaveCount(2);
		await expect(drawer.locator('.workflow-edge--waiting')).toHaveCount(3);
		expect((await drawer.boundingBox())?.height).toBeLessThanOrEqual(240);
		await expectTerminalClear(terminal, drawer, 'bottom');
		await drawer.screenshot({ path: testInfo.outputPath('dag-horizontal-drawer.png') });

		// Stations: Tab reaches one, the arrows move between them, Enter selects.
		await station(drawer, 'Propose').focus();
		await mainWindow.keyboard.press('ArrowRight');
		await expect(station(drawer, 'Codex review')).toBeFocused();
		await mainWindow.keyboard.press('Enter');
		await expect(drawer.locator('.workflow-station-detail')).toContainText('Codex review');
		await expect(drawer.locator('.workflow-station-detail')).toContainText('running');

		// Hovering a station traces it here too.
		await station(drawer, 'Codex review').hover();
		await expect(station(drawer, 'Spec review')).toHaveClass(/workflow-station--dimmed/u);
		await expect(station(drawer, 'Amend')).toHaveClass(/workflow-station--traced/u);
		await mainWindow.mouse.move(5, 5);

		// A selected not-started station offers Skip, and Restore once skipped.
		await station(drawer, 'PR').click();
		const detail = drawer.locator('.workflow-station-detail');
		await expect(detail).toContainText('not started');
		await detail.getByRole('button', { name: 'Skip PR' }).click();
		await expect(station(drawer, 'PR')).toHaveAttribute('data-status', 'skipped', { timeout: READY_TIMEOUT_MS });
		await expect(detail).toContainText('Skipped from the panel');
		await detail.getByRole('button', { name: 'Restore PR' }).click();
		await expect(station(drawer, 'PR')).toHaveAttribute('data-status', 'not_started', { timeout: READY_TIMEOUT_MS });

		// Cancel returns to the menu; Remove removes the workflow and the terminal fills the pane.
		const drawerOptions = drawer.getByRole('button', { name: 'Workflow options' });
		await drawerOptions.click();
		const drawerMenu = drawer.getByRole('menu', { name: 'Workflow options' });
		await drawerMenu.getByRole('menuitem', { name: 'Remove workflow…' }).click();
		await expect(drawerMenu).toContainText('Remove Reviews from this terminal?');
		await drawer.screenshot({ path: testInfo.outputPath('dag-remove-confirm.png') });
		await drawerMenu.getByRole('menuitem', { name: 'Cancel' }).click();
		await expect(drawerMenu).toContainText('Show as');
		await expect(drawerMenu.getByRole('menuitem', { name: 'Remove workflow…' })).toBeVisible();
		await drawerMenu.getByRole('menuitem', { name: 'Remove workflow…' }).click();
		await drawerMenu.getByRole('menuitem', { name: 'Remove', exact: true }).click();
		await expect(drawer).toHaveCount(0, { timeout: READY_TIMEOUT_MS });
		await expect(terminal).not.toHaveCSS('padding-bottom', /^[1-9]/u);
		expect((await call(mainWindow, sessionId, userDataDir, 'get_workflow', {})).summary).toBe('no_workflow');

		// Each layout kept its own collapse: back to vertical, the panel is still expanded.
		await startReviews(mainWindow, sessionId, userDataDir);
		await drawerOf(mainWindow, sessionId).getByRole('button', { name: 'Collapse workflow' }).click();
		await drawerOf(mainWindow, sessionId).getByRole('button', { name: 'Workflow options' }).click();
		await drawerOf(mainWindow, sessionId).getByRole('menuitemradio', { name: /Vertical/u }).click();
		await expect(workflowPanel(mainWindow, sessionId)).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });
	} finally {
		await mainWindow.evaluate(() => localStorage.removeItem('terminay.workflowLayout.v1')).catch(() => undefined);
		killHolders(userDataDir);
	}
});

test('in a short pane the drawer keeps its strip, and its overlay closes the menu before itself on Escape', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(120_000);
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const terminal = panelFor(mainWindow, sessionId);
		await mainWindow.evaluate(() => {
			localStorage.setItem('terminay.workflowLayout.v1', 'horizontal');
			window.dispatchEvent(new StorageEvent('storage', { key: 'terminay.workflowLayout.v1' }));
		});
		await startReviews(mainWindow, sessionId, userDataDir);
		const drawer = drawerOf(mainWindow, sessionId);
		await expect(drawer).toHaveAttribute('data-workflow-mode', 'collapsed', { timeout: READY_TIMEOUT_MS });

		// Too short for the expanded drawer above ten rows: the strip shows whatever the setting.
		await resizeWindow(electronApp, 900, 360);
		await mainWindow.evaluate(() => {
			localStorage.setItem('terminay.workflowDrawer.v1', 'expanded');
			window.dispatchEvent(new StorageEvent('storage', { key: 'terminay.workflowDrawer.v1' }));
		});
		await expect(drawer).toHaveAttribute('data-workflow-mode', 'forced-collapsed', { timeout: READY_TIMEOUT_MS });
		const height = () => terminal.evaluate((element) => element.querySelector('.xterm-screen')?.getBoundingClientRect().height ?? -1);
		// The terminal refits after the window shrinks; take its height once it holds still.
		let before = -1;
		await expect
			.poll(
				async () => {
					const first = await height();
					await mainWindow.waitForTimeout(300);
					before = await height();
					return before === first && before > 0;
				},
				{ timeout: READY_TIMEOUT_MS },
			)
			.toBe(true);

		// Expanding opens the overlay: focused, over the terminal, with no strip behind it.
		await drawer.getByRole('button', { name: 'Expand workflow' }).click();
		const overlay = drawer.getByRole('dialog', { name: 'Workflow' });
		await expect(overlay).toBeFocused();
		await expect(drawer.locator('.workflow-strip')).toHaveCount(0);
		expect(await height()).toBe(before);
		await mainWindow.screenshot({ path: testInfo.outputPath('dag-horizontal-overlay.png') });

		// The first Escape closes the menu and keeps the overlay; the second closes the overlay.
		const options = overlay.getByRole('button', { name: 'Workflow options' });
		await options.click();
		await expect(overlay.getByRole('menu')).toBeVisible();
		await mainWindow.keyboard.press('Escape');
		await expect(overlay.getByRole('menu')).toHaveCount(0);
		await expect(options).toBeFocused();
		await expect(overlay).toBeVisible();
		await mainWindow.keyboard.press('Escape');
		await expect(overlay).toHaveCount(0);
		await expect(drawer.locator('.workflow-strip')).toBeVisible();
		await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused();
		expect(await mainWindow.evaluate(() => localStorage.getItem('terminay.workflowDrawer.v1'))).toBe('expanded');
	} finally {
		await mainWindow
			.evaluate(() => {
				localStorage.removeItem('terminay.workflowLayout.v1');
				localStorage.removeItem('terminay.workflowDrawer.v1');
			})
			.catch(() => undefined);
		killHolders(userDataDir);
	}
});

test('the outline editor builds two tracks, which launch as a bracket, and moves a step within its track', async ({
	appHarness,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(150_000);
	try {
		const settings = await appHarness.openSettingsWindow({ sectionId: 'workflows' });
		await settings.getByRole('button', { name: 'New workflow', exact: true }).click();
		await settings.getByLabel('Workflow name').fill('Outline flow');
		await settings.getByLabel('Step 1 title').fill('Propose');
		await settings.getByRole('button', { name: 'Add a step after step 1' }).click();
		await settings.getByLabel('Step 2 title').fill('Review');
		await settings.getByRole('button', { name: 'Add a step alongside step 2' }).click();
		await settings.getByLabel('Step 3 title').fill('Spec review');
		await expect(settings.locator('.workflow-outline-group')).toHaveCount(1);
		await expect(settings.locator('.workflow-outline-track')).toHaveCount(2);
		// Two more steps in the first track, then Amend after the bracket.
		await settings.getByRole('button', { name: 'Add a step after step 2' }).click();
		await settings.getByLabel('Step 3 title').fill('Review two');
		await settings.getByRole('button', { name: 'Add a step after step 3' }).click();
		await settings.getByLabel('Step 4 title').fill('Review three');
		await settings.getByRole('button', { name: '+ Add step at the end' }).click();
		await settings.getByLabel('Step 6 title').fill('Amend');
		await expect(settings.getByLabel('Step 5 title')).toHaveValue('Spec review');

		// Alt+Arrow Up moves the track's third step to second; its handle keeps focus.
		const handle = settings.getByRole('button', { name: 'Move step 4', exact: true });
		await handle.focus();
		await settings.keyboard.press('Alt+ArrowUp');
		await expect(settings.getByLabel('Step 3 title')).toHaveValue('Review three');
		await expect(settings.getByRole('button', { name: 'Move step 3', exact: true })).toBeFocused();
		// It never leaves its track.
		await settings.keyboard.press('Alt+ArrowUp');
		await settings.keyboard.press('Alt+ArrowUp');
		await expect(settings.getByLabel('Step 2 title')).toHaveValue('Review three');
		await expect(settings.getByLabel('Step 1 title')).toHaveValue('Propose');

		// A step's prompt opens beneath its row and takes as many lines as it needs.
		const promptToggle = settings.getByRole('button', { name: 'Step 1 prompt', exact: true });
		await promptToggle.click();
		await expect(promptToggle).toHaveAttribute('aria-expanded', 'true');
		const prompt = settings.getByLabel('Step 1 prompt text', { exact: true });
		const lines = ['Propose the change.', '', '- capture every decision', '- do not reopen settled questions', '- list open questions'];
		await prompt.fill(lines.join('\n'));
		await expect(prompt).toHaveValue(lines.join('\n'));
		expect(Number(await prompt.getAttribute('rows'))).toBeGreaterThanOrEqual(lines.length);
		await settings.locator('.workflow-steps-editor').screenshot({ path: testInfo.outputPath('dag-outline-prompt.png') });
		// Escape closes it, back on the title; the closed row shows the prompt's first line.
		await settings.keyboard.press('Escape');
		await expect(prompt).toHaveCount(0);
		await expect(settings.getByLabel('Step 1 title')).toBeFocused();
		await expect(settings.locator('[data-step-key] .workflow-outline-excerpt').first()).toHaveText('Propose the change.');
		await settings.locator('.workflow-steps-editor').screenshot({ path: testInfo.outputPath('dag-outline-editor.png') });
		await settings.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(settings.locator('.macro-save-state')).toHaveText('Saved');
		// Reopened from the server, it is drawn the same.
		await expect(settings.locator('.workflow-outline-track')).toHaveCount(2);
		await settings.close();

		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		await sendAppCommand(mainWindow, 'open-command-bar');
		await mainWindow.getByPlaceholder('Search commands...').fill('Outline flow');
		await mainWindow
			.getByRole('dialog', { name: 'Command bar' })
			.locator('.macro-launcher-item', { has: mainWindow.locator('.macro-launcher-item-title', { hasText: /^Outline flow$/u }) })
			.first()
			.click();
		const panel = workflowPanel(mainWindow, sessionId);
		await expect(panel.locator('.workflow-capsule')).toHaveCount(1, { timeout: READY_TIMEOUT_MS });
		await panel.getByRole('button', { name: 'Expand workflow' }).click();
		await expect(panel.locator('.workflow-group .workflow-track')).toHaveCount(2);
		await expect(panel.locator('.workflow-step-after')).toHaveCount(0);
		await expect(stepRow(panel, 'Amend')).toBeVisible();
	} finally {
		killHolders(userDataDir);
	}
});
