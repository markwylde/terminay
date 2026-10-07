import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Locator, Page } from '@playwright/test';
import { expect } from '../fixtures';

const execFileAsync = promisify(execFile);

/** Run Git from the test process, outside every terminal of the app. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(
		'git',
		[
			'-c',
			'user.name=Terminay E2E',
			'-c',
			'user.email=terminay@example.com',
			'-c',
			'commit.gpgsign=false',
			...args,
		],
		{ cwd },
	);
	return stdout;
}

/** Turn a seeded directory into a repository with one commit on `main`. */
export async function initRepository(rootDir: string): Promise<void> {
	await git(rootDir, 'init', '-b', 'main');
	await git(rootDir, 'config', 'user.name', 'Terminay E2E');
	await git(rootDir, 'config', 'user.email', 'terminay@example.com');
	await git(rootDir, 'add', '.');
	await git(rootDir, 'commit', '--allow-empty', '-m', 'initial');
}

/** The Folders tree of the project on screen. */
export function foldersColumn(page: Page): Locator {
	return page.locator(
		'.project-workspace--active [data-terminay-folders-column="true"]',
	);
}

/** One folder of the tree with everything under it: its row, its terminals,
 * its placeholder, and its offer. Matched by the folder's exact name. */
export function folderGroup(page: Page, name: string): Locator {
	return foldersColumn(page)
		.locator('.folders-tree__folder')
		.filter({
			has: page.locator(
				`.folders-tree__row--folder .folders-tree__name:text-is(${JSON.stringify(name)})`,
			),
		});
}

export function folderRow(page: Page, name: string): Locator {
	return folderGroup(page, name).locator('.folders-tree__row--folder');
}

/** The terminal rows listed under a folder, in order. */
export function folderTerminals(page: Page, name: string): Locator {
	return folderGroup(page, name).locator('.folders-tree__row--terminal');
}

/** The names of the folders the tree lists, in order. */
export function folderNames(page: Page): Locator {
	return foldersColumn(page).locator(
		'.folders-tree__row--folder .folders-tree__text > .folders-tree__name',
	);
}

/** The folder whose layout the panel area presents. */
export function activeFolderWorkspace(page: Page): Locator {
	return page.locator('.project-workspace--active');
}

/** Select a folder the way a user does, and wait for its layout to be shown. */
export async function selectFolder(page: Page, name: string): Promise<void> {
	const row = folderRow(page, name);
	await row.locator('.folders-tree__text > .folders-tree__name').click();
	await expect(row).toHaveClass(/folders-tree__row--selected/);
}

/** Open a folder's context menu from its row. */
export async function openFolderMenu(page: Page, name: string): Promise<void> {
	await folderRow(page, name)
		.locator('.folders-tree__text > .folders-tree__name')
		.click({ button: 'right' });
	await expect(page.locator('.context-menu')).toBeVisible();
}

/** The labels of the open context menu, in order. */
export async function contextMenuLabels(page: Page): Promise<string[]> {
	return await page
		.locator('.context-menu .context-menu__item .context-menu__label')
		.allTextContents();
}

function sidebarPane(page: Page, title: string | RegExp): Locator {
	return page.locator('.project-workspace--active .sidebar-pane').filter({
		has: page.locator('.sidebar-pane__title', { hasText: title }),
	});
}

/** The Changes pane of the folder on screen. */
export function changesPane(page: Page): Locator {
	return sidebarPane(page, 'Changes');
}

/** The Files pane of the folder on screen. */
export function filesPane(page: Page): Locator {
	return sidebarPane(page, /^Files/);
}

/** Create a plain folder from the tree's own New folder action. */
export async function createPlainFolder(
	page: Page,
	name: string,
): Promise<void> {
	await foldersColumn(page).getByRole('button', { name: 'New folder' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Folder name' }).fill(name);
	await dialog.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(folderRow(page, name)).toBeVisible();
}

/** The project root as the server holds it, read off the workspace on screen. */
export async function projectRootOnScreen(page: Page): Promise<string | null> {
	return await activeFolderWorkspace(page).getAttribute(
		'data-terminay-project-root',
	);
}
