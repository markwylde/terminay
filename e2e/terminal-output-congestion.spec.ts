import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';

async function activeSessionId(page: Page): Promise<string> {
	const sessionId = await page
		.locator('.terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');
	if (!sessionId) throw new Error('The active terminal session id is unavailable');
	return sessionId;
}

async function writeToSession(page: Page, sessionId: string, data: string): Promise<void> {
	const panel = page.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	await submitTerminalCommand(page, data, panel);
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

test('sustained terminal output keeps checkpoint recovery moving without waiting for silence', async ({ mainWindow }) => {
	// The workload deliberately includes twenty seconds of sleeps plus 1,000
	// short-lived producer processes. Keep its completion observation separate
	// from that nominal floor so a busy Docker host does not turn scheduling
	// latency into a false checkpoint-recovery failure.
	test.setTimeout(75_000);
	const sessionId = await activeSessionId(mainWindow);
	const panel = mainWindow.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
	const rows = panel.locator('.xterm-rows');
	const progress = `terminay-live-progress-${sessionId}`;
	const complete = `terminay-live-complete-${sessionId}`;
	const progressBase64 = Buffer.from(progress).toString('base64');
	const completeBase64 = Buffer.from(complete).toString('base64');
	const sustainedIterations = 500;

	// There is deliberately no 100 ms quiet window before the repeatedly
	// visible progress marker, so sampling cannot mistake scrollback for a stall.
	await writeToSession(mainWindow, sessionId, `i=0; while [ "$i" -lt ${sustainedIterations} ]; do head -c 8192 /dev/zero | tr '\\0' x; i=$((i+1)); if [ "$i" -ge 100 ] && [ "$i" -le 400 ]; then printf '\\n'; printf '%s' ${JSON.stringify(progressBase64)} | base64 -d; printf '\\n'; fi; sleep 0.04; done; printf '\\n'; printf '%s' ${JSON.stringify(completeBase64)} | base64 -d; printf '\\n'\r`);

	await expect.poll(async () => (await rows.textContent())?.includes(progress) ?? false, { timeout: 20_000 }).toBe(true);
	await expect(panel.getByText('Loading terminal…')).toHaveCount(0, { timeout: 10_000 });
	await expect.poll(async () => (await rows.textContent())?.includes(complete) ?? false, { timeout: 45_000 }).toBe(true);
});
