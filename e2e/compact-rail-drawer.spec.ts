import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { waitUntilBusy } from './support/busy-terminals';
import {
	activeFolderWorkspace,
	createPlainFolder,
	deleteDialog,
	folderRow,
	git,
	initRepository,
} from './support/folders';
import { createStartedProject } from './support/project-start';
import { typeInVisibleTerminal } from './support/terminal-input';
import { activeTerminalSessionId } from './support/terminal-session';
import {
	fileExplorerItem,
	openFileExplorer,
	setProjectRoot,
} from './support/ui';
import type { FixtureWorkspace, WorkspaceOptions } from './support/workspace';

/**
 * The compact rail drawer's own behaviour beyond the switcher basics in
 * compact-chrome-switcher.spec.ts: its layers and keyboard, the folder and
 * row menus, edit-mode reorder and removal, and the title block for a file.
 */

test.describe.configure({ timeout: 90_000 });

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;
const WIDE = { x: 40, y: 40, width: 1280, height: 800 } as const;

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

const drawerOf = (page: Page) =>
	page.getByRole('dialog', { name: 'Switch terminal' });

async function openDrawer(page: Page): Promise<Locator> {
	await page.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = drawerOf(page);
	await expect(drawer).toBeVisible();
	// A press measured mid-entrance lands where the row used to be.
	await drawer.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
	return drawer;
}

const folderSection = (drawer: Locator, name: string) =>
	drawer.locator('[data-compact-switcher-folder-group]').filter({
		has: drawer
			.page()
			.locator(
				`.compact-drawer__folder-label:text-is(${JSON.stringify(name)})`,
			),
	});

const folderLabels = (drawer: Locator) =>
	drawer.locator('.compact-drawer__folder-label').allInnerTexts();

const railTitles = (drawer: Locator) =>
	drawer
		.locator('[data-compact-switcher-project] .compact-drawer__rail-label')
		.allInnerTexts();

/** A repository with one commit on `main` and a worktree per name. */
async function repository(
	createWorkspace: (options?: WorkspaceOptions) => Promise<FixtureWorkspace>,
	name: string,
	worktrees: readonly string[],
): Promise<string> {
	const base = await realpath((await createWorkspace({ name })).rootDir);
	const root = join(base, 'main');
	await mkdir(root);
	await writeFile(join(root, 'README.md'), '# Main checkout\n', 'utf8');
	await initRepository(root);
	for (const branch of worktrees)
		await git(
			root,
			'worktree',
			'add',
			'-b',
			branch,
			join(base, `${branch}-tree`),
		);
	return root;
}

test('the drawer enters once and stays the same element while it is used', async ({
	electronApp,
	mainWindow,
}) => {
	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await resize(mainWindow, electronApp, PHONE);
	await mainWindow.evaluate(() => {
		const probe = window as Window & { __drawerEntrances?: number };
		probe.__drawerEntrances = 0;
		document.addEventListener(
			'animationstart',
			(event) => {
				if ((event.target as Element).classList?.contains('compact-drawer'))
					probe.__drawerEntrances = (probe.__drawerEntrances ?? 0) + 1;
			},
			true,
		);
	});
	const drawer = await openDrawer(mainWindow);
	await drawer.evaluate((element) => {
		(element as HTMLElement & { __probe?: boolean }).__probe = true;
	});
	const entrances = () =>
		mainWindow.evaluate(
			() =>
				(window as Window & { __drawerEntrances?: number }).__drawerEntrances,
		);
	await expect.poll(entrances).toBe(1);

	// Browse to the other project, open and close the dropup, toggle edit mode.
	await drawer.locator('[data-compact-switcher-project]').first().click();
	await drawer.locator('[data-compact-switcher-launchers="true"]').click();
	await expect(
		drawer.getByRole('menu', { name: 'New terminal' }),
	).toBeVisible();
	await mainWindow.keyboard.press('Escape');
	const edit = drawer.locator('[data-compact-switcher-edit="true"]');
	await edit.click();
	await expect(edit).toHaveText('Done');
	await edit.click();
	await expect(edit).toHaveText('Edit');

	expect(await entrances()).toBe(1);
	expect(
		await drawer.evaluate(
			(element) =>
				(element as HTMLElement & { __probe?: boolean }).__probe === true,
		),
	).toBe(true);
});

