import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { DESKTOP_STATE_FILES, type DesktopStateFile } from '../electron/stateFileRegistry';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { settledTerminalSessionId } from './support/terminal-session';

/**
 * durable-state-files, group 7: Terminay must start, or offer a way forward,
 * whatever a crash or power loss left in its data directory (ADR-0088).
 *
 * A Windows VM that lost power came back with every recently written state
 * file at full length and all zeros, and Desktop then offered only a Retry
 * that could never succeed. These tests rebuild that data directory from a
 * real session and relaunch the real application on it.
 */

type Launched = Awaited<ReturnType<typeof launchDesktopApp>>;
type Shape = 'zero-filled' | 'truncated' | 'invalid JSON';
const SHAPES: readonly Shape[] = ['zero-filled', 'truncated', 'invalid JSON'];

const READY_MS = 45_000;

function damage(file: string, shape: Shape): void {
	const size = statSync(file).size;
	if (shape === 'zero-filled') writeFileSync(file, Buffer.alloc(Math.max(size, 1)));
	else if (shape === 'truncated')
		writeFileSync(file, readFileSync(file).subarray(0, Math.max(1, Math.floor(size / 2))));
	else writeFileSync(file, '{"terminay": not json');
}

/** Every file on disk that a registry entry names, with the entry. */
function stateFilesOnDisk(userDataDir: string): { entry: DesktopStateFile; file: string }[] {
	const found: { entry: DesktopStateFile; file: string }[] = [];
	for (const entry of DESKTOP_STATE_FILES) {
		for (const relative of expand(userDataDir, entry.file.split('/'), entry.pattern === true))
			found.push({ entry, file: path.join(userDataDir, relative) });
	}
	return found;
}

