import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Repeated reconnects on one client identity keep streaming.
 *
 * The reported failure was a session that hydrated a terminal checkpoint and
 * then never streamed again. Every reconnect reuses the same authenticated
 * client id, and teardown released state by that id, so a superseded
 * connection's cleanup detached the live replacement's terminal.
 *
 * The precise regression proof is
 * `packages/server-core/test/connection-scoped-lifecycle.test.mjs`, which
 * overlaps two connections on one client id and is verified to fail against
 * the old behaviour. This suite is end-to-end assurance in the real app: a
 * Local transport closes promptly, so it does not reliably reproduce that
 * overlap, but it does prove that repeated reconnects hydrate and then carry
 * live output — the observable symptom — including while a shell is busy.
 */

// A recovered connection rebuilds its bounded application bootstrap
// (handshake plus workspace subscriptions), which permits 15 seconds.
const RECOVERY_TIMEOUT_MS = 20_000;

async function activeSessionId(page: Page): Promise<string> {
	const sessionId = await page
		.locator('.terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');
	if (!sessionId) throw new Error('The active terminal session id is unavailable');
	return sessionId;
}

async function waitForConnected(page: Page): Promise<void> {
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						(window as Window & { __terminayServerClientState?: string })
							.__terminayServerClientState,
				),
			{ timeout: RECOVERY_TIMEOUT_MS },
		)
		.toBe('connected');
}

test('three reconnect cycles each hydrate and then stream live output', async ({
	mainWindow,
}) => {
	test.setTimeout(120_000);
	const sessionId = await activeSessionId(mainWindow);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const rows = panel.locator('.xterm-rows');

	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.type(`printf 'cycle-baseline\\n'`);
	await mainWindow.keyboard.press('Enter');
	await expect(rows).toContainText('cycle-baseline', { timeout: 5_000 });

	for (let cycle = 1; cycle <= 3; cycle += 1) {
		const marker = `cycle-${cycle}-streamed`;

		const failure = await mainWindow.evaluate(async () => {
			if (!window.terminayLocalConnectionFaultTest)
				throw new Error('Local connection fault test seam is unavailable');
			return window.terminayLocalConnectionFaultTest.failActiveConnection();
		});
		expect(failure.connectionId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

		await waitForConnected(mainWindow);

		// The same PTY, not a replacement: reconnecting must never fork a shell.
		await expect(panel).toHaveCount(1);
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute(
			'data-terminay-terminal-session-id',
			sessionId,
		);
		// Hydration restored what the terminal had already rendered.
		await expect(rows).toContainText('cycle-baseline');

		// The part that regressed: output produced *after* hydration must arrive.
		// A painted checkpoint with a dead stream passes every check above.
		await panel.locator('.xterm-helper-textarea').focus();
		await mainWindow.keyboard.type(`printf '${marker}\\n'`);
		await mainWindow.keyboard.press('Enter');
		await expect(rows).toContainText(marker, { timeout: 10_000 });
	}

	// Earlier cycles' output survives every later reconnect.
	for (let cycle = 1; cycle <= 3; cycle += 1) {
		await expect(rows).toContainText(`cycle-${cycle}-streamed`);
	}
});

test('a reconnect keeps streaming while a terminal is producing output', async ({
	mainWindow,
}) => {
	test.setTimeout(90_000);
	const sessionId = await activeSessionId(mainWindow);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const rows = panel.locator('.xterm-rows');

	// A shell that keeps writing while the transport is replaced. Recovery must
	// not wait for the PTY to fall silent, and the replacement attachment must
	// take over a lane whose predecessor was mid-stream.
	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.type(
		`for i in $(seq 1 400); do printf 'busy-%s\\n' "$i"; done`,
	);
	await mainWindow.keyboard.press('Enter');
	await expect(rows).toContainText('busy-', { timeout: 10_000 });

	await mainWindow.evaluate(async () => {
		if (!window.terminayLocalConnectionFaultTest)
			throw new Error('Local connection fault test seam is unavailable');
		return window.terminayLocalConnectionFaultTest.failActiveConnection();
	});
	await waitForConnected(mainWindow);

	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		sessionId,
	);
	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.type(`printf 'after-busy-reconnect\\n'`);
	await mainWindow.keyboard.press('Enter');
	await expect(rows).toContainText('after-busy-reconnect', { timeout: 15_000 });
});
