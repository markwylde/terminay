import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow, sendAppCommand } from './support/app';
import { waitUntilBusy } from './support/busy-terminals';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * Terminal workflows (ADR-0097): a template made in Settings, launched on a
 * terminal from the Command Bar, driven by the terminal's agent through the
 * Terminay MCP tools, and still there when the terminal comes back from the
 * session holder.
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
	const template = response.ok ? response.result.template : undefined;
	const summary = response.ok
		? (response.result.workflow === null ? 'none' : steps.map((step) => step.status).join(','))
		: response.error.code;
	const ids = template === undefined ? steps.map((step) => step.id) : [template.id];
	console.log(['RESULT', tag, op, summary || 'ok', ids.join(',') || 'none', 'END'].join(' '));
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

let paramsSequence = 0;

/** Make an MCP call from a terminal, as its agent would: the step statuses, or the refusal code. */
async function callFrom(
	page: Page,
	sessionId: string,
	userDataDir: string,
	op: string,
	params: Record<string, unknown>,
): Promise<string> {
	return (await callWithIds(page, sessionId, userDataDir, op, params)).summary;
}

/** As `callFrom`, with the step ids the workflow names. */
async function callWithIds(
	page: Page,
	sessionId: string,
	userDataDir: string,
	op: string,
	params: Record<string, unknown>,
	approve = false,
): Promise<{ summary: string; ids: string[] }> {
	const script = path.join(userDataDir, 'workflow-e2e.mjs');
	const file = path.join(userDataDir, `workflow-params-${++paramsSequence}.json`);
	await writeFile(script, MCP_SCRIPT);
	await writeFile(file, JSON.stringify(params));
	const rows = panelFor(page, sessionId).locator('.xterm-rows');
	const tag = `call${paramsSequence}`;
	const pattern = new RegExp(`RESULT ${tag} ${op} (\\S+) (\\S+) END`, 'gu');
	const results = async () =>
		[...((await rows.textContent()) ?? '').matchAll(pattern)].map((match) => ({
			summary: match[1] ?? '',
			ids: match[2] === 'none' || match[2] === undefined ? [] : match[2].split(','),
		}));
	await submitTerminalCommand(page, `clear; '${process.execPath}' '${script}' ${op} '${file}' ${tag}`, panelFor(page, sessionId));
	if (approve) {
		// The call waits on an inline approval in the calling terminal.
		const strip = page.locator('.project-workspace--active .terminal-mcp-approval:visible');
		await expect(strip).toContainText('Workflow Templates', { timeout: READY_TIMEOUT_MS });
		await strip.getByRole('button', { name: 'Allow One Time' }).click();
	}
	await expect.poll(async () => (await results()).length).toBeGreaterThan(0);
	return (await results()).at(-1) ?? { summary: '', ids: [] };
}

async function openCommandBar(page: Page): Promise<Locator> {
	const bar = page.getByRole('dialog', { name: 'Command bar' });
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await sendAppCommand(page, 'open-command-bar');
		try {
			await expect(bar).toBeVisible({ timeout: 2_000 });
			return bar;
		} catch (error) {
			if (attempt === 2) throw error;
		}
	}
	return bar;
}

async function chooseFromCommandBar(page: Page, query: string, title: string): Promise<void> {
	const bar = await openCommandBar(page);
	await page.getByPlaceholder('Search commands...').fill(query);
	await bar.locator('.macro-launcher-item', { has: page.locator('.macro-launcher-item-title', { hasText: new RegExp(`^${title}$`) }) }).first().click();
}

/** Make the template in Settings › Workflows and save it. */
async function createTemplate(settings: Page): Promise<void> {
	await settings.getByRole('button', { name: 'New workflow', exact: true }).click();
	await settings.getByLabel('Workflow name').fill('E2E flow');
	await settings.getByLabel('Opening prompt').fill('Ship the e2e workflow.');
	await settings.getByLabel('Step 1 title').fill('Explore');
	await settings.getByLabel('Step 1 icon').selectOption('eye');
	await settings.getByRole('button', { name: 'Add step', exact: true }).click();
	await settings.getByLabel('Step 2 title').fill('Build');
	await settings.getByLabel('Step 2 icon').selectOption('wrench');
	await settings.getByRole('button', { name: 'Add step', exact: true }).click();
	await settings.getByLabel('Step 3 title').fill('Verify');
	// The third step moves up from the keyboard, and its handle keeps the focus.
	const handle = settings.getByRole('button', { name: 'Move step 3', exact: true });
	await handle.focus();
	await settings.keyboard.press('Alt+ArrowUp');
	await expect(settings.getByLabel('Step 2 title')).toHaveValue('Verify');
	await expect(settings.getByRole('button', { name: 'Move step 2', exact: true })).toBeFocused();
	await settings.keyboard.press('Alt+ArrowDown');
	await expect(settings.getByLabel('Step 3 title')).toHaveValue('Verify');
	await expect(settings.locator('.workflow-launch-preview')).toContainText('/goal Ship the e2e workflow.');
	await settings.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(settings.locator('.macro-save-state')).toHaveText('Saved');
}

function holderPids(userDataDir: string): number[] {
	const directory = path.join(userDataDir, 'session-holder');
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.flatMap((name) => {
			try {
				return [JSON.parse(readFileSync(path.join(directory, name), 'utf8')).pid as number];
			} catch {
				return [];
			}
		});
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

async function quitKeepingTerminals(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ checkboxChecked: false, response: 0 });
	});
	const child = electronApp.process();
	const exited = new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
	await electronApp.evaluate(({ app }) => setImmediate(() => app.quit())).catch(() => undefined);
	await Promise.race([
		exited,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Terminay did not quit')), 30_000)),
	]);
}

