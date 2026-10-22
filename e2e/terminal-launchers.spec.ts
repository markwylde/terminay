import { execSync } from 'node:child_process';
import { expect, test } from './fixtures';
import { folderGroup, folderTerminals } from './support/folders';
import { submitTerminalCommand } from './support/terminal';
import { activeTerminalPanel } from './support/terminal-session';
import { setProjectRoot } from './support/ui';

/**
 * Terminal launchers end to end (ADR-0073). The built-in agents extension's
 * Claude Code launcher finds a fake `claude` (e2e/fixtures/fake-claude-chat.mjs)
 * through TERMINAY_CLAUDE_CODE_COMMAND; no `codex` is installed in the
 * container, so Codex is not offered. Choosing the launcher creates a terminal
 * in the folder whose shell runs the fake by its path, with no arguments.
 */

/** Every running copy of the fake, as its full command line. */
function fakeClaudeCommandLines(): string[] {
	try {
		return execSync('ps -eo args')
			.toString()
			.split('\n')
			.filter((line) => line.includes('fake-claude-chat.mjs'));
	} catch {
		return [];
	}
}

test("a folder's New terminal row starts an installed agent bare, offers only installed agents, and keeps the shell when the agent quits", async ({
	createWorkspace,
	mainWindow,
}) => {
	test.setTimeout(90_000);
	const workspace = await createWorkspace({ name: 'terminal-launchers' });
	await setProjectRoot(mainWindow, workspace.rootDir);

	const general = folderGroup(mainWindow, 'General');
	const row = general.locator('.folders-tree__new-terminal-row');
	const claude = row.getByRole('button', { name: 'Claude Code', exact: true });
	// The built-in agents extension can start after the window does.
	await expect(claude).toHaveCount(1, { timeout: 30_000 });
	await row.hover();
	await expect
		.poll(() =>
			row
				.locator('.folders-tree__launchers')
				.evaluate((element) => getComputedStyle(element).opacity),
		)
		.toBe('1');
	await expect(claude).toHaveAttribute('title', 'New Claude Code terminal');
	await expect(row.getByRole('button', { name: 'Shell', exact: true })).toHaveCount(1);
	await expect(row.getByRole('button', { name: 'Codex', exact: true })).toHaveCount(0);

	const before = await folderTerminals(mainWindow, 'General').count();
	await claude.click();
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(before + 1, {
		timeout: 15_000,
	});
	await expect(
		folderTerminals(mainWindow, 'General').last().locator('.folders-tree__name'),
	).toHaveText('Claude Code');

	// The fake answers with its init line, and it was started with no arguments.
	const panel = activeTerminalPanel(mainWindow);
	await expect
		.poll(() => panel.locator('.xterm-rows').innerText(), { timeout: 20_000 })
		.toContain('"subtype":"init"');
	const running = fakeClaudeCommandLines();
	expect(running.length).toBeGreaterThan(0);
	for (const line of running)
		expect(line.trim().endsWith('fake-claude-chat.mjs')).toBe(true);

	// Ending the agent's input ends the agent; the shell stays.
	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.press('Control+D');
	await expect.poll(() => fakeClaudeCommandLines().length, { timeout: 15_000 }).toBe(0);
	// The shell computes the answer, so seeing it is not just the echo of typing.
	await submitTerminalCommand(mainWindow, 'echo launcher-shell-$((40 + 2))', panel);
	await expect
		.poll(() => panel.locator('.xterm-rows').innerText(), { timeout: 15_000 })
		.toContain('launcher-shell-42');
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(before + 1);
});
