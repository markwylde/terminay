import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import {
	activeStartChooser,
	activeTerminalCwd,
	browseToFolder,
	chooseProjectStart,
	rootFolderBrowser,
	startChooserFor,
} from './support/project-start';
import {
	openFileExplorer,
	selectSidebarGroup,
	setProjectRoot,
} from './support/ui';

/**
 * A project created from the window never takes another project's folder: it
 * waits, on the server, for its start choice. These drive that chooser end to
 * end on Desktop, through a restart, and at phone width.
 */

const READY_TIMEOUT_MS = 20_000;

const activeWorkspace = (page: Page) =>
	page.locator('.project-workspace--active');

const projectTabTitle = (page: Page, projectId: string) =>
	page.locator(`.project-tab[data-project-id="${projectId}"] .project-tab-title`);

/** Create a project and wait for its chooser. Returns the project's id. */
async function createAwaitingProject(page: Page): Promise<string> {
	await page.getByLabel('Create project').click();
	const chooser = activeStartChooser(page);
	await expect(chooser).toBeVisible({ timeout: 15_000 });
	const projectId = await chooser.getAttribute('data-terminay-project-id');
	if (projectId === null) throw new Error('The start chooser names no project');
	return projectId;
}

/** A chooser on screen: its heading, both starts, the first one focused. */
async function expectChooserShown(page: Page, projectId: string): Promise<void> {
	const chooser = startChooserFor(page, projectId);
	await expect(chooser).toBeVisible();
	await expect(chooser.getByRole('heading', { level: 2 })).toHaveText(
		/^Start Project \d+$/u,
	);
	const folder = chooser.locator('[data-terminay-start-action="folder"]');
	await expect(folder).toContainText('Open a folder');
	await expect(
		chooser.locator('[data-terminay-start-action="home"]'),
	).toContainText('Home directory');
	await expect(folder).toBeFocused();
	// No terminal, no panels, and no sidebar until it is answered.
	await expect(chooser.locator('.terminal-panel')).toHaveCount(0);
	await expect(chooser.locator('.file-explorer-sidebar')).toHaveCount(0);
}

test('a project created beside a rooted one waits for its start, and Home starts it with no root folder', async ({
	createWorkspace,
	mainWindow,
}) => {
	test.setTimeout(90_000);
	const rooted = await createWorkspace({
		name: 'rooted-project',
		seed: { files: { 'README.md': '# rooted\n' } },
	});
	const rootedRoot = await realpath(rooted.rootDir);
	await setProjectRoot(mainWindow, rootedRoot);
	await expect(activeWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-project-root',
		rootedRoot,
	);
	const terminalsBefore = await mainWindow
		.locator('.terminal-tab-content')
		.count();

	const projectId = await createAwaitingProject(mainWindow);
	await expectChooserShown(mainWindow, projectId);
	// The new project launched nothing.
	await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(
		terminalsBefore,
	);

	await startChooserFor(mainWindow, projectId)
		.locator('[data-terminay-start-action="home"]')
		.click();
	await expect(startChooserFor(mainWindow, projectId)).toHaveCount(0);
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-panel:visible'),
	).toHaveCount(1, { timeout: 15_000 });

	// It runs in the server account's home, and has no root of its own: not
	// the rooted project's folder, and not home either.
	expect(await activeTerminalCwd(mainWindow)).toBe(await realpath(os.homedir()));
	await expect(activeWorkspace(mainWindow)).not.toHaveAttribute(
		'data-terminay-project-root',
		rootedRoot,
	);

	await openFileExplorer(mainWindow);
	for (const pane of ['explorer', 'git'] as const) {
		const empty = activeWorkspace(mainWindow).locator(
			`[data-terminay-no-root-folder="${pane}"]`,
		);
		await expect(empty).toBeVisible();
		await expect(empty).toContainText('No root folder');
		await expect(
			empty.locator('[data-terminay-no-root-open-folder]'),
		).toBeVisible();
	}
	await expect(
		activeWorkspace(mainWindow).locator('.file-explorer-tree-item'),
	).toHaveCount(0);
	await selectSidebarGroup(mainWindow, 'documentation');
	const documentation = activeWorkspace(mainWindow).locator(
		'[data-terminay-no-root-folder="documentation"]',
	);
	await expect(documentation).toBeVisible();
	await expect(documentation).toContainText('No root folder');

	// The no-root pane's Open a folder gives the project a root.
	await documentation.locator('[data-terminay-no-root-open-folder]').click();
	await browseToFolder(mainWindow, rootedRoot);
	await rootFolderBrowser(mainWindow)
		.locator('[data-terminay-root-folder-choose]')
		.click();
	await expect(activeWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-project-root',
		rootedRoot,
	);
	await expect(
		activeWorkspace(mainWindow).locator('[data-terminay-no-root-folder]'),
	).toHaveCount(0);
});

