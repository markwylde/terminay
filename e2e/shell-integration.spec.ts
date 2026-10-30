import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { folderGroup, folderTerminals } from './support/folders';
import { runShellCommand } from './support/terminal-input';
import {
	activeTerminalPanel,
	createTerminal,
	terminalPanelForSession,
} from './support/terminal-session';
import { setProjectRoot } from './support/ui';

/**
 * Shell integration and terminal command defaults end to end (ADR-0081,
 * ADR-0082). A fake `codex` (e2e/fixtures/fake-codex-bin) is first on the
 * server's PATH; its help lists `--no-daemon`, so the built-in agents
 * extension's command default applies and new zsh and bash terminals define
 * `codex` as a function that adds it. The fake prints the arguments it got.
 */

const WITH_DEFAULT = 'FAKE-CODEX ARGS:[--no-daemon resume --last]';
const WITHOUT_DEFAULT = 'FAKE-CODEX ARGS:[resume --last]';

function terminalText(panel: Locator): Promise<string> {
	return panel.locator('.xterm-rows').innerText();
}

/** Open a terminal, run one command in it, and return its panel. */
async function runInNewTerminal(page: Page, command: string): Promise<Locator> {
	const sessionId = await createTerminal(page);
	await runShellCommand(page, command, sessionId);
	return terminalPanelForSession(page, sessionId);
}

/**
 * Open terminals until one starts after the extension has answered: the
 * answer is never awaited at launch, so the first terminals may predate it.
 */
async function terminalWithDefaults(page: Page): Promise<string> {
	let sessionId = '';
	await expect(async () => {
		sessionId = await createTerminal(page);
		await runShellCommand(page, 'codex resume --last', sessionId);
		const panel = terminalPanelForSession(page, sessionId);
		await expect
			.poll(() => terminalText(panel), { timeout: 5_000 })
			.toContain('FAKE-CODEX ARGS:');
		expect(await terminalText(panel)).toContain(WITH_DEFAULT);
	}).toPass({ timeout: 60_000, intervals: [1_000] });
	return sessionId;
}

test('a bash terminal runs codex with --no-daemon and keeps the user in control', async ({
	mainWindow,
}) => {
	test.setTimeout(120_000);
	const sessionId = await terminalWithDefaults(mainWindow);
	const panel = terminalPanelForSession(mainWindow, sessionId);
	// The default is a shell function, and only for the command it names.
	await runShellCommand(
		mainWindow,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: bash parameter expansion
		'echo kind=$(type -t codex) ns=${TERMINAY_COMMAND_DEFAULTS-unset}',
		sessionId,
	);
	await expect
		.poll(() => terminalText(panel), { timeout: 10_000 })
		.toContain('kind=function ns=unset');
	// `command` bypasses the function, as it would any shell function.
	await runShellCommand(mainWindow, 'command codex resume --last', sessionId);
	await expect
		.poll(() => terminalText(panel), { timeout: 10_000 })
		.toContain(WITHOUT_DEFAULT);
});

test('a zsh terminal runs codex with --no-daemon', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	// The account shell is bash; a zsh profile made the default starts zsh.
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'shell-launch',
	});
	await expect(settingsWindow.locator('.shell-profiles')).toHaveAttribute(
		'aria-busy',
		'false',
	);
	await settingsWindow.getByRole('button', { name: 'New profile' }).click();
	const editor = settingsWindow.getByRole('dialog', {
		name: 'Create shell profile',
	});
	await editor.getByLabel('Name').fill('E2E zsh');
	await editor.getByLabel('Target type').selectOption('executable');
	await editor.getByLabel('Executable').fill('/usr/bin/zsh');
	await editor.getByRole('button', { name: 'Validate and save' }).click();
	await expect(editor).toHaveCount(0);
	await settingsWindow
		.getByLabel('Default shell profile')
		.selectOption({ label: 'E2E zsh' });
	await settingsWindow.close();

	const sessionId = await terminalWithDefaults(mainWindow);
	await runShellCommand(
		mainWindow,
		'print -r -- "kind=$(whence -w codex) shell=$ZSH_NAME"',
		sessionId,
	);
	await expect
		.poll(() => terminalText(terminalPanelForSession(mainWindow, sessionId)), {
			timeout: 10_000,
		})
		.toContain('kind=codex: function shell=zsh');
});

test('turning shell integration off leaves new terminals without the function', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await terminalWithDefaults(mainWindow);
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'shell-integration',
	});
	const toggle = settingsWindow
		.getByLabel('Shell integration')
		.locator('input[type="checkbox"]');
	await expect(toggle).toBeChecked();
	await toggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(toggle).not.toBeChecked();
	await settingsWindow.close();

	const panel = await runInNewTerminal(
		mainWindow,
		'echo kind=$(type -t codex); codex resume --last',
	);
	await expect
		.poll(() => terminalText(panel), { timeout: 15_000 })
		.toContain(WITHOUT_DEFAULT);
	expect(await terminalText(panel)).toContain('kind=file');
});

test("the Codex launcher types codex's default after the executable", async ({
	createWorkspace,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await terminalWithDefaults(mainWindow);
	const workspace = await createWorkspace({ name: 'command-default-launcher' });
	await setProjectRoot(mainWindow, workspace.rootDir);
	const row = folderGroup(mainWindow, 'General').locator(
		'.folders-tree__new-terminal-row',
	);
	const codex = row.getByRole('button', { name: 'Codex', exact: true });
	await expect(codex).toHaveCount(1, { timeout: 30_000 });
	await row.hover();
	const before = await folderTerminals(mainWindow, 'General').count();
	await codex.click();
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(before + 1, {
		timeout: 15_000,
	});
	await expect
		.poll(() => terminalText(activeTerminalPanel(mainWindow)), {
			timeout: 20_000,
		})
		.toContain('FAKE-CODEX ARGS:[--no-daemon]');
});