test("a linked folder's ⋯ menu leads with new terminals, carries its context menu, and Escape closes only the menu", async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const root = await repository(createWorkspace, 'drawer-folder-menu', [
		'alpha',
	]);
	await setProjectRoot(mainWindow, root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);

	const more = drawer.getByRole('button', {
		name: 'More for alpha',
		exact: true,
	});
	await more.click();
	const menu = drawer.getByRole('menu', { name: 'alpha actions' });
	await expect(menu).toBeVisible();
	const labels = await menu.getByRole('menuitem').allInnerTexts();
	expect(labels[0]).toMatch(/New Terminal/);
	expect(labels.join('\n')).toMatch(/Delete worktree/);
	// The first entry has focus, so the keyboard can walk the menu.
	await expect(menu.getByRole('menuitem').first()).toBeFocused();

	await mainWindow.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(drawer).toBeVisible();
	await expect(more).toBeFocused();
});

test('Shift+F10 opens a row menu on Open, and dismissing it returns to the row', async ({
	electronApp,
	mainWindow,
}) => {
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);
	const row = drawer.locator('[data-compact-switcher-terminal]').first();
	await row.focus();
	await mainWindow.keyboard.press('Shift+F10');
	const menu = drawer.getByRole('menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'Open' })).toBeFocused();
	await mainWindow.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(row).toBeFocused();
});

test('Move to folder moves a terminal to another folder with its session', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const root = await repository(createWorkspace, 'drawer-move', ['alpha']);
	await setProjectRoot(mainWindow, root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const session = await activeTerminalSessionId(mainWindow);
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);

	const row = folderSection(drawer, 'General')
		.locator('[data-compact-switcher-terminal]')
		.first();
	const key = await row.getAttribute('data-compact-switcher-terminal');
	await row.click({ button: 'right' });
	const menu = drawer.getByRole('menu');
	await menu.getByRole('menuitem', { name: 'alpha' }).click();
	await expect(menu).toHaveCount(0);

	await expect(
		folderSection(drawer, 'alpha').locator(
			`[data-compact-switcher-terminal="${key}"]`,
		),
	).toHaveCount(1);
	await expect(
		folderSection(drawer, 'General').locator(
			'[data-compact-switcher-terminal]',
		),
	).toHaveCount(0);
	// Same panel, same session: the process was never restarted.
	await folderSection(drawer, 'alpha')
		.locator(`[data-compact-switcher-terminal="${key}"]`)
		.click();
	await expect.poll(() => activeTerminalSessionId(mainWindow)).toBe(session);
});

test("removing a folder in edit mode asks over that folder's workspace, and cancelling keeps it", async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	// Removing a worktree always asks, whatever the folder holds.
	const root = await repository(createWorkspace, 'drawer-remove-folder', [
		'alpha',
	]);
	await setProjectRoot(mainWindow, root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);

	await drawer.locator('[data-compact-switcher-edit="true"]').click();
	// General can be reordered but never removed.
	await expect(
		folderSection(drawer, 'General').locator(
			'[data-compact-switcher-remove-folder]',
		),
	).toHaveCount(0);
	await drawer.getByRole('button', { name: 'Delete worktree alpha' }).click();
	await expect(drawer).toHaveCount(0);
	const dialog = deleteDialog(mainWindow);
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);

	const again = await openDrawer(mainWindow);
	await expect(folderSection(again, 'alpha')).toHaveCount(1);
});

test('an empty plain folder removed in edit mode goes without a question', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const workspace = await createWorkspace({ name: 'drawer-remove-plain' });
	await setProjectRoot(mainWindow, workspace.rootDir);
	await createPlainFolder(mainWindow, 'scratch');
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);
	await drawer.locator('[data-compact-switcher-edit="true"]').click();
	await drawer.getByRole('button', { name: 'Delete folder scratch' }).click();
	await expect(drawer).toHaveCount(0);
	await expect(deleteDialog(mainWindow)).toHaveCount(0);
	const again = await openDrawer(mainWindow);
	await expect(folderSection(again, 'scratch')).toHaveCount(0);
});