test('closing the tab in front while a project awaits its start closes the project', async ({
	appHarness,
	mainWindow,
}) => {
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	const projectId = await createAwaitingProject(mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);

	await appHarness.sendAppCommand('close-active');

	await expect(startChooserFor(mainWindow, projectId)).toHaveCount(0);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
});

/** How far the active project tab's surface reaches below the project bar. */
async function activeProjectTabOverhang(page: Page): Promise<string> {
	return page
		.locator('.project-tabbar .project-tab--active')
		.evaluate((tab) => getComputedStyle(tab, '::before').bottom);
}

test('the active project tab joins the panel tab strip only once the project has one', async ({
	mainWindow,
}) => {
	test.setTimeout(60_000);
	const projectId = await createAwaitingProject(mainWindow);

	// The chooser has no panel tab strip, so the tab is a closed pill.
	await expect.poll(() => activeProjectTabOverhang(mainWindow)).toBe('5px');

	await startChooserFor(mainWindow, projectId)
		.locator('[data-terminay-start-action="home"]')
		.click();
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-panel:visible'),
	).toHaveCount(1, { timeout: 15_000 });

	// Now it runs on into the strip below.
	await expect.poll(() => activeProjectTabOverhang(mainWindow)).toBe('-2px');
});

test('a folder opened through the browser becomes a recent folder that a later project opens and can forget', async ({
	createWorkspace,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	const workspace = await createWorkspace({
		name: 'chosen-folder',
		seed: { directories: ['inner'], files: { 'README.md': '# chosen\n' } },
	});
	const folder = await realpath(workspace.rootDir);
	const parent = path.dirname(folder);
	const name = path.basename(folder);

	// Open a folder: the browser starts at home with the path shown once, in
	// its field, goes where it is typed, and enters folders by name.
	const first = await createAwaitingProject(mainWindow);
	await startChooserFor(mainWindow, first)
		.locator('[data-terminay-start-action="folder"]')
		.click();
	const browser = rootFolderBrowser(mainWindow);
	const field = browser.locator('[data-terminay-root-folder-path]');
	await expect(browser).toBeVisible();
	await expect(field).toBeFocused();
	await expect(field).toHaveValue(`${await realpath(os.homedir())}/`);
	await browseToFolder(mainWindow, parent);
	await browser.locator(`[data-terminay-root-folder-entry="${name}"]`).click();
	await expect(field).toHaveValue(`${folder}/`);
	await expect(field).toBeFocused();
	await expect(
		browser.locator('[data-terminay-root-folder-entry="inner"]'),
	).toBeVisible();
	// Directories only: the README is never listed.
	await expect(
		browser.locator('[data-terminay-root-folder-entry="README.md"]'),
	).toHaveCount(0);

	// Tab completes like a shell and keeps focus in the field; the segment
	// delete chord takes it back off, and the parent chord goes up a folder.
	await field.fill(`${folder}/in`);
	await field.press('Tab');
	await expect(field).toHaveValue(`${folder}/inner/`);
	await expect(field).toBeFocused();
	await field.press(
		process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace',
	);
	await expect(field).toHaveValue(`${folder}/`);
	await field.press(
		process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Alt+ArrowUp',
	);
	await expect(field).toHaveValue(`${parent}/`);
	await field.fill(`${folder}/`);
	await expect(browser.locator('[data-terminay-root-folder-choose]')).toHaveText(
		`Open “${name}”`,
	);
	// Enter chooses the folder the field names.
	await field.press('Enter');
	await expect(browser).toHaveCount(0);
	await expect(startChooserFor(mainWindow, first)).toHaveCount(0);
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-panel:visible'),
	).toHaveCount(1, { timeout: 15_000 });
	await expect(activeWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-project-root',
		folder,
	);
	expect(await activeTerminalCwd(mainWindow)).toBe(folder);

	// Started in a folder, it is named after the folder.
	await expect(projectTabTitle(mainWindow, first)).toHaveText(name);

	// A second project offered the folder the first already has shows the
	// first, and the empty one closes: nothing new is started there.
	const tabsBefore = await mainWindow.locator('.project-tab').count();
	const second = await createAwaitingProject(mainWindow);
	const recent = startChooserFor(mainWindow, second).locator(
		`[data-terminay-recent-folder="${folder}"]`,
	);
	await expect(recent).toBeVisible();
	await expect(recent).toHaveAttribute('data-available', 'true');
	await expect(recent).toContainText(name);
	await recent.locator('[data-terminay-recent-open]').click();
	await expect(startChooserFor(mainWindow, second)).toHaveCount(0);
	await expect(
		mainWindow.locator(`.project-tab[data-project-id="${second}"]`),
	).toHaveCount(0);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(tabsBefore);
	await expect(activeWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-project-id',
		first,
	);
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-panel:visible'),
	).toHaveCount(1);

	// Once no project has the folder, a recent entry starts a new project
	// there, named after it.
	const elsewhere = await realpath(
		(await createWorkspace({ name: 'elsewhere' })).rootDir,
	);
	await setProjectRoot(mainWindow, elsewhere);
	await expect(activeWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-project-root',
		elsewhere,
	);
	const third = await createAwaitingProject(mainWindow);
	await startChooserFor(mainWindow, third)
		.locator(`[data-terminay-recent-folder="${folder}"] [data-terminay-recent-open]`)
		.click();
	await expect(startChooserFor(mainWindow, third)).toHaveCount(0);
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-panel:visible'),
	).toHaveCount(1, { timeout: 15_000 });
	await expect(activeWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-project-root',
		folder,
	);
	await expect(projectTabTitle(mainWindow, third)).toHaveText(name);
	expect(await activeTerminalCwd(mainWindow)).toBe(folder);

	// A fourth project forgets it, and it stays forgotten.
	const fourth = await createAwaitingProject(mainWindow);
	const chooser = startChooserFor(mainWindow, fourth);
	const row = chooser.locator(`[data-terminay-recent-folder="${folder}"]`);
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: `Forget ${name}` }).click();
	await expect(row).toHaveCount(0);
	await expect(
		chooser.locator(`[data-terminay-recent-folder="${elsewhere}"]`),
	).toBeVisible();
	// Forgetting a folder starts nothing.
	await expect(chooser.locator('[data-terminay-start-action="folder"]')).toBeVisible();
	await chooseProjectStart(mainWindow, 'home');
	const fifth = await createAwaitingProject(mainWindow);
	await expect(
		startChooserFor(mainWindow, fifth).locator(
			`[data-terminay-recent-folder="${folder}"]`,
		),
	).toHaveCount(0);
});

