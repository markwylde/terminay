import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * A session holder left running after Terminay ends must never stop the next
 * launch from opening a window (ADR-0035). Reported from Linux (WSLg): with an
 * orphaned holder alive, every launch exited at once with no window.
 */

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

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** What the holder has open that Chromium's single-instance lock owns. */
function inheritedSingleton(pid: number, userDataDir: string): string[] {
	const lockSocket = (() => {
		try {
			return readlinkSync(path.join(userDataDir, 'SingletonSocket'));
		} catch {
			return undefined;
		}
	})();
	const unix = readFileSync('/proc/net/unix', 'utf8').split('\n').slice(1);
	const socketPaths = new Map<string, string>();
	for (const line of unix) {
		const fields = line.trim().split(/\s+/u);
		if (fields.length >= 8) socketPaths.set(fields[6], fields[7]);
	}
	const found: string[] = [];
	for (const fd of readdirSync(`/proc/${pid}/fd`)) {
		let target: string;
		try {
			target = readlinkSync(`/proc/${pid}/fd/${fd}`);
		} catch {
			continue;
		}
		const inode = /^socket:\[(\d+)\]$/u.exec(target)?.[1];
		const named = inode === undefined ? target : socketPaths.get(inode) ?? target;
		if (/Singleton|chromium/iu.test(named) || (lockSocket !== undefined && named === lockSocket))
			found.push(`fd ${fd} -> ${named}`);
	}
	return found;
}

async function keepOnQuit(app: ElectronApplication): Promise<void> {
	await app.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({ checkboxChecked: false, response: 0 });
	});
}

function exited(app: ElectronApplication): Promise<void> {
	const child = app.process();
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once('exit', () => resolve());
	});
}

const ENDINGS = {
	quit: async (app: ElectronApplication) => {
		await keepOnQuit(app);
		const gone = exited(app);
		await app.evaluate(({ app: electron }) => void setImmediate(() => electron.quit())).catch(() => undefined);
		await gone;
	},
	'window closed': async (app: ElectronApplication) => {
		await keepOnQuit(app);
		const gone = exited(app);
		await app
			.evaluate(({ BrowserWindow }) => {
				setImmediate(() => {
					for (const window of BrowserWindow.getAllWindows()) window.close();
				});
			})
			.catch(() => undefined);
		await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 15_000))]);
		if (app.process().exitCode === null && app.process().signalCode === null) {
			app.process().kill('SIGKILL');
			await gone;
		}
	},
	killed: async (app: ElectronApplication) => {
		const gone = exited(app);
		app.process().kill('SIGKILL');
		await gone;
	},
} as const;

for (const [ending, end] of Object.entries(ENDINGS)) {
	test(`after Terminay is ${ending} with a holder still running, the next launch opens a window`, async ({ electronApp, mainWindow, tempDir, userDataDir }, testInfo) => {
		test.setTimeout(120_000);
		await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		await expect.poll(() => holderPids(userDataDir).length, { timeout: 10_000 }).toBe(1);
		const [holder] = holderPids(userDataDir);
		const inheritedBefore = inheritedSingleton(holder, userDataDir);
		await end(electronApp);
		expect(isAlive(holder), 'the holder must outlive the app').toBe(true);
		const inherited = inheritedSingleton(holder, userDataDir);
		testInfo.annotations.push({ type: 'holder-singleton-fds', description: JSON.stringify({ inheritedBefore, inherited }) });
		console.log(`[holder-relaunch] ${ending}: holder ${holder} singleton fds before=${JSON.stringify(inheritedBefore)} after=${JSON.stringify(inherited)}`);

		const relaunched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		try {
			const child = relaunched.electronApp.process();
			const outcome = await Promise.race([
				relaunched.electronApp.firstWindow({ timeout: 30_000 }).then(() => 'window' as const),
				exited(relaunched.electronApp).then(() => `exited ${child.exitCode ?? child.signalCode}` as const),
			]);
			expect(outcome, `relaunch with holder ${holder} alive`).toBe('window');
			expect(inherited, 'the holder holds part of the app single-instance lock').toEqual([]);
		} finally {
			await relaunched.close().catch(() => undefined);
			for (const pid of holderPids(userDataDir)) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
		}
	});
}

test('a second launch on the same data directory says why it exits', async ({ electronApp, mainWindow, tempDir, userDataDir }, testInfo) => {
	test.setTimeout(60_000);
	await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
	await expect.poll(() => holderPids(userDataDir).length, { timeout: 10_000 }).toBe(1);
	const first = electronApp.process().pid;
	const second = await launchDesktopApp({ tempDir, userDataDir, testInfo }).catch((error: unknown) => error);
	// Playwright may fail to attach to a process that exits at once; either way
	// the first instance keeps running and the second says why it left.
	if (!(second instanceof Error)) {
		const child = second.electronApp.process();
		let stderr = '';
		child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
		await exited(second.electronApp);
		expect(child.exitCode).toBe(1);
		expect(stderr).toMatch(new RegExp(`Another Terminay is already running with .*\\(process ${first} on `, 'u'));
	} else {
		expect(String(second)).toMatch(/Another Terminay is already running/u);
	}
	expect(isAlive(first!)).toBe(true);
	await ENDINGS.killed(electronApp);
	for (const pid of holderPids(userDataDir)) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
});
