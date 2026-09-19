import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createClaudeFixtureDriver } from '@markwylde/all-your-agents/testing';
import type { Page } from '@playwright/test';
import { agentFixtureClaudeHome, expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { typeInVisibleTerminal } from './support/terminal-input';
import { settledTerminalSessionId } from './support/terminal-session';
import { selectSidebarGroup, setProjectRoot } from './support/ui';

const execFileAsync = promisify(execFile);

// Claude Code keys its live index by UUID session ids.
const freshId = '11111111-1111-4111-8111-111111111111';
const resumedId = '22222222-2222-4222-8222-222222222222';
const subdirectoryId = '33333333-3333-4333-8333-333333333333';
const worktreeId = '44444444-4444-4444-8444-444444444444';
const unrelatedId = '55555555-5555-4555-8555-555555555555';

async function activeSessionId(page: Page): Promise<string> {
	return await settledTerminalSessionId(
		page.locator('.project-workspace--active .terminal-panel:visible').first(),
	);
}

async function newTerminal(page: Page): Promise<string> {
	const previous = await activeSessionId(page);
	await sendAppCommand(page, 'new-terminal');
	let created = previous;
	await expect
		.poll(async () => {
			created = await activeSessionId(page);
			return created;
		})
		.not.toBe(previous);
	return created;
}

/**
 * Start a real long-lived process inside the focused terminal and return its
 * pid and start time. The process is a descendant of the terminal's PTY, so
 * binding it to that terminal is decided by the operating system's process
 * tree, not by a claim in a fixture.
 */
async function runAgentProcessInTerminal(
	page: Page,
	pidFile: string,
): Promise<{ pid: number; startedAt: number }> {
	await typeInVisibleTerminal(
		page,
		`sh -c 'echo $$ > ${pidFile}; exec sleep 600'\n`,
	);
	let pid = 0;
	await expect
		.poll(async () => {
			pid = Number((await readFile(pidFile, 'utf8').catch(() => '')).trim());
			return pid;
		})
		.toBeGreaterThan(0);
	return { pid, startedAt: Date.now() };
}

/** A real process Terminay did not start: an agent in another terminal app. */
function runExternalAgentProcess(processes: ChildProcess[]): {
	pid: number;
	startedAt: number;
} {
	const child = spawn('sleep', ['600'], { stdio: 'ignore' });
	processes.push(child);
	if (child.pid === undefined)
		throw new Error('external process did not start');
	return { pid: child.pid, startedAt: Date.now() };
}

/** Claude's project-directory encoding: every non-alphanumeric becomes '-'. */
function claudeProjectDirectory(home: string, cwd: string): string {
	return path.join(home, 'projects', cwd.replace(/[^A-Za-z0-9]/gu, '-'));
}

test('the built-in agents extension scopes live Claude Code sessions to the project and its worktrees', async ({
	mainWindow,
	tempDir,
	createWorkspace,
}) => {
	const processes: ChildProcess[] = [];
	try {
		const workspace = await createWorkspace({
			name: 'agents-project',
			seed: { directories: ['src'] },
		});
		const projectRoot = await realpath(workspace.rootDir);
		const worktree = path.join(
			await realpath(tempDir),
			'agents-linked-worktree',
		);
		const unrelated = path.join(await realpath(tempDir), 'agents-unrelated');
		await mkdir(unrelated, { recursive: true });
		const git = (...args: string[]) =>
			execFileAsync('git', args, { cwd: projectRoot });
		await git('init', '-q');
		await git(
			'-c',
			'user.email=e2e@terminay.test',
			'-c',
			'user.name=E2E',
			'commit',
			'-q',
			'--allow-empty',
			'-m',
			'root',
		);
		await git('worktree', 'add', '-q', '-b', 'agents-worktree', worktree);
		await setProjectRoot(mainWindow, projectRoot);

		const home = agentFixtureClaudeHome(tempDir);
		await selectSidebarGroup(mainWindow, 'agents');
		const rows = mainWindow.locator('.agents-sidebar__tree-item');
		const row = (title: string) => rows.filter({ hasText: title });

		// Terminal 1: a fresh session, bound to the terminal whose PTY owns it.
		const firstTerminal = await activeSessionId(mainWindow);
		const fresh = await runAgentProcessInTerminal(
			mainWindow,
			path.join(tempDir, 'fresh.pid'),
		);
		await createClaudeFixtureDriver(home, fresh.startedAt).createLiveSession({
			id: freshId,
			pid: fresh.pid,
			cwd: projectRoot,
			status: 'busy',
			title: 'Fresh terminal agent',
		});
		await expect(row('Fresh terminal agent')).toBeVisible({ timeout: 15_000 });
		await expect(row('Fresh terminal agent')).not.toHaveAttribute(
			'data-agent-external',
			'true',
		);
		await expect(
			row('Fresh terminal agent').locator(
				'.agent-status-indicator[data-agent-state="working"]',
			),
		).toBeVisible();

		// Terminal 2: the same harness resumes an earlier conversation. Its
		// journal already exists, so the library opens rather than creates it.
		const secondTerminal = await newTerminal(mainWindow);
		expect(secondTerminal).not.toBe(firstTerminal);
		const journalDirectory = claudeProjectDirectory(home, projectRoot);
		await mkdir(journalDirectory, { recursive: true });
		await writeFile(
			path.join(journalDirectory, `${resumedId}.jsonl`),
			`${JSON.stringify({ type: 'user', sessionId: resumedId, cwd: projectRoot, message: { content: 'earlier work' } })}\n`,
		);
		const resumed = await runAgentProcessInTerminal(
			mainWindow,
			path.join(tempDir, 'resumed.pid'),
		);
		await createClaudeFixtureDriver(home, resumed.startedAt).createLiveSession({
			id: resumedId,
			pid: resumed.pid,
			cwd: projectRoot,
			status: 'idle',
			title: 'Resumed terminal agent',
		});
		await expect(row('Resumed terminal agent')).toBeVisible({
			timeout: 15_000,
		});
		await expect(row('Fresh terminal agent')).toBeVisible();

		// Clicking a bound row focuses the terminal that owns the agent.
		await row('Fresh terminal agent')
			.locator('.agents-sidebar__row')
			.first()
			.click();
		await expect.poll(() => activeSessionId(mainWindow)).toBe(firstTerminal);

		// Outside Terminay: a subdirectory of the project and a linked worktree
		// outside the root both belong to the project and read External.
		const subdirectory = runExternalAgentProcess(processes);
		await createClaudeFixtureDriver(
			home,
			subdirectory.startedAt,
		).createLiveSession({
			id: subdirectoryId,
			pid: subdirectory.pid,
			cwd: path.join(projectRoot, 'src'),
			status: 'waiting',
			title: 'Subdirectory external agent',
		});
		const linked = runExternalAgentProcess(processes);
		await createClaudeFixtureDriver(home, linked.startedAt).createLiveSession({
			id: worktreeId,
			pid: linked.pid,
			cwd: worktree,
			status: 'busy',
			title: 'Worktree external agent',
		});
		// An agent in an unrelated directory is never this project's.
		const stranger = runExternalAgentProcess(processes);
		await createClaudeFixtureDriver(home, stranger.startedAt).createLiveSession(
			{
				id: unrelatedId,
				pid: stranger.pid,
				cwd: unrelated,
				status: 'busy',
				title: 'Unrelated external agent',
			},
		);

		for (const title of [
			'Subdirectory external agent',
			'Worktree external agent',
		]) {
			await expect(row(title)).toBeVisible({ timeout: 15_000 });
			await expect(row(title).locator('.agents-sidebar__external')).toHaveText(
				'External',
			);
		}
		// External rows are inert: clicking one leaves the focused terminal alone.
		await row('Worktree external agent')
			.locator('.agents-sidebar__row')
			.first()
			.click({ force: true });
		await expect.poll(() => activeSessionId(mainWindow)).toBe(firstTerminal);
		await expect(row('Unrelated external agent')).toHaveCount(0);
		await expect(rows).toHaveCount(4);

		// When the external process exits, its row goes with it.
		processes[1]?.kill('SIGKILL');
		await expect(row('Worktree external agent')).toHaveCount(0, {
			timeout: 15_000,
		});
		await expect(rows).toHaveCount(3);
	} finally {
		for (const child of processes) child.kill('SIGKILL');
	}
});