test('the folder browser keeps one height between folders and completes a typed path', async ({
	createWorkspace,
	mainWindow,
}) => {
	test.setTimeout(90_000);
	const many = Array.from(
		{ length: 200 },
		(_, index) => `many/dir-${String(index).padStart(3, '0')}`,
	);
	const workspace = await createWorkspace({
		name: 'browse-heights',
		seed: { directories: ['sparse/one', 'sparse/two', ...many, 'projects-a', 'projects-b'] },
	});
	const base = await realpath(workspace.rootDir);

	const projectId = await createAwaitingProject(mainWindow);
	await startChooserFor(mainWindow, projectId)
		.locator('[data-terminay-start-action="folder"]')
		.click();
	const browser = rootFolderBrowser(mainWindow);
	const body = browser.locator('[data-terminay-root-folder-body]');
	const list = browser.locator('.root-folder-browser__list');

	await browseToFolder(mainWindow, path.join(base, 'sparse'));
	await expect(browser.locator('[data-terminay-root-folder-entry]')).toHaveCount(2);
	const sparseHeight = (await browser.boundingBox())?.height;
	const sparseBody = (await body.boundingBox())?.height;
	await browseToFolder(mainWindow, path.join(base, 'many'));
	await expect(browser.locator('[data-terminay-root-folder-entry]')).toHaveCount(200);
	expect((await browser.boundingBox())?.height).toBe(sparseHeight);
	expect((await body.boundingBox())?.height).toBe(sparseBody);
	// The longer listing scrolls inside that height.
	expect(
		await list.evaluate((element) => element.scrollHeight > element.clientHeight),
	).toBe(true);
	await browseToFolder(mainWindow, path.join(base, 'sparse'));
	expect((await browser.boundingBox())?.height).toBe(sparseHeight);

	// Typing filters the listing to the typed parent's matching folders.
	const field = browser.locator('[data-terminay-root-folder-path]');
	const names = browser.locator('.root-folder-browser__entry-name');
	await field.fill(`${base}/proj`);
	await expect(names).toHaveText(['projects-a', 'projects-b']);
	expect((await browser.boundingBox())?.height).toBe(sparseHeight);
	// Tab fills the common prefix, then cycles the matches, and focus never
	// leaves the field.
	await field.press('Tab');
	await expect(field).toHaveValue(`${base}/projects-`);
	await field.press('Tab');
	await expect(field).toHaveValue(`${base}/projects-a/`);
	await field.press('Tab');
	await expect(field).toHaveValue(`${base}/projects-b/`);
	await expect(field).toBeFocused();
	// Escape undoes the cycle and leaves the browser open.
	await field.press('Escape');
	await expect(field).toHaveValue(`${base}/projects-`);
	await expect(browser).toBeVisible();
	// The arrows highlight one and Tab goes into it.
	await field.press('ArrowDown');
	await field.press('ArrowDown');
	await field.press('Tab');
	await expect(field).toHaveValue(`${base}/projects-b/`);
	// A pointer goes into one too, and the field keeps focus.
	await field.fill(`${base}/ma`);
	await browser.locator('[data-terminay-root-folder-entry="many"]').click();
	await expect(field).toHaveValue(`${base}/many/`);
	await expect(field).toBeFocused();
	await browser.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(browser).toHaveCount(0);
	await expect(startChooserFor(mainWindow, projectId)).toBeVisible();
});

