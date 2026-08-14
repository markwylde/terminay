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

	await sendAppCommand(mainWindow, 'new-terminal');
	const terminal = mainWindow.locator('.terminal-panel:visible');
	const sessionId = await terminal.getAttribute(
		'data-terminay-terminal-session-id',
	);
	expect(sessionId).not.toBeNull();

	await mainWindow.evaluate(async (id) => {
		await window.terminayTest!.writeServerTerminal(
			id!,
			`printf '__TERMINAY_BASH__:%s\\n' "\${BASH_VERSION:-missing}"\r`,
		);
	}, sessionId);
	await expect(terminal).toContainText(/__TERMINAY_BASH__:\d/u);
});
