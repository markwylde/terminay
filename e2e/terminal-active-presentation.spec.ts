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
	mainWindow,
}) => {
	await mainWindow.evaluate(async () => {
		const host = window.terminayTerminalSettingsCompatibilityHost;
		const settings = await host.getTerminalSettings();
		await host.updateTerminalSettings({
			...settings,
			shell: {
				...settings.shell,
				program: '/bin/bash',
				startupMode: 'non-login',
				extraArgs: '',
			},
		});
	});

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