test('a project still awaiting its start after a restart shows its chooser again and launches no terminal', async ({
	tempDir,
	userDataDir,
}, testInfo) => {
	test.setTimeout(150_000);
	const launch = async () => {
		const launched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		const page = await prepareWindow(await launched.electronApp.firstWindow());
		await expect(page.locator('.project-tabbar')).toBeVisible({
			timeout: READY_TIMEOUT_MS,
		});
		return { ...launched, page };
	};

	let current = await launch();
	try {
		await expect(current.page.locator('.terminal-tab-content')).toHaveCount(1, {
			timeout: READY_TIMEOUT_MS,
		});
		const projectId = await createAwaitingProject(current.page);
		await expectChooserShown(current.page, projectId);
		await expect(current.page.locator('.terminal-tab-content')).toHaveCount(1);
		await current.close();

		current = await launch();
		const page = current.page;
		const tab = page.locator(`.project-tab[data-project-id="${projectId}"]`);
		await expect(tab).toBeVisible({ timeout: READY_TIMEOUT_MS });
		if (!(await startChooserFor(page, projectId).isVisible())) await tab.click();
		await expectChooserShown(page, projectId);
		// The started project came back with its one terminal; the awaiting one
		// came back with none, and stays that way.
		await expect(page.locator('.terminal-tab-content')).toHaveCount(1, {
			timeout: READY_TIMEOUT_MS,
		});
		await expect(startChooserFor(page, projectId)).toBeVisible();

		// It still starts as any awaiting project does.
		await chooseProjectStart(page, 'home');
		expect(await activeTerminalCwd(page)).toBe(await realpath(os.homedir()));
		// The start came after everything the relaunch restored, and it made
		// the one terminal: had the awaiting project been given one of its own
		// on the way back, there would be three.
		await expect(page.locator('.terminal-tab-content')).toHaveCount(2);
	} finally {
		await current.close();
	}
});

test('at phone width the chooser and the folder browser fit without horizontal overflow', async ({
	electronApp,
	mainWindow,
}) => {
	const nativeWindow = await electronApp.browserWindow(mainWindow);
	await nativeWindow.evaluate((window) => {
		window.setBounds({ x: 40, y: 40, width: 390, height: 740 });
	});
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible();

	// The compact chrome has no tab strip; its switcher creates the project.
	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	await mainWindow
		.getByRole('dialog', { name: 'Switch terminal' })
		.getByRole('button', { name: 'New project' })
		.click();
	const chooser = activeStartChooser(mainWindow);
	await expect(chooser).toBeVisible({ timeout: 15_000 });

	// Nothing scrolls sideways and nothing reaches past the window's edges.
	// A long path is ellipsised inside its own box, which still fits.
	const overflow = (root: string) =>
		mainWindow.evaluate((target) => {
			const container = document.querySelector<HTMLElement>(target);
			if (container === null) return ['missing'];
			const width = window.innerWidth;
			const problems: string[] = [];
			for (const element of [document.documentElement, container])
				if (element.scrollWidth > element.clientWidth + 1)
					problems.push(`scrolls: ${element.className || element.tagName}`);
			for (const element of container.querySelectorAll<HTMLElement>('*')) {
				const rect = element.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) continue;
				if (rect.left < -1 || rect.right > width + 1)
					problems.push(`outside: ${element.className || element.tagName}`);
			}
			return problems;
		}, root);
	expect(
		await overflow(
			'[data-terminay-start-chooser="true"].project-workspace--active',
		),
	).toEqual([]);
	const box = await chooser.boundingBox();
	if (box === null) throw new Error('Expected chooser geometry');
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(391);

	await chooser.locator('[data-terminay-start-action="folder"]').click();
	const browser = rootFolderBrowser(mainWindow);
	await expect(browser).toBeVisible();
	await expect(browser.locator('[data-terminay-root-folder-listed]')).toBeVisible();
	expect(await overflow('[data-in-page-window="root-folder-browser"]')).toEqual(
		[],
	);
	await browser.getByRole('button', { name: 'Cancel' }).click();
	await expect(browser).toHaveCount(0);
	await expect(chooser).toBeVisible();
});
