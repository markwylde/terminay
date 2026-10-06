import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { settledTerminalSessionId } from './support/terminal-session';

// A recovered Desktop connection rebuilds its bounded application bootstrap
// (handshake plus workspace subscriptions). That bootstrap permits 15 seconds,
// so a five-second E2E assertion races a healthy but busy CI runner.
const LOCAL_RECOVERY_TIMEOUT_MS = 20_000;

async function activeSessionId(page: Page): Promise<string> {
	return await settledTerminalSessionId(page.locator('.terminal-panel:visible'));
}

test('a Local application transport loss recovers without replacing the terminal session', async ({
	mainWindow,
}) => {
	test.setTimeout(45_000);
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
			{ timeout: LOCAL_RECOVERY_TIMEOUT_MS },
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

test('a Local connection the server closes is noticed by the window without waiting for a heartbeat', async ({
	mainWindow,
}) => {
	test.setTimeout(45_000);
	await activeSessionId(mainWindow);
	// The window's heartbeat probes every 10 seconds and needs two misses, so
	// anything it reports arrives 10-20 seconds after the close. A close the
	// window observes on its endpoint arrives within a turn of the event loop.
	const NOTICED_WITHOUT_HEARTBEAT_MS = 5_000;

	await mainWindow.evaluate(() => {
		const target = window as Window & {
			__terminayServerClientState?: string;
			__terminayServerClientStates?: { state: string; at: number }[];
		};
		let current = target.__terminayServerClientState;
		const seen: { state: string; at: number }[] = [];
		target.__terminayServerClientStates = seen;
		Object.defineProperty(target, '__terminayServerClientState', {
			configurable: true,
			get: () => current,
			set: (state: string) => {
				current = state;
				seen.push({ state, at: performance.now() });
			},
		});
	});

	const closedAt = await mainWindow.evaluate(async () => {
		if (!window.terminayLocalConnectionFaultTest)
			throw new Error('Local connection fault test seam is unavailable');
		const at = performance.now();
		const closed =
			await window.terminayLocalConnectionFaultTest.closeServerConnection();
		if (closed < 1) throw new Error('the server had no connection to close');
		return at;
	});

	const firstLossAfterMs = async () =>
		await mainWindow.evaluate((since) => {
			const seen =
				(
					window as Window & {
						__terminayServerClientStates?: { state: string; at: number }[];
					}
				).__terminayServerClientStates ?? [];
			const loss = seen.find((entry) => entry.state !== 'connected');
			return loss === undefined ? null : loss.at - since;
		}, closedAt);
	await expect
		.poll(firstLossAfterMs, { timeout: 30_000 })
		.not.toBeNull();
	expect(await firstLossAfterMs()).toBeLessThan(NOTICED_WITHOUT_HEARTBEAT_MS);

	await expect
		.poll(
			() =>
				mainWindow.evaluate(
					() =>
						(
							window as Window & { __terminayServerClientState?: string }
						).__terminayServerClientState,
				),
			{ timeout: LOCAL_RECOVERY_TIMEOUT_MS },
		)
		.toBe('connected');
});
