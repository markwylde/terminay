import { createHash } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { runShellCommand } from './support/terminal-input';

/**
 * Desktop starts with its data directory at a path too long to hold a Unix
 * socket (ADR-0054). The control socket goes in a runtime directory named for
 * the data directory, the address is the same after a relaunch, and a runtime
 * directory that is not the user's own is refused with a reason.
 */

const READY_TIMEOUT_MS = 30_000;
/** The limit every local socket is held to. */
const MAX_SOCKET_PATH_BYTES = 103;

type Launched = Awaited<ReturnType<typeof launchDesktopApp>>;

/**
 * A data directory whose control socket cannot fit, and a short directory for
 * the application's temporary files. The harness normally nests the second
 * inside the first, which would make every candidate too long.
 */
async function longDataDirectory(): Promise<{
	root: string;
	tempDir: string;
	userDataDir: string;
}> {
	const root = await mkdtemp(path.join(os.tmpdir(), 'tcs-'));
	const userDataDir = path.join(root, 'd'.repeat(120));
	const tempDir = path.join(root, 't');
	await mkdir(userDataDir, { recursive: true });
	await mkdir(tempDir);
	expect(
		Buffer.byteLength(path.join(userDataDir, 'terminay-mcp-control.sock')),
	).toBeGreaterThan(MAX_SOCKET_PATH_BYTES);
	return { root, tempDir, userDataDir };
}

/** The runtime directory Desktop derives for a data directory. */
function runtimeDirectoryFor(userDataDir: string, tempDir: string): string {
	const runtime = process.env.XDG_RUNTIME_DIR;
	const base = runtime && path.isAbsolute(runtime) ? runtime : tempDir;
	const name = createHash('sha256')
		.update(path.resolve(userDataDir))
		.digest('hex')
		.slice(0, 12);
	return path.join(base, `terminay-${name}`);
}

async function openWorkspace(launched: Launched): Promise<Page> {
	const page = await prepareWindow(await launched.electronApp.firstWindow());
	await expect(page.locator('.project-tabbar')).toBeVisible({
		timeout: READY_TIMEOUT_MS,
	});
	await expect(page.locator('.terminal-tab-content')).toHaveCount(1, {
		timeout: READY_TIMEOUT_MS,
	});
	return page;
}

/** The control socket address the terminal on screen was launched with. */
async function controlSocketOf(page: Page, file: string): Promise<string> {
	await runShellCommand(
		page,
		`printf %s "$TERMINAY_CONTROL_SOCKET" > "${file}"`,
	);
	await expect
		.poll(async () => await readFile(file, 'utf8').catch(() => ''), {
			timeout: 15_000,
		})
		.not.toBe('');
	return await readFile(file, 'utf8');
}

const modeOf = async (target: string) => (await lstat(target)).mode & 0o777;

async function launch(
	directories: { tempDir: string; userDataDir: string },
	testInfo: TestInfo,
): Promise<Launched> {
	return await launchDesktopApp({ ...directories, testInfo });
}

test('a data directory too deep for a socket still opens, with the control socket in an owner-only runtime directory that is the same after a relaunch', async () => {
	const testInfo = test.info();
	test.setTimeout(180_000);
	const directories = await longDataDirectory();
	const { root, tempDir, userDataDir } = directories;
	const expectedDirectory = runtimeDirectoryFor(userDataDir, tempDir);
	let launched: Launched | undefined;
	try {
		launched = await launch(directories, testInfo);
		const first = await controlSocketOf(
			await openWorkspace(launched),
			path.join(root, 'socket-1'),
		);
		expect(first).toBe(path.join(expectedDirectory, 'control.sock'));
		expect(first.startsWith(userDataDir)).toBe(false);
		expect(Buffer.byteLength(first)).toBeLessThanOrEqual(MAX_SOCKET_PATH_BYTES);
		expect((await lstat(first)).isSocket()).toBe(true);
		expect(await modeOf(first)).toBe(0o600);
		expect(await modeOf(expectedDirectory)).toBe(0o700);
		// Nothing was left where the socket could not go.
		await expect(
			lstat(path.join(userDataDir, 'terminay-mcp-control.sock')),
		).rejects.toThrow();

		await launched.close();
		launched = undefined;

		// The same data directory, opened again: the address a terminal was
		// given before the relaunch is still the one the endpoint listens on.
		launched = await launch(directories, testInfo);
		const second = await controlSocketOf(
			await openWorkspace(launched),
			path.join(root, 'socket-2'),
		);
		expect(second).toBe(first);
		expect((await lstat(second)).isSocket()).toBe(true);
	} finally {
		await launched?.close();
		await rm(expectedDirectory, { recursive: true, force: true });
		await rm(root, { recursive: true, force: true });
	}
});

test('a runtime directory open to other users is refused: Desktop says which directory and why, and leaves it as it was', async () => {
	const testInfo = test.info();
	test.setTimeout(120_000);
	const directories = await longDataDirectory();
	const { root, tempDir, userDataDir } = directories;
	const runtimeDirectory = runtimeDirectoryFor(userDataDir, tempDir);
	await mkdir(runtimeDirectory, { recursive: true });
	await chmod(runtimeDirectory, 0o755);
	let launched: Launched | undefined;
	try {
		launched = await launch(directories, testInfo);
		const page = await launched.electronApp.firstWindow();
		const recovery = page.locator('body');
		await expect(recovery).toContainText(
			'data directory is at a path too long for a local socket',
			{ timeout: READY_TIMEOUT_MS },
		);
		await expect(recovery).toContainText(
			`the limit is ${MAX_SOCKET_PATH_BYTES}`,
		);
		await expect(recovery).toContainText(
			'Start Terminay with a shorter data directory',
		);
		await expect(recovery).toContainText(userDataDir);
		await expect(recovery).toContainText(
			`${runtimeDirectory}, cannot be used: other users can access it`,
		);
		// Not the general message, and no workspace behind it.
		await expect(recovery).not.toContainText('could not finish starting');
		await expect(page.locator('.project-tabbar')).toHaveCount(0);
		// Refused, not repaired, and nothing is listening in it.
		expect(await modeOf(runtimeDirectory)).toBe(0o755);
		await expect(
			lstat(path.join(runtimeDirectory, 'control.sock')),
		).rejects.toThrow();
		// Recorded for support, with what was tried and no token.
		const diagnostics = async () => {
			const directory = path.join(userDataDir, 'logs');
			const files = await readdir(directory).catch(() => []);
			const texts = await Promise.all(
				files
					.filter((name) => name.endsWith('.jsonl'))
					.map((name) =>
						readFile(path.join(directory, name), 'utf8').catch(() => ''),
					),
			);
			return texts.join('\n');
		};
		await expect
			.poll(diagnostics, { timeout: 15_000 })
			.toContain('too long for a local socket');
		const recorded = await diagnostics();
		expect(recorded).toContain('other users can access it');
		expect(recorded).not.toMatch(/TERMINAY_CONTROL_TOKEN/);
	} finally {
		await launched?.close();
		await rm(runtimeDirectory, { recursive: true, force: true });
		await rm(root, { recursive: true, force: true });
	}
});