function expand(root: string, segments: readonly string[], pattern: boolean, prefix = ''): string[] {
	if (segments.length === 0) return existsSync(path.join(root, prefix)) && statSync(path.join(root, prefix)).isFile() ? [prefix] : [];
	const [head, ...rest] = segments;
	if (!pattern || !head.includes('*')) return expand(root, rest, pattern, prefix === '' ? head : `${prefix}/${head}`);
	const directory = path.join(root, prefix);
	if (!existsSync(directory)) return [];
	const matcher = new RegExp(`^${head.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
	return readdirSync(directory)
		.filter((name) => matcher.test(name) && !name.includes('.corrupt-') && !name.endsWith('.previous') && !name.endsWith('.tmp'))
		.flatMap((name) => expand(root, rest, pattern, prefix === '' ? name : `${prefix}/${name}`));
}

/**
 * Files in the data directory that look like Terminay state but no registry
 * entry names. A store added without one fails the suite here.
 */
const NOT_TERMINAY_STATE = new Set([
	// Chromium's own profile.
	'Local Storage', 'Session Storage', 'IndexedDB', 'blob_storage', 'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary', 'Crashpad', 'Service Worker', 'WebStorage', 'Partitions', 'Network', 'shared_proto_db', 'VideoDecodeStats', 'Dictionaries',
	'Preferences', 'Local State', 'Network Persistent State', 'TransportSecurity', 'Trust Tokens', 'Cookies', 'SharedStorage', 'Network Action Predictor',
	// Not state: logs, temp, recordings (user documents), the holder runtime
	// copy (verified by its manifest), shell integration scripts (rewritten at
	// start), and installed extension packages (verified by the installer).
	'logs', 'temp', 'recordings', 'holder-runtime', 'shell-integration', 'packages', 'staging',
]);
function unregisteredStateFiles(userDataDir: string): string[] {
	const registered = new Set(stateFilesOnDisk(userDataDir).map(({ file }) => file));
	const unknown: string[] = [];
	const walk = (directory: string) => {
		for (const name of readdirSync(directory)) {
			if (NOT_TERMINAY_STATE.has(name)) continue;
			const full = path.join(directory, name);
			const stats = lstatSync(full);
			if (stats.isSymbolicLink()) continue;
			if (stats.isDirectory()) walk(full);
			else if (/\.json$/u.test(name) && !name.includes('.corrupt-') && !name.endsWith('.pre-migration.json') && !registered.has(full))
				unknown.push(path.relative(userDataDir, full));
		}
	};
	walk(userDataDir);
	return unknown;
}

type Outcome =
	| { readonly kind: 'open'; readonly page: Page }
	| { readonly kind: 'recovery'; readonly page: Page; readonly startFresh: boolean; readonly text: string };

async function outcomeOf(electronApp: ElectronApplication): Promise<Outcome> {
	const page = await electronApp.firstWindow({ timeout: READY_MS });
	const workspace = page.locator('.project-tabbar');
	const alert = page.getByRole('alert').filter({ hasText: 'Terminay could not open this workspace' });
	await expect(workspace.or(alert).first()).toBeVisible({ timeout: READY_MS });
	if (await workspace.isVisible()) return { kind: 'open', page };
	const startFresh = (await alert.getByRole('link', { name: 'Start fresh' }).count()) > 0;
	return { kind: 'recovery', page, startFresh, text: (await alert.innerText()).trim() };
}

async function exited(electronApp: ElectronApplication): Promise<void> {
	const child = electronApp.process();
	if (child.exitCode !== null || child.signalCode !== null) return;
	await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

/**
 * Launch until the workspace opens, choosing Start fresh each time the
 * recovery document offers it. Every recovery it meets must offer Start
 * fresh: a Retry that can never succeed is the bug this suite exists for.
 */
async function launchThroughRecovery(
	dirs: { tempDir: string; userDataDir: string; testInfo: TestInfo },
	maxRounds: number,
): Promise<{ launched: Launched; page: Page; recoveries: string[] }> {
	const recoveries: string[] = [];
	let launched = await launchDesktopApp(dirs);
	for (let round = 0; round <= maxRounds; round += 1) {
		const outcome = await outcomeOf(launched.electronApp);
		if (outcome.kind === 'open') return { launched, page: outcome.page, recoveries };
		expect(outcome.startFresh, `recovery offered only Retry: ${outcome.text}`).toBe(true);
		expect(outcome.text).not.toMatch(/\/|\\|\.json|EACCES|SyntaxError/u);
		recoveries.push(outcome.text);
		const gone = exited(launched.electronApp);
		await outcome.page.getByRole('link', { name: 'Start fresh' }).evaluate((link) => {
			(link as HTMLAnchorElement).click();
		});
		// The workspace store retries in place; the others end the process,
		// and the suite launches it again as the user's relaunch would.
		const next = await Promise.race([
			gone.then(() => 'exited' as const),
			outcomeOf(launched.electronApp).then((after) => after),
		]);
		if (next === 'exited') {
			await launched.close();
			launched = await launchDesktopApp(dirs);
		} else if (next.kind === 'open') {
			return { launched, page: next.page, recoveries };
		}
	}
	throw new Error(`Terminay did not open after ${maxRounds} recovery rounds: ${recoveries.join(' | ')}`);
}

/** A real session: a terminal with output, so every store has been written. */
async function useTerminay(electronApp: ElectronApplication): Promise<void> {
	const page = await prepareWindow(await electronApp.firstWindow());
	const sessionId = await settledTerminalSessionId(page.locator('.terminal-panel:visible'));
	const panel = page.locator(`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`);
	await panel.locator('.xterm-helper-textarea').focus();
	await page.keyboard.type("printf 'corrupt-%s\\n' suite");
	await page.keyboard.press('Enter');
	await expect(panel.locator('.xterm-rows')).toContainText('corrupt-suite', { timeout: 15_000 });
	// Two workspace revisions, so canonical stores have a previous copy.
	await page.keyboard.type('clear');
	await page.keyboard.press('Enter');
	await expect
		.poll(() => electronApp.evaluate(() => (globalThis as unknown as { __terminayTestWorkspaceRevision: () => number }).__terminayTestWorkspaceRevision()), { timeout: 15_000 })
		.toBeGreaterThan(1);
}

async function notices(electronApp: ElectronApplication): Promise<{ message: string; detail: string }[]> {
	return electronApp.evaluate(
		() => (globalThis as unknown as { __terminayTestStateRecoveryNotices: () => { message: string; detail: string }[] }).__terminayTestStateRecoveryNotices(),
	);
}

const corruptCopies = (file: string) =>
	readdirSync(path.dirname(file)).filter((name) => name.startsWith(`${path.basename(file)}.corrupt-`));

test('every Terminay state file in the data directory is in the registry', async ({ electronApp, userDataDir }) => {
	test.setTimeout(120_000);
	await useTerminay(electronApp);
	expect(unregisteredStateFiles(userDataDir)).toEqual([]);
	expect(stateFilesOnDisk(userDataDir).length).toBeGreaterThan(5);
});

test('with every state file zero-filled and no good copy, Terminay offers Start fresh until it opens', async ({ electronApp, tempDir, userDataDir }, testInfo) => {
	test.setTimeout(600_000);
	await useTerminay(electronApp);
	await electronApp.close();
	const files = stateFilesOnDisk(userDataDir);
	for (const { file } of files) {
		damage(file, 'zero-filled');
		if (existsSync(`${file}.previous`)) damage(`${file}.previous`, 'zero-filled');
	}
	const canonicalStores = new Set(files.filter(({ entry }) => entry.kind === 'canonical').map(({ entry }) => entry.store));
	const { launched, page, recoveries } = await launchThroughRecovery({ tempDir, userDataDir, testInfo }, canonicalStores.size + 1);
	try {
		expect(recoveries.length).toBeGreaterThan(0);
		await expect(page.locator('.terminal-panel:visible').first()).toBeVisible({ timeout: READY_MS });
		// Nothing was deleted: every damaged file is kept beside its original.
		for (const { file } of files) expect(corruptCopies(file).length, file).toBeGreaterThan(0);
	} finally {
		await launched.close();
	}
});

test('with every state file zero-filled but a good previous copy, Terminay opens the restored workspace and says so', async ({ electronApp, tempDir, userDataDir }, testInfo) => {
	test.setTimeout(240_000);
	await useTerminay(electronApp);
	await electronApp.close();
	const workspace = path.join(userDataDir, 'workspace.v4.json');
	expect(existsSync(`${workspace}.previous`)).toBe(true);
	for (const { file } of stateFilesOnDisk(userDataDir)) damage(file, 'zero-filled');
	const { launched, page, recoveries } = await launchThroughRecovery({ tempDir, userDataDir, testInfo }, 12);
	try {
		// Only canonical files without a previous copy may ask; the workspace
		// has one, so it is never among them.
		for (const text of recoveries) expect(text).not.toMatch(/workspace: your projects/u);
		await expect(page.locator('.terminal-panel:visible').first()).toBeVisible({ timeout: READY_MS });
		const shown = await notices(launched.electronApp);
		expect(shown.length).toBe(1);
		expect(shown[0].detail).toMatch(/earlier save was restored for your .*workspace/u);
		expect(corruptCopies(workspace).length).toBe(1);
	} finally {
		await launched.close();
	}
});

for (const [index, shape] of SHAPES.entries()) {
	test(`each state file alone, ${shape}: the outcome its kind requires`, async ({ electronApp, tempDir, userDataDir }, testInfo) => {
		test.setTimeout(900_000);
		await useTerminay(electronApp);
		await electronApp.close();
		const files = stateFilesOnDisk(userDataDir);
		// Each launch takes several seconds, so each shape covers a third of
		// the files and the three shapes together cover every file in each
		// shape across the rotation. The workspace is covered in every shape.
		const chosen = files.filter(({ entry }, position) => entry.store === 'workspace' || position % SHAPES.length === index);
		for (const { entry, file } of chosen) {
			if (!existsSync(file)) continue;
			const original = readFileSync(file);
			const previous = existsSync(`${file}.previous`) ? readFileSync(`${file}.previous`) : undefined;
			damage(file, shape);
			const launched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
			try {
				const outcome = await outcomeOf(launched.electronApp);
				const label = `${entry.file} (${entry.kind}, ${shape})`;
				if (entry.kind === 'canonical' && previous === undefined) {
					// No good copy: the user decides, and nothing has moved yet.
					expect(outcome.kind, label).toBe('recovery');
					if (outcome.kind === 'recovery') expect(outcome.startFresh, label).toBe(true);
					expect(existsSync(file), label).toBe(true);
				} else {
					// Restored, failed closed, or rebuilt: the workspace opens.
					expect(outcome.kind, label).toBe('open');
					expect(corruptCopies(file).length, label).toBeGreaterThan(0);
					const shown = await notices(launched.electronApp);
					if (entry.kind === 'canonical') expect(shown.length, label).toBe(1);
					if (entry.kind === 'secret') expect(shown.length, label).toBe(1);
					if (entry.kind === 'rebuildable') expect(shown, label).toEqual([]);
				}
			} finally {
				await launched.close();
				// Put the session back for the next file.
				writeFileSync(file, original);
				if (previous !== undefined) writeFileSync(`${file}.previous`, previous);
			}
		}
	});
}
