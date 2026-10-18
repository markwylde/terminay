import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	holdRendererClock,
	releaseRendererClock,
} from './support/renderer-clock';
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
	// The window's heartbeat probes on a timer and needs two misses before it
	// reports a loss. The window's clock is held across the close below, so
	// no heartbeat can come due: a loss the window reports while it is held
	// came from the close it observed on its endpoint, however long the runner
	// takes to deliver it.
	const heartbeatLosses: string[] = [];
	mainWindow.on('console', (message) => {
		if (message.text().includes('connection-heartbeat-lost'))
			heartbeatLosses.push(message.text());
	});

	// The sidebar's panes query the server on their own schedule, which is
	// what makes them the callers most likely to be caught mid-request.
	const sidebar = mainWindow.locator('.file-explorer-sidebar');
	if (!(await sidebar.isVisible()))
		await mainWindow.getByLabel('Toggle file explorer').click();
	await expect(sidebar.locator('.sidebar-pane').first()).toBeVisible();

	// The window now learns of the close while requests are still being made,
	// so every caller has to treat a lost connection as an outcome, not throw
	// it into the void.
	await mainWindow.evaluate(() => {
		const rejections: string[] = [];
		(
			window as Window & { __terminayUnhandledRejections?: string[] }
		).__terminayUnhandledRejections = rejections;
		window.addEventListener('unhandledrejection', (event) => {
			const reason = event.reason as {
				name?: string;
				message?: string;
				operation?: string;
				stack?: string;
			} | null;
			rejections.push(
				`${reason?.name ?? typeof reason}: ${reason?.message ?? String(reason)} [${reason?.operation ?? 'no operation'}]\n${reason?.stack ?? ''}`,
			);
		});
	});
	await mainWindow.evaluate(() => {
		const target = window as Window & {
			__terminayServerClientState?: string;
			__terminayServerClientStates?: string[];
		};
		let current = target.__terminayServerClientState;
		const seen: string[] = [];
		target.__terminayServerClientStates = seen;
		Object.defineProperty(target, '__terminayServerClientState', {
			configurable: true,
			get: () => current,
			set: (state: string) => {
				current = state;
				seen.push(state);
			},
		});
	});

	// A heartbeat timer armed before the clock was installed may still run
	// once on real time; it can miss only once, and every timer it arms after
	// that is on the held clock.
	await holdRendererClock(mainWindow);
	await mainWindow.evaluate(async () => {
		if (!window.terminayLocalConnectionFaultTest)
			throw new Error('Local connection fault test seam is unavailable');
		const closed =
			await window.terminayLocalConnectionFaultTest.closeServerConnection();
		if (closed < 1) throw new Error('the server had no connection to close');
	});

	await expect
		.poll(
			() =>
				mainWindow.evaluate(() =>
					(
						(
							window as Window & { __terminayServerClientStates?: string[] }
						).__terminayServerClientStates ?? []
					).some((state) => state !== 'connected'),
				),
			{ timeout: 30_000 },
		)
		.toBe(true);
	expect(heartbeatLosses).toEqual([]);
	await releaseRendererClock(mainWindow);

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
	expect(
		await mainWindow.evaluate(
			() =>
				(window as Window & { __terminayUnhandledRejections?: string[] })
					.__terminayUnhandledRejections ?? [],
		),
	).toEqual([]);
});
