import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function activeSessionId(page: Page): Promise<string> {
	const sessionId = await page
		.locator('.terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');
	if (!sessionId) throw new Error('The active terminal session id is unavailable');
	return sessionId;
}

async function writeToSession(page: Page, sessionId: string, data: string): Promise<void> {
	await page.evaluate(
		async ({ id, input }) => {
			await window.terminayTest!.writeServerTerminal(id, input);
		},
		{ id: sessionId, input: data },
	);
}

test('a 200 MiB terminal burst cannot kill the shared local application connection', async ({
	mainWindow,
}) => {
	test.setTimeout(180_000);
	const sessionId = await activeSessionId(mainWindow);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const rows = panel.locator('.xterm-rows');
	const burstComplete = `terminay-burst-complete-${sessionId}`;
	const inputComplete = `terminay-input-after-burst-${sessionId}`;
	const terminalTabs = mainWindow.locator(
		'.project-workspace--active .terminal-tab-content',
	);
	const initialTerminalCount = await terminalTabs.count();

	// This is deliberately in the range observed from a large `codex resume`.
	// Generate it inside the PTY so the renderer-to-host test bridge does not
	// itself carry or allocate the payload.
	await writeToSession(
		mainWindow,
		sessionId,
		`head -c 209715200 /dev/zero | tr '\\0' x; printf '\\n%s\\n' ${JSON.stringify(burstComplete)}\r`,
	);

	await expect
		.poll(async () => (await rows.textContent())?.includes(burstComplete) ?? false, {
			timeout: 120_000,
		})
		.toBe(true);
	await expect
		.poll(() =>
			mainWindow.evaluate(
				() =>
					(
						window as Window & {
							__terminayServerClientState?: string;
						}
					).__terminayServerClientState,
			),
		)
		.toBe('connected');

	await writeToSession(
		mainWindow,
		sessionId,
		`printf '%s\\n' ${JSON.stringify(inputComplete)}\r`,
	);
	await expect
		.poll(async () => (await rows.textContent())?.includes(inputComplete) ?? false, {
			timeout: 15_000,
		})
		.toBe(true);

	await mainWindow.getByLabel('New terminal tab').click();
	await expect(terminalTabs).toHaveCount(initialTerminalCount + 1, {
		timeout: 15_000,
	});
	await expect(mainWindow.getByText('Server did not publish a terminal panel')).toHaveCount(0);
});
