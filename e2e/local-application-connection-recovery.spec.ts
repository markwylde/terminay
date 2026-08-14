import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function activeSessionId(page: Page): Promise<string> {
	const sessionId = await page
		.locator('.terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');
	if (!sessionId) throw new Error('The active terminal session id is unavailable');
	return sessionId;
}

test('a Local application transport loss recovers without replacing the terminal session', async ({
	mainWindow,
}) => {
	test.setTimeout(30_000);
	const sessionId = await activeSessionId(mainWindow);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const rows = panel.locator('.xterm-rows');
	const beforeMarker = `terminay-before-local-recovery-${sessionId}`;
	const afterMarker = `terminay-after-local-recovery-${sessionId}`;
	const initialTerminalCount = await mainWindow
		.locator('.project-workspace--active .terminal-tab-content')
		.count();

	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.type(`printf '${beforeMarker}\\n'`);
	await mainWindow.keyboard.press('Enter');
	await expect(rows).toContainText(beforeMarker, { timeout: 5_000 });

	const failure = await mainWindow.evaluate(async () => {
		if (!window.terminayLocalConnectionFaultTest)
			throw new Error('Local connection fault test seam is unavailable');
		return window.terminayLocalConnectionFaultTest.failActiveConnection();
	});
	expect(failure.connectionId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
	await expect(
		mainWindow.getByRole('dialog', { name: 'Connect to Remote Server' }),
	).toHaveCount(0);

	await expect
		.poll(
			() =>
				mainWindow.evaluate(
					() =>
						(
							window as Window & { __terminayServerClientState?: string }
						).__terminayServerClientState,
				),
			{ timeout: 5_000 },
		)
		.toBe('connected');
	await expect(panel).toHaveCount(1);
	await expect(panel).toBeVisible();
	await expect(rows).toContainText(beforeMarker);
	await expect(panel).toHaveAttribute('data-terminay-terminal-session-id', sessionId);

	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.type(`printf '${afterMarker}\\n'`);
	await mainWindow.keyboard.press('Enter');
	await expect(rows).toContainText(afterMarker, { timeout: 5_000 });

	await mainWindow.getByLabel('New terminal tab').click();
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(initialTerminalCount + 1, { timeout: 5_000 });
	await expect(mainWindow.getByText('Server did not publish a terminal panel')).toHaveCount(0);
});