test('edit-mode reorders of folders and projects are held by the server across a reload', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const root = await repository(createWorkspace, 'drawer-reorder', [
		'alpha',
		'beta',
	]);
	await setProjectRoot(mainWindow, root);
	await expect(folderRow(mainWindow, 'beta')).toBeVisible({ timeout: 10_000 });
	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await resize(mainWindow, electronApp, PHONE);

	let drawer = await openDrawer(mainWindow);
	const projectsBefore = await railTitles(drawer);
	expect(projectsBefore).toHaveLength(2);
	// Present the repository project, the first on the rail.
	await drawer.locator('[data-compact-switcher-project]').first().click();
	expect(await folderLabels(drawer)).toEqual(['General', 'alpha', 'beta']);

	await drawer.locator('[data-compact-switcher-edit="true"]').click();
	await drawer.getByRole('button', { name: 'Reorder beta' }).focus();
	await mainWindow.keyboard.press('ArrowUp');
	await expect
		.poll(() => folderLabels(drawer))
		.toEqual(['General', 'beta', 'alpha']);

	// A rail project's grip is the project itself while editing.
	await drawer.locator('[data-compact-switcher-project]').first().focus();
	await mainWindow.keyboard.press('ArrowDown');
	await expect
		.poll(() => railTitles(drawer))
		.toEqual([...projectsBefore].reverse());

	await mainWindow.reload();
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible({
		timeout: 15_000,
	});
	drawer = await openDrawer(mainWindow);
	await expect
		.poll(() => railTitles(drawer))
		.toEqual([...projectsBefore].reverse());
	await drawer.locator('[data-compact-switcher-project]').last().click();
	await expect
		.poll(() => folderLabels(drawer))
		.toEqual(['General', 'beta', 'alpha']);
});

test('a drag cancelled with Escape commits nothing and leaves the drawer open', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	await appHarness.sendAppCommand('new-terminal');
	await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);
	const titles = () =>
		drawer
			.locator('[data-compact-switcher-terminal] .compact-drawer__row-title')
			.allInnerTexts();
	const before = await titles();
	await drawer.locator('[data-compact-switcher-edit="true"]').click();

	const grip = drawer
		.locator('.compact-drawer__row [data-compact-switcher-grip]')
		.first();
	const box = await grip.boundingBox();
	if (!box) throw new Error('Expected a grip');
	await mainWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await mainWindow.mouse.down();
	await mainWindow.mouse.move(
		box.x + box.width / 2,
		box.y + box.height / 2 + 30,
		{
			steps: 5,
		},
	);
	await mainWindow.mouse.move(
		box.x + box.width / 2,
		box.y + box.height / 2 + 70,
		{
			steps: 5,
		},
	);
	await mainWindow.keyboard.press('Escape');
	await mainWindow.mouse.up();

	await expect(drawer).toBeVisible();
	expect(await titles()).toEqual(before);
});

test('closing a busy terminal from its row menu still asks first', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	const dialogs = await appHarness.dialogs();
	// Keep it running.
	await dialogs.queueConfirm(false);
	const sessionId = await activeTerminalSessionId(mainWindow);
	const marker = `drawer-busy-${Date.now()}`;
	await typeInVisibleTerminal(
		mainWindow,
		`python3 -c "import time; print('${marker}', flush=True); time.sleep(30)"\n`,
		sessionId,
	);
	await expect(
		mainWindow.locator('.terminal-panel:visible .xterm-rows'),
	).toContainText(marker);
	await waitUntilBusy(electronApp, mainWindow);

	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);
	const row = drawer.locator('[data-compact-switcher-terminal]').first();
	await row.click({ button: 'right' });
	await drawer
		.getByRole('menu')
		.getByRole('menuitem', { name: 'Close' })
		.click();
	await expect
		.poll(async () => (await dialogs.getCalls()).map((call) => call.message))
		.toContain('A process is still running in this terminal. Close anyway?');
	// Kept running: the terminal is still listed and the drawer still open.
	await expect(drawer).toBeVisible();
	await expect(drawer.locator('[data-compact-switcher-terminal]')).toHaveCount(
		1,
	);
});

test('with a file in front the title block names the file and carries no dial', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'drawer-file-title',
		seed: { files: { 'notes.txt': 'a file in front\n' } },
	});
	await resize(mainWindow, electronApp, WIDE);
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	await fileExplorerItem(mainWindow, 'notes.txt').dblclick();
	await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1);

	await resize(mainWindow, electronApp, PHONE);
	const breadcrumb = mainWindow.locator('[data-compact-breadcrumb="true"]');
	await expect(breadcrumb.locator('.compact-title__primary')).toHaveText(
		'notes.txt',
	);
	await expect(breadcrumb.locator('.workflow-dial')).toHaveCount(0);
	await expect(breadcrumb).toHaveAccessibleName(
		/^Switch terminal — notes\.txt, General in .+$/,
	);
});

