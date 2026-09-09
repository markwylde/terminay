import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * A reconnect after the shell has outrun the retained replay window.
 *
 * The reported failure: a phone came back from the background to a live
 * workspace whose terminal showed "Terminal presentation is unavailable because
 * a complete safe recovery boundary is no longer retained", with no Retry. The
 * panel had asked to resume from the position it last rendered; the shell had
 * printed more than the server keeps while the phone was away; the server —
 * correctly — refused to invent a screen. The client then stopped.
 *
 * The fixture gives this spec a 16 KiB replay window (an E2E-only override,
 * inert in production) so a sustained flood outruns it during the sub-second
 * gap a Local transport loss leaves. The refusal must be routed into the same
 * bounded recovery a congestion skip uses and end on a hydrated, streaming
 * display of the same terminal session — not on that error.
 */

const RECOVERY_TIMEOUT_MS = 30_000;

type RefusalDiagnostic = Readonly<{
	kind: string;
	attach?: string;
	requestedFromPosition?: number;
	replayFrom?: number;
	outputPosition?: number;
}>;

async function recordRendererDiagnostics(page: Page): Promise<void> {
	await page.evaluate(() => {
		const sink = globalThis as unknown as {
			__terminayRendererDiagnostic?: unknown;
			__terminayRendererDiagnosticLog?: unknown[];
		};
		sink.__terminayRendererDiagnosticLog = [];
		sink.__terminayRendererDiagnostic = (diagnostic: unknown) => {
			sink.__terminayRendererDiagnosticLog?.push(diagnostic);
			if ((sink.__terminayRendererDiagnosticLog?.length ?? 0) > 4_000)
				sink.__terminayRendererDiagnosticLog?.shift();
		};
	});
}

async function refusalDiagnostics(page: Page): Promise<RefusalDiagnostic[]> {
	return await page.evaluate(() => {
		const sink = globalThis as unknown as {
			__terminayRendererDiagnosticLog?: RefusalDiagnostic[];
		};
		return (sink.__terminayRendererDiagnosticLog ?? []).filter(
			(entry) => entry.kind === 'terminal-presentation-refused',
		);
	});
}

test('a terminal whose rendered position left the replay window recovers to a fresh presentation', async ({
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await recordRendererDiagnostics(mainWindow);
	const sessionId = await settledTerminalSessionId(
		mainWindow.locator('.terminal-panel:visible'),
	);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const rows = panel.locator('.xterm-rows');

	await submitTerminalCommand(mainWindow, `printf 'replay-window-baseline\\n'`, panel);
	await expect(rows).toContainText('replay-window-baseline', { timeout: 5_000 });

	// A sustained flood: 8 KiB every 40ms, so any gap at all outruns a 16 KiB
	// window and the position this display rendered is no longer retained.
	await submitTerminalCommand(
		mainWindow,
		`while :; do head -c 8192 /dev/zero | tr '\\0' x; printf '\\n'; sleep 0.04; done`,
		panel,
	);
	await expect(rows).toContainText('xxxxxxxx', { timeout: 10_000 });

	const failure = await mainWindow.evaluate(async () => {
		if (!window.terminayLocalConnectionFaultTest)
			throw new Error('Local connection fault test seam is unavailable');
		return window.terminayLocalConnectionFaultTest.failActiveConnection();
	});
	expect(failure.connectionId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

	await expect
		.poll(
			() =>
				mainWindow.evaluate(
					() =>
						(window as Window & { __terminayServerClientState?: string })
							.__terminayServerClientState,
				),
			{ timeout: RECOVERY_TIMEOUT_MS },
		)
		.toBe('connected');

	// The server refused the resume — the reported situation — and the panel
	// treated it as a discontinuity rather than a dead end.
	await expect
		.poll(() => refusalDiagnostics(mainWindow), { timeout: RECOVERY_TIMEOUT_MS })
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'terminal-presentation-refused',
					attach: 'resume',
				}),
			]),
		);
	const refusal = (await refusalDiagnostics(mainWindow))[0]!;
	expect(refusal.requestedFromPosition).toBeLessThan(refusal.replayFrom ?? 0);

	// The same terminal session, one panel, hydrated, and not on the error.
	await expect(panel).toHaveCount(1);
	await expect(panel).toBeVisible();
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		sessionId,
	);
	await expect(panel.locator('.terminal-panel-connection-error')).toHaveCount(
		0,
		{ timeout: RECOVERY_TIMEOUT_MS },
	);
	await expect(mainWindow.getByText('safe recovery boundary')).toHaveCount(0);
	await expect(panel.locator('.terminal-panel-loading')).toHaveCount(0, {
		timeout: RECOVERY_TIMEOUT_MS,
	});

	// Live output after the fresh presentation: stop the flood and print again.
	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.press('Control+C');
	await submitTerminalCommand(
		mainWindow,
		`printf 'replay-window-recovered\\n'`,
		panel,
	);
	await expect(rows).toContainText('replay-window-recovered', {
		timeout: 15_000,
	});
});
