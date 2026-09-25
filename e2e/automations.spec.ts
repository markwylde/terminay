import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalPanel,
	settledTerminalSessionId,
} from './support/terminal-session';

/**
 * Automations end to end, with stubbed commands and no network: an event or a
 * schedule fires on the real server, and its action reaches a real terminal,
 * file, or MCP control socket.
 *
 * Automations are seeded into the server's data root before Terminay starts,
 * as a server that saved them earlier leaves them. Every command writes into
 * `outDir`, which lives beside that data root.
 */

type Seed = Readonly<{
	id: string;
	name: string;
	trigger:
		| { kind: 'schedule'; cron: string }
		| { kind: 'event'; event: string };
	action:
		| { kind: 'runCommand'; command: string }
		| { kind: 'writeText'; text: string; submit: boolean };
	keepTerminalAfterRun?: boolean;
	cooldownSeconds?: number;
}>;

const seeded = (
	build: (outDir: string) => readonly Seed[],
	prepare?: (outDir: string) => Promise<void>,
) =>
	test.extend<{ outDir: string }>({
		userDataDir: async ({ userDataDir }, use) => {
			const outDir = path.join(userDataDir, 'automation-e2e');
			await mkdir(outDir, { recursive: true });
			await prepare?.(outDir);
			const now = Date.now();
			await writeFile(
				path.join(userDataDir, 'automations.v1.json'),
				JSON.stringify({
					schemaVersion: 1,
					revision: 1,
					cursor: '1',
					automations: build(outDir).map((seed) => ({
						id: seed.id,
						name: seed.name,
						enabled: true,
						trigger: seed.trigger,
						action:
							seed.action.kind === 'runCommand'
								? { ...seed.action, maxDurationSeconds: 60 }
								: seed.action,
						settings: {
							keepTerminalAfterRun: seed.keepTerminalAfterRun ?? false,
							recordSession: false,
							cooldownSeconds: seed.cooldownSeconds ?? 60,
						},
						evaluatedThrough: now,
					})),
				}),
				{ mode: 0o600 },
			);
			await use(userDataDir);
		},
		outDir: async ({ userDataDir }, use) => {
			await use(path.join(userDataDir, 'automation-e2e'));
		},
	});

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });

async function openAutomation(page: Page, name: string): Promise<Locator> {
	await homeControl(page).click();
	await page.locator('[data-terminay-home-section-tab="automations"]').click();
	const row = page
		.locator('[data-terminay-automation-row]')
		.filter({ has: page.getByText(name, { exact: true }) });
	await expect(row).toBeVisible();
	await row.locator('.automations-row__main').click();
	return page.locator('[data-terminay-automation-detail]');
}

async function readLines(file: string): Promise<string[]> {
	const text = await readFile(file, 'utf8').catch(() => '');
	return text.split('\n').filter((line) => line.length > 0);
}

async function activeSessionId(page: Page): Promise<string> {
	return await settledTerminalSessionId(activeTerminalPanel(page));
}

const tabNamed = (page: Page, name: string) =>
	page
		.locator('.project-workspace--active .terminal-tab-content')
		.filter({ hasText: name });

/** Opens Terminal 2 and returns to Terminal 1, so Terminal 2 is a background
 * tab whose signals are not acknowledged by being viewed. */
