import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';
import { contextMenuItem } from './support/ui';
import { createStartedProject } from './support/project-start';
import { waitUntilBusy } from './support/busy-terminals';
import { afterRendererTasks, nextAnimationFrame } from './support/renderer-clock';

const execFileAsync = promisify(execFile);


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

		// Work that outlives the application: it prints only once the test
		// opens its gate, after Terminay has quit, says when it has, and then
		// keeps a foreground process running.
		const gate = path.join(tempDir, 'while-away.fifo');
		const printed = path.join(tempDir, 'while-away.printed');
		await execFileAsync('mkfifo', [gate]);
		await typeLine(
			mainWindow,
			sessionId,
			`sh -c 'cat ${gate} >/dev/null; printf "while-%s\\n" away; : > ${printed}; sleep 600'`,
		);
		await waitUntilBusy(electronApp, mainWindow);

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

		// The command prints with nothing attached. Opening the FIFO for writing
		// waits for the command to open it.
		await writeFile(gate, '\n');
		await expect.poll(() => existsSync(printed)).toBe(true);

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
		await waitUntilBusy(relaunched.electronApp, window);
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

test('a terminal moved to another project is still in that project, and still running, after a relaunch', async ({
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
		const movedPanel = (page: Page) =>
			page.locator(
				`.project-workspace--active .terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
			);
		const projectTab = (page: Page, title: string) =>
			page.locator('.project-tab').filter({ hasText: new RegExp(`^${title}$`) });
		await typeLine(
			mainWindow,
			sessionId,
			'while :; do date +TICK_%s; sleep 1; done',
		);
		await expect(movedPanel(mainWindow).locator('.xterm-rows')).toContainText(
			/TICK_\d+/,
			{ timeout: 10_000 },
		);

		await createStartedProject(mainWindow);
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Project 2',
		);
		await projectTab(mainWindow, 'Project').click();
		await mainWindow
			.locator('.project-workspace--active .terminal-tab-content')
			.first()
			.click({ button: 'right' });
		await contextMenuItem(mainWindow, 'Move to project').click();
		await contextMenuItem(mainWindow, 'Project 2').click();
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Project 2',
		);
		await expect(movedPanel(mainWindow)).toBeVisible();

		await expect
			.poll(() => holderRecords(userDataDir).length, { timeout: 10_000 })
			.toBe(1);
		await quitChoosing(electronApp, 'keep');

		relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const window = await prepareWindow(await relaunched.electronApp.firstWindow());
		await expect(window.locator('.project-tabbar')).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});

		// The project it was moved to, not the one it was started in.
		await projectTab(window, 'Project 2').click();
		await expect(movedPanel(window)).toBeVisible({ timeout: READY_TIMEOUT_MS });
		const rows = movedPanel(window).locator('.xterm-rows');
		const lastTick = async () =>
			((await rows.textContent()) ?? '').match(/TICK_\d+/gu)?.at(-1) ?? null;
		await expect.poll(lastTick, { timeout: READY_TIMEOUT_MS }).not.toBeNull();
		const before = await lastTick();
		await expect.poll(lastTick, { timeout: 15_000 }).not.toBe(before);
		await expect(
			movedPanel(window).locator('.terminal-panel-connection-error'),
		).toHaveCount(0);

		await projectTab(window, 'Project').click();
		await expect(window.locator('.project-tab--active')).toContainText(
			'Project',
		);
		await expect(movedPanel(window)).toHaveCount(0);

		await quitChoosing(relaunched.electronApp, 'end');
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
		// The keys have been handled, and the terminal has drawn since.
		await afterRendererTasks(window);
		await nextAnimationFrame(window);
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

// A TUI enables its input modes once, then emits enough redraws that its
// startup bytes leave the holder's 1 MiB raw replay window. Recovering that
// process must preserve capture, rather than turn subsequent wheel gestures
// into ordinary terminal scrollback while the TUI keeps drawing.
for (const frames of [1, 80]) {
	test(`TUI retains mouse capture after held-session recovery (${frames === 1 ? 'startup retained' : 'startup evicted'})`, async ({
		electronApp,
		mainWindow,
		tempDir,
		userDataDir,
	}, testInfo) => {
		test.setTimeout(120_000);
		let relaunched: Awaited<ReturnType<typeof launchDesktopApp>> | undefined;
		const sessionId = await settledTerminalSessionId(
			mainWindow.locator('.terminal-panel:visible'),
		);
		const panelFor = (page: Page) =>
			page.locator(
				`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
			);
		const program = `
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.write('\\x1b[?1049h\\x1b[?1007l\\x1b[?1000h\\x1b[?1002h\\x1b[?1003h\\x1b[?1006h\\x1b[?2004h\\x1b[?1004h');
let pending='',wheels=0,keys=0,mode=0;
function draw(){process.stdout.write('\\x1b[H\\x1b[2Jtui-'+ 'ready wheels='+wheels+' keys='+keys+' pid='+process.pid+' mode='+mode+'\\r\\n');}
let frames=0;const timer=setInterval(()=>{
 process.stdout.write(('redraw-content-'.repeat(64)+'\\r\\n').repeat(32));
 if(++frames===${frames}){clearInterval(timer);draw();process.stdout.write('\\x1b[?1003$p');}
},10);
process.stdin.on('data',chunk=>{
 pending+=chunk.toString();
 while(pending.length){
  if(pending[0]==='\\x03'){process.stdout.write('\\x1b[?1003l\\x1b[?1002l\\x1b[?1000l\\x1b[?1006l\\x1b[?1004l\\x1b[?2004l\\x1b[?1049l');process.exit(0);}
  const mouse=/^\\x1b\\[<(\\d+);\\d+;\\d+[Mm]/.exec(pending);
  if(mouse){if(Number(mouse[1])===64||Number(mouse[1])===65)wheels++;pending=pending.slice(mouse[0].length);draw();continue;}
  const modeReport=/^\\x1b\\[\\?1003;(\\d)\\$y/.exec(pending);
  if(modeReport){mode=Number(modeReport[1]);pending=pending.slice(modeReport[0].length);draw();continue;}
  const focus=/^\\x1b\\[[IO]/.exec(pending);
  if(focus){pending=pending.slice(focus[0].length);continue;}
  if(pending[0]==='\\x1b')break;
  pending=pending.slice(1);keys++;draw();process.stdout.write('\\x1b[?1003$p');
 }
});`;
		const command = `node -e '${program.replaceAll("'", `'"'"'`)}'`;
		try {
			const initial = panelFor(mainWindow);
			await submitTerminalCommand(mainWindow, command, initial);
			await expect(initial).toContainText('tui-ready wheels=0 keys=0', {
				timeout: 20_000,
			});
			await expect(initial).toContainText('mode=1');
			const originalPid = /pid=(\d+)/.exec(await initial.innerText())?.[1];
			expect(originalPid).toBeTruthy();
			const box = await initial.locator('.xterm-screen').boundingBox();
			if (!box) throw new Error('Terminal screen unavailable');
			await mainWindow.mouse.move(
				box.x + box.width / 2,
				box.y + box.height / 2,
			);
			await mainWindow.mouse.wheel(0, -100);
			await expect(initial).toContainText('tui-ready wheels=1 keys=0');
			await expect.poll(() => holderRecords(userDataDir).length).toBe(1);
			const [holder] = holderRecords(userDataDir);
			await quitChoosing(electronApp, 'keep');
			expect(isAlive(holder.pid)).toBe(true);
			relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
			const window = await prepareWindow(
				await relaunched.electronApp.firstWindow(),
			);
			const restored = panelFor(window);
			await expect(restored).toBeVisible({ timeout: 20_000 });
			await expect(restored).toContainText('tui-ready wheels=1 keys=0', {
				timeout: 20_000,
			});
			await expect(restored).toContainText(`pid=${originalPid}`);
			// A normal key proves the same live process is still accepting input
			// and redrawing. No setup sequence is emitted by this response.
			await restored.locator('.xterm-helper-textarea').focus();
			await window.keyboard.type('x');
			await expect(restored).toContainText('tui-ready wheels=1 keys=1');
			const restoredBox = await restored.locator('.xterm-screen').boundingBox();
			if (!restoredBox) throw new Error('Restored terminal screen unavailable');
			await window.mouse.move(
				restoredBox.x + restoredBox.width / 2,
				restoredBox.y + restoredBox.height / 2,
			);
			const beforeWheel = await restored.locator('.xterm-rows').innerText();
			await window.mouse.wheel(0, -100);
			try {
				await expect(restored).toContainText('tui-ready wheels=2 keys=1');
			} finally {
				await testInfo.attach('mouse-capture-recovery-evidence', {
					contentType: 'application/json',
					body: JSON.stringify(
						{
							frames,
							originalPid,
							beforeWheel,
							afterWheel: await restored.locator('.xterm-rows').innerText(),
						},
						null,
						2,
					),
				});
			}
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
}
