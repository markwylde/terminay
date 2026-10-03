import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * Quitting Terminay and opening it again brings back the same terminals.
 *
 * The shells are held by a detached session holder (ADR-0035), so this drives
 * the real application through a real quit and a real relaunch on the same
 * data directory, and then through a quit that ends the terminals instead.
 */

const READY_TIMEOUT_MS = 20_000;

interface HolderRecord {
	readonly pid: number;
	readonly generation: string;
}

function holderRecords(userDataDir: string): HolderRecord[] {
	const directory = path.join(userDataDir, 'session-holder');
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.flatMap((name) => {
			try {
				return [
					JSON.parse(
						readFileSync(path.join(directory, name), 'utf8'),
					) as HolderRecord,
				];
			} catch {
				return [];
			}
		});
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Answer the quit confirmation with one of its buttons, then quit. */
async function quitChoosing(
	electronApp: ElectronApplication,
	button: 'keep' | 'end',
): Promise<void> {
	await electronApp.evaluate(({ dialog }, response) => {
		dialog.showMessageBox = async () => ({ checkboxChecked: false, response });
	}, button === 'keep' ? 0 : 1);
	const child = electronApp.process();
	const exited = new Promise<void>((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
	// Ask the application to quit the way the Quit menu item does. Playwright's
	// own close() tears the windows down first, which is not a user quit.
	await electronApp
		.evaluate(({ app }) => {
			setImmediate(() => app.quit());
		})
		.catch(() => undefined);
	const outcome = await Promise.race([
		exited.then(() => 'exited' as const),
		new Promise<'timeout'>((resolve) =>
			setTimeout(() => resolve('timeout'), 30_000),
		),
	]);
	if (outcome === 'timeout')
		throw new Error(`Terminay did not quit after choosing "${button}"`);
}

async function waitUntilGone(pid: number, label: string): Promise<void> {
	await expect
		.poll(() => isAlive(pid), { timeout: 15_000, message: label })
		.toBe(false);
}

async function typeLine(page: Page, sessionId: string, line: string) {
	const panel = page.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	await panel.locator('.xterm-helper-textarea').focus();
	await page.keyboard.type(line);
	await page.keyboard.press('Enter');
}

test('quitting and relaunching brings back the same terminal, its output, and its running process', async ({
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
	try {
		const sessionId = await settledTerminalSessionId(
			mainWindow.locator('.terminal-panel:visible'),
		);
		const rows = mainWindow
			.locator(
				`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
			)
			.locator('.xterm-rows');

		await typeLine(mainWindow, sessionId, `printf 'before-%s\\n' restart`);
		await expect(rows).toContainText('before-restart', { timeout: 10_000 });

		// Work that outlives the application: it prints only after Terminay has
		// quit, and then keeps a foreground process running.
		await typeLine(
			mainWindow,
			sessionId,
			`sh -c 'sleep 4; printf "while-%s\\n" away; sleep 600'`,
		);
		await mainWindow.waitForTimeout(1_000);

		// The shell lives in the holder, not in the application.
		await expect
			.poll(() => holderRecords(userDataDir).length, { timeout: 10_000 })
			.toBe(1);
		const [holder] = holderRecords(userDataDir);
		expect(holder.pid).not.toBe(electronApp.process().pid);

		await quitChoosing(electronApp, 'keep');
		expect(isAlive(holder.pid), 'the holder ended with the application').toBe(
			true,
		);

		// Long enough for the command to print with nothing attached.
		await new Promise((resolve) => setTimeout(resolve, 5_000));

		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const window = await prepareWindow(await relaunched.electronApp.firstWindow());
		await expect(window.locator('.project-tabbar')).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});

		// The same terminal, and only that terminal.
		const restoredPanel = window.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		);
		await expect(restoredPanel).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(window.locator('.terminal-tab-content')).toHaveCount(1);
		expect(holderRecords(userDataDir).map((record) => record.pid)).toEqual([
			holder.pid,
		]);

		// Its output from before the quit, and what it printed while Terminay
		// was closed.
		const restoredRows = restoredPanel.locator('.xterm-rows');
		await expect(restoredRows).toContainText('before-restart', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(restoredRows).toContainText('while-away', {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(
			restoredPanel.locator('.terminal-panel-connection-error'),
		).toHaveCount(0);

		// The same process is still in the foreground, and the shell answers
		// once it is interrupted.
		await restoredPanel.locator('.xterm-helper-textarea').focus();
		await window.keyboard.press('Control+C');
		await typeLine(window, sessionId, `printf 'after-%s\\n' restart`);
		await expect(restoredRows).toContainText('after-restart', {
			timeout: 10_000,
		});

		// Quitting with work running and choosing to end the terminals leaves
		// nothing behind.
		await typeLine(window, sessionId, 'sleep 600');
		await window.waitForTimeout(2_500);
		await quitChoosing(relaunched.electronApp, 'end');
		await expect
			.poll(() => isAlive(holder.pid), { timeout: 15_000 })
			.toBe(false);
		expect(holderRecords(userDataDir)).toEqual([]);
	} finally {
		await relaunched?.close().catch(() => undefined);
		// Whatever a failed assertion left running must not outlive the test.
		for (const record of holderRecords(userDataDir)) {
			try {
				process.kill(record.pid, 'SIGKILL');
			} catch {
				/* already gone */
			}
		}
	}
});

test('a terminal that ended while Terminay was closed comes back with its last output and a notice', async ({
	electronApp,
	mainWindow,
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
	try {
		const sessionId = await settledTerminalSessionId(
			mainWindow.locator('.terminal-panel:visible'),
		);
		const rows = mainWindow
			.locator(
				`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
			)
			.locator('.xterm-rows');
		await typeLine(mainWindow, sessionId, `printf 'last-%s\\n' words`);
		await expect(rows).toContainText('last-words', { timeout: 10_000 });

		await expect
			.poll(() => holderRecords(userDataDir).length, { timeout: 10_000 })
			.toBe(1);
		const [holder] = holderRecords(userDataDir);

		// Nothing is running, so quitting keeps the terminal without asking.
		await quitChoosing(electronApp, 'keep');
		expect(isAlive(holder.pid)).toBe(true);

		// The session then ends while Terminay is closed: the holder is told to
		// stop, as it is at logout or when its limit passes. It saves what the
		// terminal last showed and exits.
		process.kill(holder.pid, 'SIGTERM');
		await waitUntilGone(holder.pid, 'the session holder to exit');

		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const window = await prepareWindow(await relaunched.electronApp.firstWindow());
		await expect(window.locator('.project-tabbar')).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});

		// The tab is still there, in place, and no replacement was started.
		const panel = window.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		);
		await expect(panel).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(window.locator('.terminal-tab-content')).toHaveCount(1);
		expect(holderRecords(userDataDir)).toEqual([]);

		// It shows what the terminal last showed, under the notice.
		await expect(panel.locator('.xterm-rows')).toContainText('last-words', {
			timeout: READY_TIMEOUT_MS,
		});
		const notice = panel.locator('.terminal-panel-connection-error');
		await expect(notice).toBeVisible();
		await expect(notice).toContainText(
			"This session has ended and can't be resumed.",
		);
		await expect(notice.locator('button')).toHaveCount(0);

		// Typing into it goes nowhere.
		await panel.locator('.xterm-helper-textarea').focus();
		await window.keyboard.type('typed-after-end');
		await window.waitForTimeout(500);
		await expect(panel.locator('.xterm-rows')).not.toContainText(
			'typed-after-end',
		);
	} finally {
		await relaunched?.close().catch(() => undefined);
		for (const record of holderRecords(userDataDir)) {
			try {
				process.kill(record.pid, 'SIGKILL');
			} catch {
				/* already gone */
			}
		}
	}
});
