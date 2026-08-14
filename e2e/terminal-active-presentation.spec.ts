import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';

test('a completed new-terminal command exposes only its active presentation', async ({
	mainWindow,
}) => {
	await sendAppCommand(mainWindow, 'new-terminal');

	const tabs = mainWindow.locator('.terminal-tab-content');
	await expect(tabs).toHaveCount(2);
	await expect(tabs.filter({ hasText: 'Terminal 2' })).toHaveClass(
		/terminal-tab-content--active/,
	);

	const visiblePanels = mainWindow.locator('.terminal-panel:visible');
	await expect(visiblePanels).toHaveCount(1);
	await expect(visiblePanels).toHaveAttribute(
		'data-terminay-terminal-session-id',
		/.+/,
	);
});

test('a protocol-created terminal launches the configured shell', async ({
	appHarness,
	mainWindow,
}) => {
	const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'shell-launch' });
	await settings.getByRole('button', { name: 'New profile' }).click();
	const editor = settings.getByRole('dialog', { name: 'Create shell profile' });
	await editor.getByLabel('Name').fill('E2E Bash');
	await editor.getByLabel('Executable').fill('/bin/bash');
	await editor.getByLabel('Startup mode').selectOption('non-login');
	await editor.getByRole('button', { name: 'Validate and save' }).click();
	await expect(settings.getByText('E2E Bash saved.')).toBeAttached();
	await settings.getByLabel('Default shell profile').selectOption({ label: 'E2E Bash' });
	await settings.close();

	const activeTerminal = mainWindow.locator('.terminal-panel:visible');
	const previousSessionId = await activeTerminal.getAttribute(
		'data-terminay-terminal-session-id',
	);
	expect(previousSessionId).not.toBeNull();
	await sendAppCommand(mainWindow, 'new-terminal');
	await expect
		.poll(() =>
			activeTerminal.getAttribute('data-terminay-terminal-session-id'),
		)
		.not.toBe(previousSessionId);
	await expect(activeTerminal).toHaveAttribute(
		'data-terminay-terminal-session-id',
		/.+/,
	);
	await expect(activeTerminal).toContainText(/[$#]\s*$/u);
	await activeTerminal.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.insertText('printenv BASH_VERSION');
	await mainWindow.keyboard.press('Enter');
	await expect(
		activeTerminal
			.locator('.xterm-rows > div')
			.filter({ hasText: /^\d+\.\d+(?:\.\d+)?(?:\(\d+\)-release)?$/u }),
	).not.toHaveCount(0);
});
