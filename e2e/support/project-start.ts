import { expect, type Locator, type Page } from '@playwright/test';
import { submitTerminalCommand } from './terminal';

/**
 * A project created from the window waits for its start choice (open a
 * folder, the home directory, or a recent folder) before it has a terminal.
 * These helpers drive that chooser the way a person does.
 */

export type ProjectStart = 'home' | { readonly folder: string };

/** The chooser of the project in front, if it is awaiting a start. */
export function activeStartChooser(page: Page): Locator {
	return page.locator(
		'[data-terminay-start-chooser="true"].project-workspace--active',
	);
}

/** The chooser of one project, whether or not it is in front. */
export function startChooserFor(page: Page, projectId: string): Locator {
	return page.locator(
		`[data-terminay-start-chooser="true"][data-terminay-project-id="${projectId}"]`,
	);
}

/** The server folder browser the chooser and the no-root panes open. */
export function rootFolderBrowser(page: Page): Locator {
	return page.locator('[data-in-page-window="root-folder-browser"]');
}

/** Go to a folder in the open browser by typing its path. */
export async function browseToFolder(page: Page, folder: string): Promise<void> {
	const browser = rootFolderBrowser(page);
	await expect(browser).toBeVisible();
	await browser.locator('[data-terminay-root-folder-path]').fill(folder);
	await browser.getByRole('button', { name: 'Go', exact: true }).click();
	await expect(browser.locator('[data-terminay-root-folder-current]')).toHaveText(
		folder,
	);
}

/**
 * Answer the chooser of the project in front and wait until the project has
 * started: the chooser gone and the project's first terminal on screen.
 * Returns the started project's id.
 */
export async function chooseProjectStart(
	page: Page,
	start: ProjectStart = 'home',
): Promise<string> {
	const chooser = activeStartChooser(page);
	await expect(chooser).toBeVisible({ timeout: 15_000 });
	const projectId = await chooser.getAttribute('data-terminay-project-id');
	if (projectId === null) throw new Error('The start chooser names no project');
	if (start === 'home') {
		await chooser.locator('[data-terminay-start-action="home"]').click();
	} else {
		await chooser.locator('[data-terminay-start-action="folder"]').click();
		await browseToFolder(page, start.folder);
		await rootFolderBrowser(page)
			.locator('[data-terminay-root-folder-choose]')
			.click();
		await expect(rootFolderBrowser(page)).toHaveCount(0);
	}
	await expect(startChooserFor(page, projectId)).toHaveCount(0, {
		timeout: 15_000,
	});
	await expect(
		page.locator('.project-workspace--active .terminal-panel:visible'),
	).toHaveCount(1, { timeout: 15_000 });
	return projectId;
}

/**
 * Create a project with the tab bar's control and start it. Returns the new
 * project's id.
 */
export async function createStartedProject(
	page: Page,
	start: ProjectStart = 'home',
): Promise<string> {
	await page.getByLabel('Create project').click();
	return await chooseProjectStart(page, start);
}

/**
 * The physical working directory of the terminal in front, read from the
 * shell itself.
 */
export async function activeTerminalCwd(page: Page): Promise<string> {
	const panel = page.locator('.project-workspace--active .terminal-panel:visible');
	const marker = `cwd-${Date.now().toString(36)}`;
	await submitTerminalCommand(
		page,
		`printf '%s:%s:end\\n' ${marker} "$(pwd -P)"`,
		panel,
	);
	const pattern = new RegExp(`${marker}:(.*?):end`, 'u');
	let cwd: string | undefined;
	await expect
		.poll(
			async () => {
				const text = (await panel.locator('.xterm-rows').innerText()).replace(
					/\n/gu,
					'',
				);
				// The echoed command line holds the marker too, followed by the
				// format string, not a path.
				const matches = [...text.matchAll(new RegExp(pattern, 'gu'))]
					.map((match) => match[1])
					.filter((value) => value.startsWith('/'));
				cwd = matches.at(-1);
				return cwd !== undefined;
			},
			{ timeout: 10_000 },
		)
		.toBe(true);
	if (cwd === undefined) throw new Error('The terminal never printed its cwd');
	return cwd;
}
