import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { createTerminal, settledTerminalSessionId } from './support/terminal-session';

/**
 * A terminal kept across a relaunch whose temporary directory is gone says so,
 * and a new terminal is not affected (ADR-0116).
 *
 * The first launch runs with a TMPDIR of its own, which its session holder and
 * shell inherit. Terminay quits keeping the terminal, that directory is
 * deleted, and Terminay starts again with a working one, as a server restart
 * under systemd's PrivateTmp leaves things. The holder is passed over for new
 * terminals, and the kept terminal shows a notice that blocks nothing.
 */

const READY_TIMEOUT_MS = 20_000;
const MESSAGE =
	"This terminal's temporary directory is no longer usable. New terminals are not affected.";

function holderPids(userDataDir: string): number[] {
	const directory = path.join(userDataDir, 'session-holder');
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.flatMap((name) => {
			try {
				return [(JSON.parse(readFileSync(path.join(directory, name), 'utf8')) as { pid: number }).pid];
			} catch {
				return [];
			}
		});
}

async function quitKeeping(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ checkboxChecked: false, response: 0 });
	});
	const child = electronApp.process();
	const exited = new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
	await electronApp.evaluate(({ app }) => {
		setImmediate(() => app.quit());
	}).catch(() => undefined);
	await exited;
}

async function typeLine(page: Page, sessionId: string, line: string) {
	const panel = page.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
	await panel.locator('.xterm-helper-textarea').focus();
	await page.keyboard.type(line);
	await page.keyboard.press('Enter');
}

test('a kept terminal whose temporary directory is gone says so, and a new terminal works', async ({
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const firstTmp = path.join(tempDir, 'first-launch-tmp');
		await expect.poll(() => holderPids(userDataDir).length, { timeout: 10_000 }).toBe(1);
		const [oldHolder] = holderPids(userDataDir);
		await quitKeeping(electronApp);

		// What systemd does to a private /tmp when the run that made it stops.
		rmSync(firstTmp, { recursive: true, force: true });

		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo, temporaryDirectory: tempDir });
		const window = await prepareWindow(await relaunched.electronApp.firstWindow());
		const kept = window.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
		await expect(kept).toBeVisible({ timeout: READY_TIMEOUT_MS });

		const notice = kept.locator('.error-banner[data-degraded]');
		await expect(notice).toHaveText(MESSAGE, { timeout: READY_TIMEOUT_MS });
		await window.screenshot({ path: testInfo.outputPath('degraded-terminal-notice.png') });

		// It blocks nothing: the shell still takes input, and really has lost
		// its temporary directory.
		await typeLine(window, sessionId, `mkdir "$TMPDIR/probe" 2>/dev/null && echo "TMP""-OK" || echo "TMP""-GONE"`);
		await expect(kept.locator('.xterm-rows')).toContainText('TMP-GONE', { timeout: 10_000 });
		await notice.getByRole('button', { name: 'Dismiss error' }).click();
		await expect(notice).toHaveCount(0);

		// A new terminal goes to a new holder and has a working one.
		const freshId = await createTerminal(window);
		expect(freshId).not.toBe(sessionId);
		const freshPanel = window.locator(`.terminal-panel[data-terminay-terminal-session-id="${freshId}"]`);
		await expect(freshPanel.locator('.error-banner[data-degraded]')).toHaveCount(0);
		await typeLine(window, freshId, `mkdir "$TMPDIR/probe-new" && echo "TMP""-OK" || echo "TMP""-GONE"`);
		await expect(freshPanel.locator('.xterm-rows')).toContainText('TMP-OK', { timeout: 10_000 });
		await expect.poll(() => holderPids(userDataDir).filter((pid) => pid !== oldHolder).length).toBe(1);
		await window.screenshot({ path: testInfo.outputPath('new-terminal-unaffected.png') });
	} finally {
		await relaunched?.close().catch(() => undefined);
		for (const pid of holderPids(userDataDir)) {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {
				/* already gone */
			}
		}
	}
});