async function backgroundTerminal(page: Page): Promise<string> {
	await sendAppCommand(page, 'new-terminal');
	await expect(
		page.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(2);
	const sessionId = await activeSessionId(page);
	await tabNamed(page, 'Terminal 1').click();
	return sessionId;
}

/** Publishes one agent session owned by a terminal's own shell process. */
async function agentIn(page: Page, terminalSessionId: string, id: string) {
	const pid = await page.evaluate(async (sessionId) => {
		if (!window.terminayAgentStatusTest)
			throw new Error('Agent status test seam is unavailable');
		return await window.terminayAgentStatusTest.terminalShellPid(sessionId);
	}, terminalSessionId);
	if (pid === null) throw new Error('Terminal shell pid is unavailable');
	return async (fields: Record<string, unknown>) => {
		const accepted = await page.evaluate(
			async (upsert) => {
				if (!window.terminayAgentStatusTest)
					throw new Error('Agent status test seam is unavailable');
				return await window.terminayAgentStatusTest.publishSessions({
					sourceId: 'com.terminay.e2e/automations',
					harnesses: [{ id: 'codex', displayName: 'Codex' }],
					publication: { upserts: [upsert] },
				});
			},
			{
				harness: 'codex',
				pid,
				cwd: '/tmp',
				id,
				title: 'Automation agent',
				...fields,
			},
		);
		if (!accepted) throw new Error('Agent session publication was refused');
	};
}

// ---------------------------------------------------------------------------
// a) Terminal needs attention runs a command that receives the subject context

const attention = seeded((outDir) => [
	{
		id: 'attention-context',
		name: 'Capture attention context',
		trigger: { kind: 'event', event: 'terminal.needsAttention' },
		action: {
			kind: 'runCommand',
			command: `env | grep '^TERMINAY_' | sort > ${path.join(outDir, 'attention-env.txt')}`,
		},
		cooldownSeconds: 0,
	},
]);

attention(
	'terminal needs attention runs a command with the subject’s context and no capability token',
	async ({ mainWindow, outDir }) => {
		const projectTitle = (
			await mainWindow
				.locator('.project-tab--active .project-tab-title')
				.innerText()
		).trim();
		const subjectSessionId = await backgroundTerminal(mainWindow);
		// Clear the tab-switch suppression window applied to the tab just left.
		await mainWindow.waitForTimeout(1_100);

		// The subject records its own capability token, then rings the bell.
		const subjectToken = path.join(outDir, 'subject-token.txt');
		await tabNamed(mainWindow, 'Terminal 2').click();
		await submitTerminalCommand(
			mainWindow,
			`printf '%s' "$TERMINAY_CONTROL_TOKEN" > ${subjectToken}; sleep 1.1; printf 'ding\\007\\n'`,
		);
		await tabNamed(mainWindow, 'Terminal 1').click();
		await expect(tabNamed(mainWindow, 'Terminal 2')).toHaveAttribute(
			'data-terminal-activity',
			'attention',
		);

		const envFile = path.join(outDir, 'attention-env.txt');
		await expect
			.poll(async () => (await readLines(envFile)).length, { timeout: 20_000 })
			.toBeGreaterThan(0);
		const lines = await readLines(envFile);
		const env = new Map(
			lines.map((line) => {
				const index = line.indexOf('=');
				return [line.slice(0, index), line.slice(index + 1)] as const;
			}),
		);
		expect(env.get('TERMINAY_EVENT')).toBe('terminal.needsAttention');
		expect(env.get('TERMINAY_AUTOMATION_ID')).toBe('attention-context');
		expect(env.get('TERMINAY_AUTOMATION_NAME')).toBe(
			'Capture attention context',
		);
		expect(env.get('TERMINAY_TERMINAL_HANDLE')).toBe(subjectSessionId);
		expect(env.get('TERMINAY_TERMINAL_TITLE')).toBe('Terminal 2');
		expect(env.get('TERMINAY_PROJECT_TITLE')).toBe(projectTitle);
		expect(Number.isNaN(Date.parse(env.get('TERMINAY_FIRED_AT') ?? ''))).toBe(
			false,
		);

		// The run holds its own MCP capability, and nothing else carries a token:
		// not the run's own under another name, and never the subject's.
		const token = (await readFile(subjectToken, 'utf8')).trim();
		expect(token.length).toBeGreaterThan(0);
		const runToken = env.get('TERMINAY_CONTROL_TOKEN');
		expect(runToken).toBeDefined();
		expect(runToken).not.toBe(token);
		for (const [name, value] of env) {
			expect(value, name).not.toContain(token);
			if (name !== 'TERMINAY_CONTROL_TOKEN' && runToken !== undefined)
				expect(value, name).not.toContain(runToken);
		}

		const detail = await openAutomation(
			mainWindow,
			'Capture attention context',
		);
		const run = detail.locator('[data-terminay-automation-run]');
		await expect(run).toHaveCount(1);
		await expect(run).toContainText('Triggered');
	},
);

// ---------------------------------------------------------------------------
// b) Agent finished appends to a temp stats file

const finished = seeded((outDir) => [
	{
		id: 'agent-finished-stats',
		name: 'Count finished agents',
		trigger: { kind: 'event', event: 'agent.finished' },
		action: {
			kind: 'runCommand',
			command: `echo "$TERMINAY_EVENT|$TERMINAY_AGENT_PROVIDER|$TERMINAY_AGENT_STATE|$TERMINAY_TERMINAL_TITLE" >> ${path.join(outDir, 'stats.txt')}`,
		},
		cooldownSeconds: 0,
	},
]);

finished(
	'agent finished appends one line to a stats file per finish',
	async ({ mainWindow, outDir }) => {
		const publish = await agentIn(
			mainWindow,
			await activeSessionId(mainWindow),
			'codex-automation-finished',
		);
		const stats = path.join(outDir, 'stats.txt');
		const done = () =>
			publish({
				status: 'idle',
				lastTurn: 'completed',
				lastTurnEndedAt: Date.now(),
			});

		await publish({ status: 'running' });
		await done();
		await expect
			.poll(() => readLines(stats), { timeout: 20_000 })
			.toEqual(['agent.finished|codex|done|Terminal 1']);

		// A repeated report of `done` is not a transition, so nothing is appended.
		await done();
		await mainWindow.waitForTimeout(1_500);
		expect(await readLines(stats)).toHaveLength(1);

		// The next finish appends again.
		await publish({ status: 'running' });
		await done();
		await expect
			.poll(() => readLines(stats), { timeout: 20_000 })
			.toEqual([
				'agent.finished|codex|done|Terminal 1',
				'agent.finished|codex|done|Terminal 1',
			]);
	},
);

// ---------------------------------------------------------------------------
// c) A schedule opens a terminal through MCP that lands in Automations

/** A stub script: one `open_terminal` request on the run terminal's own
 * control socket and capability, exactly as the MCP stdio adapter frames it. */
const OPEN_TERMINAL_SCRIPT = `
import { connect } from 'node:net';
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({
		id: 'open-1',
		token: process.env.TERMINAY_CONTROL_TOKEN,
		version: 1,
		op: 'open_terminal',
		params: { name: process.argv[2] },
	}) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	console.log('open_terminal ' + (response.ok ? 'ok' : JSON.stringify(response.error)));
	process.exitCode = response.ok ? 0 : 1;
	socket.end();
});
socket.on('error', (error) => {
	console.error(error.message);
	process.exit(2);
});
`;

const scheduled = seeded(
	(outDir) => [
		{
			id: 'scheduled-mcp-open',
			name: 'Spawn a worker',
			trigger: { kind: 'schedule', cron: '* * * * *' },
			action: {
				kind: 'runCommand',
				// The test runner's own node: no PATH or network needed.
				command: `'${process.execPath}' ${path.join(outDir, 'open-terminal.mjs')} 'MCP worker'`,
			},
		},
	],
	(outDir) =>
		writeFile(path.join(outDir, 'open-terminal.mjs'), OPEN_TERMINAL_SCRIPT),
);

scheduled(
	'a schedule opens a terminal through MCP that is grouped under its run and outlives it',
	async ({ mainWindow }) => {
		// Waits for one real minute boundary.
		test.setTimeout(150_000);
		const projectTabs = mainWindow.locator('.project-tab');
		const tabsBefore = await projectTabs.count();
		const detail = await openAutomation(mainWindow, 'Spawn a worker');
		const outcome = mainWindow.locator(
			'[data-terminay-automation-run-detail] [data-terminay-automation-outcome]',
		);

		const assertWorkerUnder = async (runId: string) => {
			// The run terminal closed ("keep terminal after run" is off); the
			// terminal the script opened stays, running, under the run — in the
			// run's detail, and in the list's terminals grouped by run.
			const openRun = mainWindow.locator(
				`[data-terminay-automation-run-detail="${runId}"]`,
			);
			if ((await openRun.count()) === 0)
				await mainWindow
					.locator(`[data-terminay-automation-run="${runId}"]`)
					.click();
			const inRun = mainWindow.locator(
				`[data-terminay-automation-run-detail="${runId}"] [data-terminay-automation-terminal]`,
			);
			await expect(inRun).toHaveCount(1);
			await expect(inRun).toContainText('MCP worker');
			await mainWindow.locator('[data-terminay-automations-back]').click();
			const group = mainWindow.locator(
				`[data-terminay-automation-terminal-group="${runId}"]`,
			);
			await expect(group).toContainText('Spawn a worker');
			const terminals = group.locator('[data-terminay-automation-terminal]');
			await expect(terminals).toHaveCount(1);
			await expect(terminals).toContainText('MCP worker');
			await expect(terminals).toContainText('Running');
			await openAutomation(mainWindow, 'Spawn a worker');
		};

		// The schedule fires at the next minute boundary, with no one pressing a
		// button.
		const triggered = detail
			.locator('[data-terminay-automation-run]')
			.filter({ hasText: 'Triggered' })
			.first();
		await expect(triggered).toBeVisible({ timeout: 75_000 });
		await triggered.click();
		await expect(outcome).toHaveAttribute(
			'data-terminay-automation-outcome',
			'succeeded',
			{ timeout: 20_000 },
		);
		await expect(
			mainWindow.locator('[data-terminay-automation-run-tail]'),
		).toContainText('open_terminal ok');
		const triggeredRunId = await triggered.getAttribute(
			'data-terminay-automation-run',
		);
		if (triggeredRunId === null) throw new Error('Triggered run has no id');
		await assertWorkerUnder(triggeredRunId);

		// Run now does the same at once, under its own run.
		await detail.locator('[data-terminay-automation-run-now]').click();
		const runDetail = mainWindow.locator(
			'[data-terminay-automation-run-detail]',
		);
		await expect(runDetail).not.toHaveAttribute(
			'data-terminay-automation-run-detail',
			triggeredRunId,
		);
		await expect(outcome).toHaveAttribute(
			'data-terminay-automation-outcome',
			'succeeded',
			{ timeout: 20_000 },
		);
		const manualRunId = await runDetail.getAttribute(
			'data-terminay-automation-run-detail',
		);
		if (manualRunId === null) throw new Error('Run detail has no run id');
		await assertWorkerUnder(manualRunId);
		await expect(assertWorkerUnder(triggeredRunId)).resolves.toBeUndefined();

		// None of it is a project.
		await expect(projectTabs).toHaveCount(tabsBefore);
	},
);

// ---------------------------------------------------------------------------
// d) Agent needs input writes text to the subject once within the cooldown

const needsInput = seeded((outDir) => [
	{
		id: 'answer-agent',
		name: 'Answer the agent',
		trigger: { kind: 'event', event: 'agent.needsInput' },
		action: {
			kind: 'writeText',
			text: `echo answered >> ${path.join(outDir, 'writes.txt')}`,
			submit: true,
		},
		cooldownSeconds: 60,
	},
]);

needsInput(
	'agent needs input writes text to the subject once within the cooldown',
	async ({ mainWindow, outDir }) => {
		const publish = await agentIn(
			mainWindow,
			await activeSessionId(mainWindow),
			'codex-automation-waiting',
		);
		const writes = path.join(outDir, 'writes.txt');
		await publish({ status: 'running' });
		// Waiting twice in quick succession: the second is inside the cooldown.
		await publish({ status: 'waiting' });
		await publish({ status: 'running' });
		await publish({ status: 'waiting' });

		await expect
			.poll(() => readLines(writes), { timeout: 20_000 })
			.toEqual(['answered']);
		await mainWindow.waitForTimeout(2_000);
		expect(await readLines(writes)).toEqual(['answered']);

		const detail = await openAutomation(mainWindow, 'Answer the agent');
		const run = detail.locator('[data-terminay-automation-run]');
		await expect(run).toHaveCount(1);
		await run.click();
		const runDetail = mainWindow.locator(
			'[data-terminay-automation-run-detail]',
		);
		await expect(
			runDetail.locator('[data-terminay-automation-outcome]'),
		).toHaveAttribute('data-terminay-automation-outcome', 'succeeded');
		await expect(runDetail).toContainText(
			'1 repeated event during the cooldown',
		);
		await expect(runDetail).toContainText('Terminal 1');
	},
);
