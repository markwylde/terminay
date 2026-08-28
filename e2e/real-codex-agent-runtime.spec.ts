import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { openTerminalEditWindow, selectSidebarGroup, submitEditWindow } from './support/ui';

test.skip(
	process.env.TERMINAY_REAL_CODEX_E2E !== '1',
	'requires an explicitly provisioned real Codex CLI and authenticated CODEX_HOME',
);

test('a real authenticated Codex CLI appears in the Agents pane', async ({
	mainWindow,
}, testInfo) => {
	test.setTimeout(180_000);
	// Provide the first turn as an initial CLI argument. In an Electron test
	// PTY, typing a second long line after Codex switches screen modes can race
	// its exit and leak the tail of the text to the shell instead of the TUI.
	// The disposable test container keeps its writer live long enough to prove
	// the binding; this command neither reads nor changes files or the network.
	await typeInVisibleTerminal(
		mainWindow,
		'codex "Use collaboration tools to spawn exactly three subagents concurrently. Give one subagent each of these tasks: calculate 17 times 19, calculate the sum of integers 1 through 100, and calculate 2 to the power 12. Do not read, create, or modify files, and do not access the network. Each subagent must wait 45 seconds after calculating before replying. Remain active and wait for all three subagents before producing your own response."\n',
	);
	const terminal = mainWindow.locator('.terminal-panel:visible');
	await expect.poll(async () => await terminal.textContent(), {
		timeout: 30_000,
	}).toMatch(/Press enter to continue|Working|subagent|collaboration/u);
	if ((await terminal.textContent())?.includes('Press enter to continue')) {
		await typeInVisibleTerminal(mainWindow, '\n');
	}
	await selectSidebarGroup(mainWindow, 'agents');
	const root = mainWindow.locator('.agents-sidebar__tree-item');
	await expect(root).toBeVisible({ timeout: 60_000 });
	await expect(root.locator('.agents-sidebar__metadata')).toContainText('Codex');
	const tabSettings = await openTerminalEditWindow(mainWindow);
	await tabSettings.getByPlaceholder('Terminal name').fill('Three Math Subagents');
	await submitEditWindow(tabSettings);
	await expect(root.locator('.agents-sidebar__name')).toContainText(
		'Three Math Subagents',
		{ timeout: 30_000 },
	);
	const expand = mainWindow.getByRole('button', {
		name: 'Expand 3 subagents for Three Math Subagents',
	});
	await expect(expand).toBeVisible({ timeout: 90_000 });
	await expand.click();
	await mainWindow.screenshot({ path: testInfo.outputPath('real-codex-agent-runtime.png') });
});
