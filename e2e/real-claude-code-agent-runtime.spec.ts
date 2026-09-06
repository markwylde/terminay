import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { selectSidebarGroup } from './support/ui';

test.skip(
	process.env.TERMINAY_REAL_CLAUDE_CODE_E2E !== '1',
	'requires an explicitly provisioned, authenticated real Claude Code CLI',
);

/**
 * The original defect: a normally launched `claude` never appeared in the
 * Agents pane. This drives the real CLI inside the real desktop app and
 * captures the three indicator states a user watches for: amber while a turn
 * runs, green when it stops, red while a permission prompt sits unanswered.
 * Claude Code writes nothing while a prompt is open, so red is inferred from
 * silence inside an open turn and takes the provider's quiet window to appear.
 */
test('a real Claude Code session shows working, done and waiting in the app', async ({
	mainWindow,
}, testInfo) => {
	test.setTimeout(8 * 60_000);
	const terminal = mainWindow.locator('.terminal-panel:visible');
	const tab = mainWindow.locator('.terminal-tab-content').first();
	const indicator = (state: string) =>
		tab.locator(`.agent-status-indicator[data-agent-state="${state}"]`);

	// The first turn is a launch argument so the CLI's screen-mode switch
	// cannot race typed input. `sleep` is pre-allowed for the working step;
	// every other tool call still prompts in default mode.
	// The disposable test temp directory keeps the approved write out of the
	// developer's home. It is new to Claude, so the folder-trust menu appears.
	await typeInVisibleTerminal(
		mainWindow,
		// When this test is itself driven from inside a Claude Code session the
		// child-session marker leaks through the app and turns transcript saving
		// off, leaving nothing to bind. Clear it so the CLI journals as normal.
		'unset CLAUDE_CODE_CHILD_SESSION; cd "$TMPDIR" && claude --permission-mode default "Reply with the single word ready, then stop." --allowedTools "Bash(sleep:*)"\n',
	);
	await expect
		.poll(async () => await terminal.textContent(), { timeout: 60_000 })
		.toMatch(/Yes, I trust this folder/u);
	// The menu is keypress-driven: choose the second option, then confirm.
	await mainWindow.waitForTimeout(500);
	await mainWindow.keyboard.press('ArrowDown');
	await mainWindow.waitForTimeout(500);
	await mainWindow.keyboard.press('Enter');

	await selectSidebarGroup(mainWindow, 'agents');
	const root = mainWindow.locator('.agents-sidebar__tree-item');
	await expect(root).toBeVisible({ timeout: 90_000 });
	await expect(root.locator('.agents-sidebar__metadata')).toContainText('Claude Code');

	// Green: the launch turn completes.
	await expect(indicator('done')).toBeVisible({ timeout: 90_000 });
	await mainWindow.screenshot({ path: testInfo.outputPath('claude-code-done.png') });

	// Amber: a turn that takes a few seconds of real work.
	await typeInVisibleTerminal(
		mainWindow,
		'Run exactly one shell command, `sleep 8`, then reply with the single word slept. Do nothing else.\n',
	);
	await expect(indicator('working')).toBeVisible({ timeout: 30_000 });
	await mainWindow.screenshot({ path: testInfo.outputPath('claude-code-working.png') });
	await expect(indicator('done')).toBeVisible({ timeout: 90_000 });

	// Red: a write needs approval and nobody answers. Claude Code records
	// nothing while the prompt is open, so the wait is inferred from silence.
	await typeInVisibleTerminal(
		mainWindow,
		'Create an empty file named needs-approval.txt in the current directory using the Bash tool (touch). Do nothing else.\n',
	);
	await expect(indicator('waiting')).toBeVisible({ timeout: 4 * 60_000 });
	await mainWindow.screenshot({ path: testInfo.outputPath('claude-code-waiting.png') });

	// Answering the prompt returns the session to green.
	await mainWindow.keyboard.press('Enter');
	await expect(indicator('done')).toBeVisible({ timeout: 90_000 });
	await typeInVisibleTerminal(mainWindow, '/exit\n');
	await expect(root).toHaveCount(0, { timeout: 60_000 });

	await typeInVisibleTerminal(mainWindow, 'claude --resume\n');
	await mainWindow.waitForTimeout(800);
	await mainWindow.keyboard.press('Enter');
	await expect(root).toBeVisible({ timeout: 90_000 });
	await expect(root.locator('.agents-sidebar__metadata')).toContainText('Claude Code');
	await expect(indicator('done')).toBeVisible({ timeout: 90_000 });
	await typeInVisibleTerminal(
		mainWindow,
		'Reply with the single word resumed, then stop.\n',
	);
	await expect(indicator('working')).toBeVisible({ timeout: 30_000 });
	await expect(indicator('done')).toBeVisible({ timeout: 90_000 });
	await expect(mainWindow.locator('.agents-sidebar__tree-item')).toHaveCount(1);
});
