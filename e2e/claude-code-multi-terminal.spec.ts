import { mkdir, realpath, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { claudeProjectDirectoryPath } from '../extensions/agent-claude-code/src/resume';
import {
	expect,
	nativeClaudeEarlierSessionId,
	nativeClaudeHome,
	nativeClaudeProject,
	nativeClaudeVersion,
	test,
} from './fixtures';
import { sendAppCommand } from './support/app';
import { typeInVisibleTerminal } from './support/terminal-input';
import { selectSidebarGroup } from './support/ui';

/**
 * Two Claude Code terminals in one project directory, driven in the running
 * application against a stub CLI that writes what the real CLI writes: the
 * pid-keyed record under `~/.claude/sessions` and the journal that record
 * names. The project already holds an earlier, quit session, so every process
 * under test starts in a directory whose provider store holds a journal it did
 * not write and that is older than it — the condition under which a provider
 * that guesses a journal from file times binds the wrong session.
 *
 * The second terminal resumes that earlier session while the first is mid-turn
 * — the state the defect was reported from, where the other terminal showed
 * "working" as the new one bound — so the first terminal's journal is the one
 * receiving appends while the second looks for its own.
 *
 * It resumes through the CLI's picker — `claude --resume` with no id, which is
 * the form the defect was reported under. A resumed process appends to a journal created
 * before it, so a rule keyed on creation finds nothing for it and a rule keyed
 * on appends moves every terminal onto whichever session typed last. The id is
 * absent from the command line, so nothing but the process's own session record
 * can say which session it holds.
 */

/** Long enough that the first terminal is still mid-turn when the second binds. */
const longTurnMs = 40_000;
const earlierTitle = 'Earlier Claude session';
const freshTitle = 'Fresh Claude session';
const clearedTitle = 'Cleared Claude session';

/**
 * Writes a complete, quit session into the project's provider store before any
 * process the run launches exists, and back-dates it so no file-time rule can
 * mistake it for a journal one of those processes wrote.
 */
async function seedEarlierSession(tempDir: string): Promise<string> {
	const project = await realpath(nativeClaudeProject(tempDir));
	const relativePath = claudeProjectDirectoryPath(project);
	if (!relativePath)
		throw new Error(`No Claude project directory encodes ${project}`);
	const directory = path.join(nativeClaudeHome(tempDir), relativePath);
	await mkdir(directory, { recursive: true });
	const record = (value: Record<string, unknown>): string =>
		`${JSON.stringify({ sessionId: nativeClaudeEarlierSessionId, ...value })}\n`;
	const journal = path.join(directory, `${nativeClaudeEarlierSessionId}.jsonl`);
	await writeFile(
		journal,
		[
			record({
				type: 'mode',
				mode: 'default',
				version: nativeClaudeVersion,
				cwd: project,
			}),
			record({ type: 'last-prompt', lastPrompt: 'Earlier prompt' }),
			record({ type: 'ai-title', aiTitle: earlierTitle }),
			record({
				type: 'user',
				promptId: 'earlier-turn-1',
				message: { role: 'user', content: 'Earlier prompt' },
			}),
			record({ type: 'system', subtype: 'turn_duration', durationMs: 1_200 }),
		].join(''),
		{ mode: 0o600 },
	);
	const anHourAgo = new Date(Date.now() - 3_600_000);
	await utimes(journal, anHourAgo, anHourAgo);
	return project;
}

async function awaitTerminalOutput(page: Page, pattern: RegExp): Promise<void> {
	await expect
		.poll(
			async () =>
				await page
					.locator(
						'.project-workspace--active .terminal-panel:visible .xterm-rows',
					)
					.textContent(),
			{ timeout: 30_000 },
		)
		.toMatch(pattern);
}

test('two Claude Code terminals in one project each hold their own row, including a resumed session', async ({
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	const project = await seedEarlierSession(tempDir);
	const rows = mainWindow.locator(
		'.project-workspace--active .agents-sidebar__tree-item',
	);
	// The row's metadata carries the terminal it belongs to, so each assertion
	// names a terminal rather than depending on sidebar ordering.
	const rowFor = (terminal: string) =>
		rows.filter({
			has: mainWindow.locator('.agents-sidebar__metadata', {
				hasText: terminal,
			}),
		});

	await typeInVisibleTerminal(
		mainWindow,
		`cd ${project} && CLAUDE_E2E_LABEL='${freshTitle}' CLAUDE_E2E_CLEAR_LABEL='${clearedTitle}' CLAUDE_E2E_TURN_MS=${longTurnMs} claude\n`,
	);
	await awaitTerminalOutput(mainWindow, /Claude e2e ready/u);

	await selectSidebarGroup(mainWindow, 'agents');
	await expect(rows).toHaveCount(1, { timeout: 30_000 });
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__name'),
	).toHaveText(freshTitle, { timeout: 30_000 });
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__row'),
	).toHaveAttribute('data-agent-state', 'idle');

	// A long turn in the first terminal, left running. This is the state the
	// defect was reported from: the other terminal was mid-turn when the new one
	// bound, so the first terminal's journal is the one still being appended to
	// while the second terminal starts and looks for its own.
	await typeInVisibleTerminal(mainWindow, 'first prompt\n');
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__row'),
	).toHaveAttribute('data-agent-state', 'working', { timeout: 30_000 });

	await sendAppCommand(mainWindow, 'new-terminal');
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(2);
	// The reported gesture, in its exact shape: `ps` showed the affected process
	// as `claude --resume` with no id, because the CLI opened its session picker
	// and the user chose there. The stub's picker choice is the earlier session.
	await typeInVisibleTerminal(
		mainWindow,
		`cd ${project} && CLAUDE_E2E_SESSION=${nativeClaudeEarlierSessionId} claude --resume\n`,
	);
	await awaitTerminalOutput(mainWindow, /Claude e2e resumed/u);

	await selectSidebarGroup(mainWindow, 'agents');
	await expect(rows).toHaveCount(2, { timeout: 30_000 });
	// The resumed terminal is bound to the session it was asked to resume.
	await expect(
		rowFor('Terminal 2').locator('.agents-sidebar__name'),
	).toHaveText(earlierTitle, { timeout: 30_000 });
	// The resumed session was quit after one turn, so its row is done. The live
	// terminal is still mid-turn, and its binding did not move.
	await expect(
		rowFor('Terminal 2').locator('.agents-sidebar__row'),
	).toHaveAttribute('data-agent-state', 'done');
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__name'),
	).toHaveText(freshTitle);
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__row'),
	).toHaveAttribute('data-agent-state', 'working');
	// Neither session is shown twice: two terminals, two distinct sessions.
	await expect(rows.filter({ hasText: earlierTitle })).toHaveCount(1);
	await expect(rows.filter({ hasText: freshTitle })).toHaveCount(1);

	// The first terminal's turn completes on its own session, not the resumed
	// one, and the resumed row does not move with it.
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__row'),
	).toHaveAttribute('data-agent-state', 'done', {
		timeout: longTurnMs + 30_000,
	});
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__name'),
	).toHaveText(freshTitle);
	await expect(
		rowFor('Terminal 2').locator('.agents-sidebar__name'),
	).toHaveText(earlierTitle);

	// Quitting one terminal leaves the other bound, on its own session.
	await typeInVisibleTerminal(mainWindow, 'quit\n');
	await expect(rows).toHaveCount(1, { timeout: 30_000 });
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__name'),
	).toHaveText(freshTitle);

	// `/clear` mints a new session inside the first terminal's process, which
	// records it by rewriting its own `sessions/<pid>.json`. The row follows the
	// session that process now reports.
	await mainWindow
		.locator('.project-workspace--active .terminal-tab-content')
		.filter({ hasText: 'Terminal 1' })
		.click();
	await typeInVisibleTerminal(mainWindow, '/clear\n');
	await awaitTerminalOutput(mainWindow, /Claude e2e cleared/u);
	await expect(
		rowFor('Terminal 1').locator('.agents-sidebar__name'),
	).toHaveText(clearedTitle, { timeout: 30_000 });
	await expect(rows).toHaveCount(1);
});