test('a workflow made in Settings is launched, driven by MCP, survives a relaunch, and resumes', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(240_000);
	let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
	try {
		const settings = await appHarness.openSettingsWindow({ sectionId: 'workflows' });
		await createTemplate(settings);
		await settings.close();

		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const panel = panelFor(mainWindow, sessionId);
		// What the launch types lands in a file: one paste, submitted once.
		const typed = path.join(userDataDir, 'workflow-typed.txt');
		await submitTerminalCommand(mainWindow, `cat > '${typed}'`, panel);

		await chooseFromCommandBar(mainWindow, 'E2E flow', 'E2E flow');
		await expect(markers(mainWindow, sessionId)).toHaveCount(3, { timeout: READY_TIMEOUT_MS });
		await expect
			.poll(async () =>
				markers(mainWindow, sessionId).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-status'))),
			)
			.toEqual(['not_started', 'not_started', 'not_started']);
		await expect
			.poll(() => (existsSync(typed) ? readFileSync(typed, 'utf8') : ''))
			.toMatch(/^\/goal Ship the e2e workflow\.[^\n]*get_workflow[^\n]*\n$/u);
		await panel.locator('.xterm-helper-textarea').focus();
		await mainWindow.keyboard.press('Control+D');

		// The terminal's agent works through the steps.
		const read = await callWithIds(mainWindow, sessionId, userDataDir, 'get_workflow', {});
		expect(read.summary).toBe('not_started,not_started,not_started');
		const ids = read.ids;
		expect(ids).toHaveLength(3);
		const update = (stepId: string | undefined, status: string, note?: string) =>
			callFrom(mainWindow, sessionId, userDataDir, 'update_workflow_step', {
				step_id: stepId,
				status,
				...(note === undefined ? {} : { note }),
			});
		expect(await update(ids[0], 'running')).toBe('running,not_started,not_started');
		expect(await update(ids[0], 'done', 'looked around')).toBe('done,not_started,not_started');
		expect(await update(ids[1], 'running')).toBe('done,running,not_started');
		// One step at a time: another step cannot start while one is running.
		expect(await update(ids[2], 'running')).toBe('step_active');
		await expect
			.poll(async () =>
				markers(mainWindow, sessionId).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-status'))),
			)
			.toEqual(['done', 'running', 'not_started']);

		// Quit keeping the terminal; it comes back from the holder with its workflow.
		await submitTerminalCommand(mainWindow, 'sleep 600', panel);
		await waitUntilBusy(electronApp, mainWindow);
		await quitKeepingTerminals(electronApp);
		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const window = await prepareWindow(await relaunched.electronApp.firstWindow());
		await expect(panelFor(window, sessionId)).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect
			.poll(
				async () =>
					markers(window, sessionId).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-status'))),
				{ timeout: READY_TIMEOUT_MS },
			)
			.toEqual(['done', 'running', 'not_started']);

		// Resume types the resume text and changes no step.
		await panelFor(window, sessionId).locator('.xterm-helper-textarea').focus();
		await window.keyboard.press('Control+C');
		const resumed = path.join(userDataDir, 'workflow-resumed.txt');
		await submitTerminalCommand(window, `cat > '${resumed}'`, panelFor(window, sessionId));
		await chooseFromCommandBar(window, 'resume', 'Resume workflow');
		await expect
			.poll(() => (existsSync(resumed) ? readFileSync(resumed, 'utf8') : ''))
			.toMatch(/^\/goal Ship the e2e workflow\.[^\n]*get_workflow[^\n]*\n$/u);
		await expect
			.poll(async () =>
				markers(window, sessionId).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-status'))),
			)
			.toEqual(['done', 'running', 'not_started']);
		await panelFor(window, sessionId).locator('.xterm-helper-textarea').focus();
		await window.keyboard.press('Control+D');
	} finally {
		await relaunched?.close().catch(() => undefined);
		killHolders(userDataDir);
	}
});

test('an agent saves a workflow template over MCP, Settings lists it, and the agent starts a workflow from it', async ({
	appHarness,
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));

		// Saving a template asks by default (Workflow Templates), and attaches nothing.
		const saved = await callWithIds(
			mainWindow,
			sessionId,
			userDataDir,
			'create_workflow_template',
			{
				name: 'Agent template',
				category: 'From agents',
				opening_prompt: 'Saved by an agent.',
				steps: [{ title: 'Plan', icon: 'lightbulb' }, { title: 'Do' }],
			},
			true,
		);
		expect(saved.summary).toBe('ok');
		const [templateId] = saved.ids;
		expect(templateId).toMatch(/^tpl-/u);
		await expect(workflowPanel(mainWindow, sessionId)).toHaveCount(0);

		const settings = await appHarness.openSettingsWindow({ sectionId: 'workflows' });
		await expect(settings.getByText('From agents', { exact: false }).first()).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(settings.getByText(/Agent template\s*·\s*2 steps/u)).toBeVisible();
		await settings.close();

		// The agent copies the template into its own terminal; nothing is typed.
		const started = await callWithIds(mainWindow, sessionId, userDataDir, 'create_workflow', { template_id: templateId });
		expect(started.summary).toBe('not_started,not_started');
		await expect(markers(mainWindow, sessionId)).toHaveCount(2, { timeout: READY_TIMEOUT_MS });
		expect(await callFrom(mainWindow, sessionId, userDataDir, 'get_workflow_template', { template_id: 'tpl-missing' })).toBe(
			'template_not_found',
		);
	} finally {
		killHolders(userDataDir);
	}
});
