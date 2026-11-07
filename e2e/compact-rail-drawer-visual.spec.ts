import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	ElectronApplication,
	Locator,
	Page,
	TestInfo,
} from '@playwright/test';
import { expect, test } from './fixtures';
import { folderRow, git, initRepository } from './support/folders';
import { createStartedProject } from './support/project-start';
import { setProjectRoot } from './support/ui';

/**
 * Screenshots of the compact rail drawer's key states at 390×844, in both
 * themes and with reduced motion, for review. Each state is asserted before
 * it is captured.
 */

test.describe.configure({ timeout: 120_000 });

const PHONE = { x: 40, y: 40, width: 390, height: 844 } as const;

async function resize(
	page: Page,
	electronApp: ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
}

async function settle(locator: Locator): Promise<void> {
	// Finite animations only; one cancelled on the way still counts as over.
	await locator.evaluate((element) =>
		Promise.allSettled(
			element
				.getAnimations({ subtree: true })
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !== Infinity,
				)
				.map((animation) => animation.finished),
		),
	);
}

async function shot(
	page: Page,
	testInfo: TestInfo,
	name: string,
): Promise<void> {
	const path = testInfo.outputPath('screenshots', `${name}.png`);
	await page.screenshot({ path });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function openDrawer(page: Page): Promise<Locator> {
	await page.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = page.getByRole('dialog', { name: 'Switch terminal' });
	await expect(drawer).toBeVisible();
	await settle(drawer);
	return drawer;
}

async function seed(
	page: Page,
	electronApp: ElectronApplication,
	rootDir: string,
): Promise<void> {
	const base = await realpath(rootDir);
	const root = join(base, 'terminay');
	await mkdir(root);
	await writeFile(join(root, 'README.md'), '# Terminay\n', 'utf8');
	await initRepository(root);
	for (const branch of ['worktree-rail-drawer', 'worktree-launchers'])
		await git(root, 'worktree', 'add', '-b', branch, join(base, branch));
	await setProjectRoot(page, root);
	await expect(folderRow(page, 'worktree-launchers')).toBeVisible({
		timeout: 10_000,
	});
	await createStartedProject(page);
	await expect(page.locator('[data-pending-project-id]')).toHaveCount(0);
	await resize(page, electronApp, PHONE);
}

for (const scheme of ['dark', 'light'] as const) {
	test(`rail drawer states in ${scheme} mode`, async ({
		createWorkspace,
		electronApp,
		mainWindow,
	}, testInfo) => {
		await mainWindow.emulateMedia({ colorScheme: scheme });
		const workspace = await createWorkspace({
			name: `drawer-visual-${scheme}`,
		});
		await seed(mainWindow, electronApp, workspace.rootDir);

		// The title block over a terminal.
		await expect(
			mainWindow.locator('[data-compact-home-toggle="true"]'),
		).toBeVisible();
		await shot(mainWindow, testInfo, `${scheme}-01-title-block`);

		// The project tree of the first project on the rail.
		const drawer = await openDrawer(mainWindow);
		await drawer.locator('[data-compact-switcher-project]').first().click();
		await expect(
			drawer.locator('[data-compact-switcher-folder-group]'),
		).not.toHaveCount(0);
		await settle(drawer);
		await shot(mainWindow, testInfo, `${scheme}-02-project-tree`);

		// The launcher dropup.
		await drawer.locator('[data-compact-switcher-launchers="true"]').click();
		const dropup = drawer.getByRole('menu', { name: 'New terminal' });
		await expect(dropup).toBeVisible();
		await settle(drawer);
		await shot(mainWindow, testInfo, `${scheme}-03-launcher-dropup`);
		await mainWindow.keyboard.press('Escape');
		await expect(dropup).toHaveCount(0);

		// Edit mode.
		const edit = drawer.locator('[data-compact-switcher-edit="true"]');
		await edit.click();
		await expect(edit).toHaveText('Done');
		await settle(drawer);
		await shot(mainWindow, testInfo, `${scheme}-04-edit-mode`);
		await edit.click();
		await expect(edit).toHaveText('Edit');

		// The project in front, with its Tabs and Agents row side by side.
		await drawer.locator('[data-compact-switcher-project]').last().click();
		const tabs = drawer.getByRole('tab');
		await expect(tabs).toHaveCount(2);
		const [first, second] = await tabs.evaluateAll((nodes) =>
			nodes.map((node) => node.getBoundingClientRect()),
		);
		expect(first.right).toBeLessThanOrEqual(second.left);
		expect(Math.abs(first.width - second.width)).toBeLessThan(2);
		await settle(drawer);
		await shot(mainWindow, testInfo, `${scheme}-05-front-project`);
		await drawer.getByRole('tab', { name: 'Agents' }).click();
		await settle(drawer);
		await shot(mainWindow, testInfo, `${scheme}-06-agents`);
		await drawer.getByRole('tab', { name: 'Tabs' }).click();

		// Home in the rail.
		await drawer.locator('[data-compact-switcher-home="true"]').click();
		await expect(
			drawer.locator('[data-compact-home-panel="true"]'),
		).toBeVisible();
		await settle(drawer);
		await shot(mainWindow, testInfo, `${scheme}-07-home-panel`);
	});
}

test('rail drawer with reduced motion opens without an entrance', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}, testInfo) => {
	await mainWindow.emulateMedia({
		colorScheme: 'dark',
		reducedMotion: 'reduce',
	});
	const workspace = await createWorkspace({ name: 'drawer-visual-reduced' });
	await seed(mainWindow, electronApp, workspace.rootDir);
	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = mainWindow.getByRole('dialog', { name: 'Switch terminal' });
	await expect(drawer).toBeVisible();
	const transform = await drawer.evaluate(
		(element) => getComputedStyle(element).transform,
	);
	expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform);
	await shot(mainWindow, testInfo, 'reduced-motion-01-drawer');
});