test('a folder header toggles its folder, and Show folder in its ⋯ menu shows it', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const root = await repository(createWorkspace, 'drawer-folder-toggle', [
		'alpha',
	]);
	await setProjectRoot(mainWindow, root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);

	// Pressing the name collapses the folder in place; the drawer stays.
	const general = folderSection(drawer, 'General');
	const header = general.locator('[data-compact-switcher-folder-toggle]');
	const rows = general.locator('[data-compact-switcher-terminal]');
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	await expect(rows).toHaveCount(1);
	await general.locator('.compact-drawer__folder-label').click();
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	await expect(rows).toHaveCount(0);
	await expect(drawer).toBeVisible();
	await general.locator('.compact-drawer__folder-label').click();
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	await expect(rows).toHaveCount(1);

	// Every folder name starts on one line, glyph or no worktree.
	const lefts = await drawer
		.locator('.compact-drawer__folder-label')
		.evaluateAll((labels) =>
			labels.map((label) => Math.round(label.getBoundingClientRect().left)),
		);
	expect(new Set(lefts).size).toBe(1);
	// A row's title sits under its folder's name.
	const titleLeft = await rows
		.first()
		.locator('.compact-drawer__row-title')
		.evaluate((title) => Math.round(title.getBoundingClientRect().left));
	expect(Math.abs(titleLeft - lefts[0])).toBeLessThanOrEqual(1);

	// The empty worktree is shown from its menu.
	await drawer
		.getByRole('button', { name: 'More for alpha', exact: true })
		.click();
	const menu = drawer.getByRole('menu', { name: 'alpha actions' });
	await menu.getByRole('menuitem', { name: 'Show folder' }).click();
	await expect(drawerOf(mainWindow)).toHaveCount(0);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
});

test("a row's ⋯ opens its menu without leaving the terminal on screen", async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	await appHarness.sendAppCommand('new-terminal');
	await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
	const onScreen = await activeTerminalSessionId(mainWindow);
	await resize(mainWindow, electronApp, PHONE);
	const drawer = await openDrawer(mainWindow);

	const more = drawer.locator('[data-compact-switcher-row-menu]').last();
	const box = await more.boundingBox();
	if (!box) throw new Error('Expected a row ⋯ control');
	expect(box.height).toBeGreaterThanOrEqual(44);
	await more.click();
	const menu = drawer.getByRole('menu');
	await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
	expect(await activeTerminalSessionId(mainWindow)).toBe(onScreen);
	await mainWindow.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(more).toBeFocused();
});

test('a press beside the drawer closes the topmost layer first, and the header closes the drawer', async ({
	electronApp,
	mainWindow,
}) => {
	await resize(mainWindow, electronApp, PHONE);
	const pressBeside = async () => {
		const scrim = mainWindow.locator('.compact-drawer-scrim');
		const box = await scrim.boundingBox();
		if (!box) throw new Error('Expected the scrim');
		await mainWindow.mouse.click(
			box.x + box.width - 16,
			box.y + box.height / 2,
		);
	};
	let drawer = await openDrawer(mainWindow);

	// A menu goes first.
	await drawer.locator('[data-compact-switcher-row-menu]').first().click();
	await expect(drawer.getByRole('menu')).toBeVisible();
	await pressBeside();
	await expect(drawer.getByRole('menu')).toHaveCount(0);
	await expect(drawer).toBeVisible();

	// Then an expanded filter.
	await drawer
		.getByRole('button', { name: 'Search terminals and projects' })
		.click();
	const field = drawer.getByRole('searchbox');
	await expect(field).toBeVisible();
	await pressBeside();
	await expect(field).toHaveCount(0);
	await expect(drawer).toBeVisible();

	// Then the drawer.
	await pressBeside();
	await expect(drawerOf(mainWindow)).toHaveCount(0);

	// The header's close control dismisses it whatever it presents.
	drawer = await openDrawer(mainWindow);
	await drawer.locator('[data-compact-switcher-home="true"]').click();
	await drawer.getByRole('button', { name: 'Close switcher' }).click();
	await expect(drawerOf(mainWindow)).toHaveCount(0);
});
