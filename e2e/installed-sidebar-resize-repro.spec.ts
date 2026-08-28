import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const installedExecutable =
	process.env.TERMINAY_INSTALLED_EXECUTABLE ??
	'/Applications/Terminay.app/Contents/MacOS/Terminay';
const installedWorkspace =
	process.env.TERMINAY_INSTALLED_WORKSPACE ??
	path.join(
		os.homedir(),
		'Library',
		'Application Support',
		'Terminay',
		'workspace.v3.json',
	);

type BoundarySample = Readonly<{
	boundary: number;
	when:
		| 'start'
		| 'held-before-release'
		| 'release'
		| '50ms'
		| '100ms'
		| '250ms'
		| '500ms'
		| '1000ms'
		| '2000ms';
}>;

function pane(page: import('@playwright/test').Page, id: string) {
	return page.locator(`[data-sidebar-panel-id="${id}"]`);
}

async function gitBoundary(page: import('@playwright/test').Page) {
	return await page.evaluate(() => {
		const stack = document.querySelector<HTMLElement>('.sidebar-panel-stack');
		const header = document.querySelector<HTMLElement>(
			'[data-sidebar-panel-id="git"] .sidebar-pane__header',
		);
		if (!stack || !header) {
			throw new Error('The installed Agents/Git boundary is unavailable.');
		}
		return (
			header.getBoundingClientRect().top - stack.getBoundingClientRect().top
		);
	});
}

async function setExpanded(
	page: import('@playwright/test').Page,
	id: string,
	expanded: boolean,
): Promise<void> {
	const target = pane(page, id);
	const header = target.locator('.sidebar-pane__header');
	const actual = await header.getAttribute('aria-expanded');
	if ((actual === 'true') !== expanded) await header.click();
	await expect(header).toHaveAttribute('aria-expanded', String(expanded));
}

/**
 * Reproduces the exact user-facing release in the currently installed package,
 * not the worktree implementation. It gets a copy of workspace.v3.json in a
 * freshly-created profile, so the real profile is read-only input.
 */
test('installed 3.2 sidebar: rapid Agents/Git mouse release does not bounce', async () => {
	test.skip(
		!existsSync(installedExecutable) || !existsSync(installedWorkspace),
		'The installed Terminay app and workspace profile are required for this release reproducer.',
	);
	test.setTimeout(60_000);
	const temporaryRoot = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-installed-repro-'),
	);
	const profile = path.join(temporaryRoot, 'profile');
	await mkdir(profile, { recursive: true });
	// These are the non-secret local state files needed to boot the packaged
	// local workspace. Deliberately do not copy vaults, remote credentials,
	// browser storage, caches, or any other part of the real profile.
	const installedProfile = path.dirname(installedWorkspace);
	for (const filename of [
		// 'workspace.v3.json',
		// 'project-environments.v1.json',
		// 'terminal-settings.json',
	]) {
		const source = path.join(installedProfile, filename);
		if (existsSync(source)) await cp(source, path.join(profile, filename));
	}

	const app = await electron.launch({
		executablePath: installedExecutable,
		args: [`--user-data-dir=${profile}`],
		env: {
			...process.env,
			TERMINAY_USER_DATA_DIR: profile,
			TEMP: temporaryRoot,
			TMP: temporaryRoot,
			TMPDIR: temporaryRoot,
		},
	});
	try {
		const page = await app.firstWindow();
		await page.waitForSelector('.sidebar-panel-stack');
		await app.evaluate(({ BrowserWindow }) => {
			const window =
				BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
			if (!window)
				throw new Error('The installed BrowserWindow is unavailable.');
			window.setBounds({ ...window.getBounds(), height: 1275, width: 1980 });
		});
		for (const id of ['explorer', 'git']) {
			await setExpanded(page, id, true);
		}
		await expect(page.locator('.sidebar-split__splitter')).toHaveCount(2);

		// The second recursive splitter is the top edge of Git: it resizes Agents
		// when dragged upward, exactly as in the supplied screenshot.
		const splitter = page.locator('.sidebar-split__splitter').nth(1);
		const box = await splitter.boundingBox();
		if (!box) throw new Error('The installed Agents/Git splitter has no box.');
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		const samples: BoundarySample[] = [];
		const sample = async (when: BoundarySample['when']) => {
			samples.push({ boundary: await gitBoundary(page), when });
		};

		await sample('start');
		const startedAt = Date.now();
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y - 120, { steps: 1 });
		await sample('held-before-release');
		expect(Date.now() - startedAt).toBeLessThan(600);
		await page.mouse.up();
		await sample('release');
		for (const [when, delay] of [
			['50ms', 50],
			['100ms', 50],
			['250ms', 150],
			['500ms', 250],
			['1000ms', 500],
			['2000ms', 1000],
		] as const) {
			await page.waitForTimeout(delay);
			await sample(when);
		}

		const held = samples.find((entry) => entry.when === 'held-before-release');
		if (!held) throw new Error('The held resize position was not sampled.');
		const bounced = samples.filter(
			(entry) =>
				entry.when !== 'start' && Math.abs(entry.boundary - held.boundary) > 1,
		);
		expect(
			bounced,
			`Installed release Agents/Git release trace: ${JSON.stringify(samples)}`,
		).toEqual([]);
	} finally {
		await app.close().catch(() => undefined);
		await rm(temporaryRoot, { force: true, recursive: true });
	}
});
