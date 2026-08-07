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

test('a high-volume terminal burst cannot kill the shared local application connection', async ({
	mainWindow,
}) => {
	test.setTimeout(30_000);
	const sessionId = await activeSessionId(mainWindow);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const rows = panel.locator('.xterm-rows');
	const burstComplete = `terminay-burst-complete-${sessionId}`;
	const inputComplete = `terminay-input-after-burst-${sessionId}`;
	const burstCompleteBase64 = Buffer.from(burstComplete).toString('base64');
	const inputCompleteBase64 = Buffer.from(inputComplete).toString('base64');
	const terminalTabs = mainWindow.locator(
		'.project-workspace--active .terminal-tab-content',
	);
	const initialTerminalCount = await terminalTabs.count();

	// Generate enough real PTY output to cross the presentation budget several
	// times. The server-level regression advances the complete 200 MiB byte
	// range; this Electron test stays fast while exercising the real parser,
	// checkpoint hydration, xterm acknowledgement, and local MessagePort.
	await writeToSession(
		mainWindow,
		sessionId,
		`head -c 1048576 /dev/zero | tr '\\0' x; printf '\\n'; printf '%s' ${JSON.stringify(burstCompleteBase64)} | base64 -d; printf '\\n'\r`,
	);

	await expect
		.poll(async () => (await rows.textContent())?.includes(burstComplete) ?? false, {
			timeout: 20_000,
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
		`printf '%s' ${JSON.stringify(inputCompleteBase64)} | base64 -d; printf '\\n'\r`,
	);
	await expect
		.poll(async () => (await rows.textContent())?.includes(inputComplete) ?? false, {
			timeout: 5_000,
		})
		.toBe(true);

	await mainWindow.getByLabel('New terminal tab').click();
	await expect(terminalTabs).toHaveCount(initialTerminalCount + 1, {
		timeout: 5_000,
	});
	await expect(mainWindow.getByText('Server did not publish a terminal panel')).toHaveCount(0);
});
