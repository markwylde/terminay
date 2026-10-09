import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	activeFolderWorkspace,
	changesPane,
	contextMenuLabels,
	createPlainFolder,
	filesPane,
	folderGroup,
	folderNames,
	folderRow,
	folderTerminals,
	foldersColumn,
	git,
	initRepository,
	openFolderMenu,
	projectRootOnScreen,
	selectFolder,
} from './support/folders';
import {
	runShellCommand,
	typeInVisibleTerminal,
} from './support/terminal-input';
import {
	activeTerminalSessionId,
	terminalPanelForSession,
} from './support/terminal-session';
import type { FixtureWorkspace, WorkspaceOptions } from './support/workspace';
import {
	contextMenuItem,
	openFileExplorer,
	setProjectRoot,
} from './support/ui';

/**
 * Folders within a project: General, plain folders, and the folder every Git
 * worktree gets. Each test drives the app as a user does and reads the result
 * off the Folders tree, the panel area, and the sidebar.
 */

// Several of these walk a whole flow: a repository, a few terminals, a
// settings change, a reload. They need longer than one short interaction.
test.describe.configure({ timeout: 90_000 });

type Repository = {
	/** The checkout a project is rooted at. */
	root: string;
	/** Where a worktree directory of this name lives, beside the checkout. */
	worktree: (directory: string) => string;
};

/**
 * A repository with one commit on `main`, and one worktree per name: on a
 * branch of that name, in a directory `<name>-tree` beside the checkout. A
 * linked folder is named by its branch, so a folder here is called `<name>`
 * and never by its directory.
 */
async function repository(
	createWorkspace: (options?: WorkspaceOptions) => Promise<FixtureWorkspace>,
	name: string,
	worktrees: readonly string[] = [],
): Promise<Repository> {
	const base = await realpath((await createWorkspace({ name })).rootDir);
	const root = join(base, 'main');
	await mkdir(root);
	await writeFile(join(root, 'README.md'), '# Main checkout\n', 'utf8');
	await initRepository(root);
	for (const directory of worktrees)
		await git(
			root,
			'worktree',
			'add',
			'-b',
			directory,
			join(base, `${directory}-tree`),
		);
	return { root, worktree: (directory) => join(base, `${directory}-tree`) };
}

/** An entry of the Files pane of the folder on screen. Every folder a device
 * has visited keeps its own tree mounted, so the pane is named, not guessed. */
const fileItem = (page: Page, name: string): Locator =>
	page
		.locator('.project-workspace--active .file-explorer-tree-item')
		.filter({ hasText: name });

const terminalOutput = (page: Page): Locator =>
	page.locator('.project-workspace--active .terminal-panel:visible .xterm-rows');

async function run(page: Page, command: string): Promise<void> {
	await runShellCommand(page, command);
}

/**
 * Ask the terminal on screen whether it is in `directory`. The answer is a
 * word the typed command does not itself contain, so the echo of the command
 * cannot pass for it.
 */
async function expectTerminalIn(
	page: Page,
	directory: string,
	token: string,
): Promise<void> {
	await run(
		page,
		`[ "$PWD" = "${directory}" ] && printf '${token}-%s\\n' confirmed`,
	);
	await expect(terminalOutput(page)).toContainText(`${token}-confirmed`);
}

/** The row of the Folders tree for one terminal session, wherever it is. */
const terminalRowOf = (page: Page, sessionId: string): Locator =>
	foldersColumn(page).locator(
		`[data-folder-terminal-session="${sessionId}"]`,
	);

/** The row for a terminal session, only if it is listed under this folder. */
const terminalRowIn = (page: Page, folder: string, sessionId: string): Locator =>
	folderGroup(page, folder).locator(
		`[data-folder-terminal-session="${sessionId}"]`,
	);

/** The last row of a folder's card: a terminal in that folder. */
const newTerminalRow = (page: Page, folder: string): Locator =>
	folderGroup(page, folder).getByRole('button', {
		name: `New terminal in ${folder}`,
		exact: true,
	});

/** The colour a dirty checkout's branch is drawn in. */
const ACCENT = 'rgb(226, 164, 95)';

/** What a card says its checkout's branch with: General's branch line, and a
 * linked folder's own name. */
const CHECKOUT_NAME =
	'.folders-tree__branch, .folders-tree__label > .folders-tree__name';

/** The tooltip of a linked folder's details, wherever it is drawn. */
const detailsTooltip = (page: Page): Locator =>
	page.locator('.folders-tree-details');

/** The lines of a folder's card that only a Git checkout has. */
const gitLines = (page: Page, folder: string): Locator =>
	folderRow(page, folder).locator(
		'.folders-tree__branch, .folders-tree__facts',
	);

/** Anything on screen saying that a terminal was moved into a worktree's
 * folder. The tree shows such a move and nothing says it. */
const movedAnnouncement = (page: Page): Locator =>
	page.getByText(/into the folder for its new worktree/);

/**
 * Drag a terminal's tree row onto a folder's card. Chromium can drop a
 * synthetic drag while the renderer is busy, so each attempt is one whole
 * gesture and the outcome is for the caller to assert strictly afterwards.
 */
async function dragTerminalToFolder(
	page: Page,
	sessionId: string,
	folder: string,
): Promise<void> {
	let moved = false;
	for (let attempt = 0; attempt < 4 && !moved; attempt += 1) {
		await terminalRowOf(page, sessionId).dragTo(folderRow(page, folder));
		moved = await terminalRowIn(page, folder, sessionId)
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(
				() => true,
				() => false,
			);
	}
}

/** Drag the Folders column's separator until the column is `width` wide. */
async function setFoldersWidth(page: Page, width: number): Promise<number> {
	const column = foldersColumn(page);
	const separator = page.locator(
		'.project-workspace--active .workspace-split-layout__folders-separator',
	);
	const box = await column.boundingBox();
	const handle = await separator.boundingBox();
	if (box === null || handle === null)
		throw new Error('The Folders column is not on screen.');
	const y = handle.y + handle.height / 2;
	await page.mouse.move(handle.x + handle.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + width, y, { steps: 6 });
	await page.mouse.up();
	await expect
		.poll(async () =>
			Math.abs(((await column.boundingBox())?.width ?? 0) - width),
		)
		.toBeLessThan(8);
	return (await column.boundingBox())?.width ?? 0;
}

/**
 * Press a folder's grip, carry it to a point on the page, and let it go there.
 * The pointer is moved a step at a time, as a hand moves it: which way a card
 * is going is read from how the pointer has been travelling. `whileHeld` runs
 * part of the way there, with the card still in the hand.
 */
async function dragGripTo(
	page: Page,
	folder: string,
	to: { x: number; y: number },
	whileHeld?: (pointer: { x: number; y: number }) => Promise<void>,
): Promise<void> {
	const grip = await folderRow(page, folder)
		.locator('.folders-tree__grip')
		.boundingBox();
	if (grip === null) throw new Error(`${folder} has no grip.`);
	const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	const steps = 16;
	for (let step = 1; step <= steps; step += 1) {
		const pointer = {
			x: from.x + ((to.x - from.x) * step) / steps,
			y: from.y + ((to.y - from.y) * step) / steps,
		};
		await page.mouse.move(pointer.x, pointer.y);
		await page.waitForTimeout(20);
		if (step === 6) await whileHeld?.(pointer);
	}
	await page.mouse.up();
}

const placeholder = (page: Page): Locator =>
	activeFolderWorkspace(page).locator('[data-terminay-folder-empty="true"]');

/** Create a terminal in the folder on screen and return its session. */
async function newTerminalHere(
	page: Page,
	sendAppCommand: (command: 'new-terminal') => Promise<void>,
	folder: string,
): Promise<string> {
	const before = await folderTerminals(page, folder).count();
	await sendAppCommand('new-terminal');
	await expect(folderTerminals(page, folder)).toHaveCount(before + 1);
	const sessionId = await activeTerminalSessionId(page);
	await expect(terminalRowIn(page, folder, sessionId)).toHaveCount(1);
	return sessionId;
}

const panelsQuestion = (page: Page): Locator =>
	page.getByRole('dialog').filter({ hasText: 'still holds' });

const sessionsUnder = async (page: Page, folder: string): Promise<string[]> =>
	(
		await folderTerminals(page, folder).evaluateAll((rows) =>
			rows.map((row) => row.getAttribute('data-folder-terminal-session') ?? ''),
		)
	).sort();

test('a repository project shows General and a linked folder per worktree with its branch; a project with no repository shows only General', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-tree', ['alpha', 'beta']);
	const notes = await createWorkspace({
		name: 'lf-notes',
		seed: { files: { 'notes.txt': 'no repository here\n' } },
	});

	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await expect(folderRow(mainWindow, 'beta')).toBeVisible();
	// General first, then one linked folder per worktree, and nothing else.
	await expect(folderNames(mainWindow)).toHaveCount(3);
	await expect(folderNames(mainWindow).first()).toHaveText('General');
	const branchOf = (folder: string) =>
		folderRow(mainWindow, folder).locator('.folders-tree__branch');
	await expect(branchOf('General')).toHaveText('main');
	// A linked folder is named by its branch and says it once: no branch
	// line of its own, and its directory is nowhere on the card.
	for (const linked of ['alpha', 'beta']) {
		await expect(branchOf(linked)).toHaveCount(0);
		await expect(folderRow(mainWindow, linked)).not.toContainText(
			`${linked}-tree`,
		);
	}
	// The project's first terminal is in General; a worktree nobody has
	// opened a terminal in says so.
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'alpha')).toHaveCount(0);
	await expect(newTerminalRow(mainWindow, 'alpha')).toBeVisible();

	await appHarness.sendAppCommand('new-project');
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	await setProjectRoot(mainWindow, notes.rootDir);
	await openFileExplorer(mainWindow);
	await expect(fileItem(mainWindow, 'notes.txt')).toBeVisible();
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	// No branch line, and nothing Git-shaped anywhere on the card.
	await expect(gitLines(mainWindow, 'General')).toHaveCount(0);
	await expect(
		changesPane(mainWindow).locator('.git-panel__message'),
	).toHaveText('This folder is not in a Git repository', { timeout: 6000 });
	// A listing has arrived by now, so the absence of a branch is not a wait.
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	await expect(gitLines(mainWindow, 'General')).toHaveCount(0);
});

test('selecting a linked folder shows its worktree in Files and Changes, General shows the project root, and the root never changes', async ({
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-select', ['alpha']);
	await writeFile(join(repo.root, 'only-in-main.txt'), 'main\n', 'utf8');
	await writeFile(
		join(repo.worktree('alpha'), 'only-in-alpha.txt'),
		'alpha\n',
		'utf8',
	);

	await setProjectRoot(mainWindow, repo.root);
	await openFileExplorer(mainWindow);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const root = await projectRootOnScreen(mainWindow);
	expect(root).toBe(repo.root);

	const changed = (name: string) =>
		changesPane(mainWindow).locator('.git-panel__row').filter({ hasText: name });

	// General: the project root's files and the root checkout's changes.
	await expect(filesPane(mainWindow).locator('.sidebar-pane__title')).toHaveText(
		'Files',
	);
	await expect(fileItem(mainWindow, 'only-in-main.txt')).toBeVisible();
	await expect(fileItem(mainWindow, 'only-in-alpha.txt')).toHaveCount(0);
	await expect(
		changesPane(mainWindow).locator('.changes-pane__branch-name'),
	).toHaveText('main', { timeout: 6000 });
	await expect(changed('only-in-main.txt')).toBeVisible();
	await expect(changed('only-in-alpha.txt')).toHaveCount(0);

	// The linked folder: its worktree's files and its worktree's changes, and
	// the Files pane says whose they are.
	await selectFolder(mainWindow, 'alpha');
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect(filesPane(mainWindow).locator('.sidebar-pane__title')).toHaveText(
		'Files — alpha',
	);
	await expect(fileItem(mainWindow, 'only-in-alpha.txt')).toBeVisible();
	await expect(fileItem(mainWindow, 'only-in-main.txt')).toHaveCount(0);
	await expect(
		changesPane(mainWindow).locator('.changes-pane__branch-name'),
	).toHaveText('alpha', { timeout: 6000 });
	await expect(changed('only-in-alpha.txt')).toBeVisible();
	await expect(changed('only-in-main.txt')).toHaveCount(0);
	expect(await projectRootOnScreen(mainWindow)).toBe(root);

	// And back again.
	await selectFolder(mainWindow, 'General');
	await expect(fileItem(mainWindow, 'only-in-main.txt')).toBeVisible();
	await expect(fileItem(mainWindow, 'only-in-alpha.txt')).toHaveCount(0);
	await expect(changed('only-in-main.txt')).toBeVisible();
	await expect(changed('only-in-alpha.txt')).toHaveCount(0);
	expect(await projectRootOnScreen(mainWindow)).toBe(root);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('a terminal created while a linked folder is selected lands in that folder and starts in its worktree', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-launch', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await openFileExplorer(mainWindow);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const generalSession = await activeTerminalSessionId(mainWindow);

	await selectFolder(mainWindow, 'alpha');
	const sessionId = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'alpha',
	);
	expect(sessionId).not.toBe(generalSession);
	// It is in the linked folder and in no other.
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	await expect(terminalRowIn(mainWindow, 'General', generalSession)).toHaveCount(
		1,
	);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expectTerminalIn(mainWindow, repo.worktree('alpha'), 'cwd');

	// A file the terminal writes there is a change of that folder only.
	await run(mainWindow, "printf 'made here\\n' > made-in-terminal.txt");
	const made = () =>
		changesPane(mainWindow)
			.locator('.git-panel__row')
			.filter({ hasText: 'made-in-terminal.txt' });
	await expect(made()).toBeVisible({ timeout: 10_000 });
	await selectFolder(mainWindow, 'General');
	await expect(
		changesPane(mainWindow).locator('.git-panel__message'),
	).toHaveText('No changes', { timeout: 6000 });
	await expect(made()).toHaveCount(0);
});

test('a terminal in an unselected folder keeps running, and switching folders closes no terminal', async ({
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-background', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const sessionId = await activeTerminalSessionId(mainWindow);

	// Prints for about three seconds. The first tick is seen here; the last is
	// printed while another folder is on screen.
	await run(
		mainWindow,
		"for n in 1 2 3 4 5 6; do printf 'tick-%s-of-6\\n' \"$n\"; sleep 0.5; done",
	);
	await expect(terminalOutput(mainWindow)).toContainText('tick-1-of-6');
	await expect(terminalOutput(mainWindow)).not.toContainText('tick-6-of-6');

	await selectFolder(mainWindow, 'alpha');
	await expect(placeholder(mainWindow)).toBeVisible();
	// The terminal is still a terminal of General, and is not on screen.
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	await expect(terminalPanelForSession(mainWindow, sessionId)).toBeHidden();
	// Long enough for the loop to finish with nobody looking.
	await mainWindow.waitForTimeout(4_500);
	await expect(terminalPanelForSession(mainWindow, sessionId)).toBeHidden();

	await selectFolder(mainWindow, 'General');
	expect(await activeTerminalSessionId(mainWindow)).toBe(sessionId);
	// Already there on return: it was printed while the folder was not selected.
	await expect(terminalOutput(mainWindow)).toContainText('tick-6-of-6', {
		timeout: 1_500,
	});
	await expect(terminalOutput(mainWindow)).toContainText('tick-1-of-6');
	// The same shell, still answering.
	await run(mainWindow, "printf 'still-%s\\n' running");
	await expect(terminalOutput(mainWindow)).toContainText('still-running');
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
});

test('closing the last panel leaves the project open with a placeholder whose New terminal creates one in that folder', async ({
	appHarness,
	mainWindow,
}) => {
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	const first = await activeTerminalSessionId(mainWindow);

	await appHarness.sendAppCommand('close-active');

	await expect(placeholder(mainWindow)).toBeVisible();
	await expect(placeholder(mainWindow)).toContainText('General');
	await expect(placeholder(mainWindow)).toContainText(
		'No terminals are open in this folder.',
	);
	// The project is still open, with its tree and its sidebar toggle.
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await expect(mainWindow.locator('.project-tab--active')).toHaveCount(1);
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(0);
	await expect(newTerminalRow(mainWindow, 'General')).toBeVisible();
	await openFileExplorer(mainWindow);

	await placeholder(mainWindow)
		.getByRole('button', { name: /New terminal/ })
		.click();

	await expect(placeholder(mainWindow)).toHaveCount(0);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	const second = await activeTerminalSessionId(mainWindow);
	expect(second).not.toBe(first);
	await expect(terminalRowIn(mainWindow, 'General', second)).toHaveCount(1);
	await run(mainWindow, "printf 'fresh-%s\\n' terminal");
	await expect(terminalOutput(mainWindow)).toContainText('fresh-terminal');
});

test('a terminal dragged into a new plain folder is still there after a reload, and its tab menu moves it back', async ({
	mainWindow,
}) => {
	const sessionId = await activeTerminalSessionId(mainWindow);
	await run(mainWindow, "printf 'before-%s\\n' the-move");
	await expect(terminalOutput(mainWindow)).toContainText('before-the-move');

	await createPlainFolder(mainWindow, 'Servers');
	await expect(folderNames(mainWindow)).toHaveText(['General', 'Servers']);
	await expect(folderTerminals(mainWindow, 'Servers')).toHaveCount(0);
	await expect(newTerminalRow(mainWindow, 'Servers')).toBeVisible();

	await dragTerminalToFolder(mainWindow, sessionId, 'Servers');
	await expect(terminalRowIn(mainWindow, 'Servers', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(0);
	// The device that asked for the move is shown the folder and the terminal.
	await expect(folderRow(mainWindow, 'Servers')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'plain',
	);
	expect(await activeTerminalSessionId(mainWindow)).toBe(sessionId);
	// The same terminal: its scrollback came with it and its shell answers.
	await expect(terminalOutput(mainWindow)).toContainText('before-the-move');
	await run(mainWindow, "printf 'after-%s\\n' the-move");
	await expect(terminalOutput(mainWindow)).toContainText('after-the-move');

	await mainWindow.reload();
	await expect(folderNames(mainWindow)).toHaveText(['General', 'Servers']);
	await expect(terminalRowIn(mainWindow, 'Servers', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(0);
	// The folder this device had selected is still the one on screen.
	await expect(folderRow(mainWindow, 'Servers')).toHaveClass(
		/folders-tree__row--selected/,
	);
	expect(await activeTerminalSessionId(mainWindow)).toBe(sessionId);

	// The other way to move a panel: choose the folder from its tab's menu.
	await mainWindow
		.locator('.project-workspace--active .terminal-tab-content')
		.first()
		.click({ button: 'right' });
	await contextMenuItem(mainWindow, 'Move to folder').click();
	await mainWindow
		.locator('.context-menu__item')
		.filter({ hasText: /^General$/ })
		.click();
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'Servers')).toHaveCount(0);
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	expect(await activeTerminalSessionId(mainWindow)).toBe(sessionId);
});

test('folder context menus offer what each kind of folder can do, and Open shell in folder starts in the worktree', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-menus', ['alpha']);
	const notes = await createWorkspace({ name: 'lf-menus-notes' });
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await expect(
		folderRow(mainWindow, 'General').locator('.folders-tree__branch'),
	).toHaveText('main');
	await createPlainFolder(mainWindow, 'Servers');

	const menuOf = async (folder: string): Promise<string[]> => {
		await openFolderMenu(mainWindow, folder);
		const labels = await contextMenuLabels(mainWindow);
		await mainWindow.keyboard.press('Escape');
		await expect(mainWindow.locator('.context-menu')).toHaveCount(0);
		return labels;
	};

	// A linked folder has no name of its own to change.
	expect(await menuOf('alpha')).toEqual([
		'Commit & push with AI…',
		'Pull from origin',
		'Rename worktree',
		'Delete worktree',
		'Copy path',
		'Copy relative path',
		'Open shell in folder',
		'Reveal in OS',
	]);
	expect(await menuOf('General')).toEqual([
		'Commit & push with AI…',
		'Pull from origin',
		'Copy path',
		'Copy relative path',
		'Open shell in folder',
		'Reveal in OS',
	]);
	// A plain folder is the project root with no Git meaning of its own.
	expect(await menuOf('Servers')).toEqual([
		'Rename folder',
		'Delete folder',
		'Copy path',
		'Open shell in folder',
		'Reveal in OS',
	]);

	// Open shell in folder: a terminal in that folder, in its worktree.
	await expect(folderTerminals(mainWindow, 'alpha')).toHaveCount(0);
	await openFolderMenu(mainWindow, 'alpha');
	await contextMenuItem(mainWindow, 'Open shell in folder').click();
	await expect(folderTerminals(mainWindow, 'alpha')).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	await expect(folderRow(mainWindow, 'alpha')).toHaveClass(
		/folders-tree__row--selected/,
	);
	const shellSession = await activeTerminalSessionId(mainWindow);
	await expect(terminalRowIn(mainWindow, 'alpha', shellSession)).toHaveCount(1);
	await expectTerminalIn(mainWindow, repo.worktree('alpha'), 'shell');

	// A project with no repository: General offers no Git action, and can
	// still be copied, opened, and shown in the file manager.
	await appHarness.sendAppCommand('new-project');
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	await setProjectRoot(mainWindow, notes.rootDir);
	await openFileExplorer(mainWindow);
	await expect(
		changesPane(mainWindow).locator('.git-panel__message'),
	).toHaveText('This folder is not in a Git repository', { timeout: 6000 });
	expect(await menuOf('General')).toEqual([
		'Copy path',
		'Open shell in folder',
		'Reveal in OS',
	]);
	await createPlainFolder(mainWindow, 'Scratch');
	expect(await menuOf('Scratch')).toEqual([
		'Rename folder',
		'Delete folder',
		'Copy path',
		'Open shell in folder',
		'Reveal in OS',
	]);
	// The host is asked to show the folder by its id, and does not refuse.
	await openFolderMenu(mainWindow, 'General');
	await contextMenuItem(mainWindow, 'Reveal in OS').click();
	await openFolderMenu(mainWindow, 'Scratch');
	await contextMenuItem(mainWindow, 'Reveal in OS').click();
	await mainWindow.waitForTimeout(500);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('deleting a plain folder that holds terminals asks to move them, close them, or cancel', async ({
	appHarness,
	mainWindow,
}) => {
	const generalSession = await activeTerminalSessionId(mainWindow);
	const fill = async (folder: string): Promise<string[]> => {
		await createPlainFolder(mainWindow, folder);
		await selectFolder(mainWindow, folder);
		const first = await newTerminalHere(
			mainWindow,
			appHarness.sendAppCommand,
			folder,
		);
		const second = await newTerminalHere(
			mainWindow,
			appHarness.sendAppCommand,
			folder,
		);
		return [first, second].sort();
	};
	const askToDelete = async (folder: string): Promise<void> => {
		await openFolderMenu(mainWindow, folder);
		await contextMenuItem(mainWindow, 'Delete folder').click();
		await expect(panelsQuestion(mainWindow)).toBeVisible();
		await expect(panelsQuestion(mainWindow)).toContainText(
			`${folder} still holds 2 panels`,
		);
	};

	const moved = await fill('Movers');
	const closed = await fill('Closers');
	await expect(folderNames(mainWindow)).toHaveText([
		'General',
		'Movers',
		'Closers',
	]);

	// Cancel: nothing has changed.
	await askToDelete('Movers');
	await panelsQuestion(mainWindow)
		.getByRole('button', { name: 'Cancel' })
		.click();
	await expect(panelsQuestion(mainWindow)).toHaveCount(0);
	await expect(folderNames(mainWindow)).toHaveText([
		'General',
		'Movers',
		'Closers',
	]);
	expect(await sessionsUnder(mainWindow, 'Movers')).toEqual(moved);
	expect(await sessionsUnder(mainWindow, 'General')).toEqual([generalSession]);

	// Move to General: both terminals are in General, running, and the folder
	// is gone.
	await askToDelete('Movers');
	await panelsQuestion(mainWindow)
		.getByRole('button', { name: 'Move to General' })
		.click();
	await expect(folderRow(mainWindow, 'Movers')).toHaveCount(0);
	await expect(folderNames(mainWindow)).toHaveText(['General', 'Closers']);
	await expect
		.poll(() => sessionsUnder(mainWindow, 'General'))
		.toEqual([generalSession, ...moved].sort());
	for (const sessionId of moved) {
		await terminalRowOf(mainWindow, sessionId).click();
		await expect(terminalPanelForSession(mainWindow, sessionId)).toBeVisible();
		await typeInVisibleTerminal(
			mainWindow,
			"printf 'moved-%s\\n' alive\n",
			sessionId,
		);
		await expect(
			terminalPanelForSession(mainWindow, sessionId).locator('.xterm-rows'),
		).toContainText('moved-alive');
	}

	// Close them: both terminals are closed and the folder is gone.
	await askToDelete('Closers');
	await panelsQuestion(mainWindow)
		.getByRole('button', { name: 'Close them' })
		.click();
	await expect(folderRow(mainWindow, 'Closers')).toHaveCount(0);
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	for (const sessionId of closed) {
		await expect(terminalRowOf(mainWindow, sessionId)).toHaveCount(0);
		await expect(terminalPanelForSession(mainWindow, sessionId)).toHaveCount(0);
	}
	expect(await sessionsUnder(mainWindow, 'General')).toEqual(
		[generalSession, ...moved].sort(),
	);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('deleting a worktree whose folder holds a terminal asks about the terminal first', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-delete-worktree', [
		'alpha',
	]);
	const dialogs = await appHarness.dialogs();
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await selectFolder(mainWindow, 'alpha');
	const sessionId = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'alpha',
	);
	// Leave the worktree directory, so nothing but the question is in the way.
	await run(mainWindow, `cd "${repo.root}"`);

	// Cancel the question: the worktree's own confirmation is never reached.
	await dialogs.clearCalls();
	await openFolderMenu(mainWindow, 'alpha');
	await contextMenuItem(mainWindow, 'Delete worktree').click();
	await expect(panelsQuestion(mainWindow)).toBeVisible();
	await expect(panelsQuestion(mainWindow)).toContainText(
		'alpha still holds 1 panel',
	);
	await expect(
		panelsQuestion(mainWindow).getByRole('button', { name: 'Close them' }),
	).toBeVisible();
	await panelsQuestion(mainWindow)
		.getByRole('button', { name: 'Cancel' })
		.click();
	await expect(panelsQuestion(mainWindow)).toHaveCount(0);
	expect(
		(await dialogs.getCalls()).filter((call) => call.kind === 'confirm'),
	).toHaveLength(0);
	await expect(terminalRowIn(mainWindow, 'alpha', sessionId)).toHaveCount(1);
	expect(await git(repo.root, 'worktree', 'list', '--porcelain')).toContain(
		repo.worktree('alpha'),
	);

	// Move the terminal, then confirm the removal: the terminal is in General
	// and the worktree and its folder are gone.
	await dialogs.clearCalls();
	await dialogs.queueConfirm(true);
	await openFolderMenu(mainWindow, 'alpha');
	await contextMenuItem(mainWindow, 'Delete worktree').click();
	await panelsQuestion(mainWindow)
		.getByRole('button', { name: 'Move to General' })
		.click();
	await expect(folderRow(mainWindow, 'alpha')).toHaveCount(0, {
		timeout: 10_000,
	});
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	expect(
		(await dialogs.getCalls()).filter((call) => call.kind === 'confirm'),
	).toHaveLength(1);
	expect(
		await git(repo.root, 'worktree', 'list', '--porcelain'),
	).not.toContain(repo.worktree('alpha'));
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('a worktree being deleted says Deleting… on its card until it is gone', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-deleting-card', [
		'alpha',
		'beta',
	]);
	const dialogs = await appHarness.dialogs();
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await expect(folderRow(mainWindow, 'beta')).toBeVisible();
	await expect(
		foldersColumn(mainWindow).locator('.folders-tree__deleting'),
	).toHaveCount(0);

	// A small worktree is removed faster than a look at the card can be timed,
	// so every card that says it is being deleted is written down as it does.
	await mainWindow.evaluate(() => {
		const seen: string[] = [];
		(window as unknown as { __deletingCards: string[] }).__deletingCards = seen;
		const record = () => {
			for (const line of document.querySelectorAll('.folders-tree__deleting')) {
				const row = line.closest('.folders-tree__row--folder');
				const name = row?.querySelector('.folders-tree__name')?.textContent;
				seen.push(
					`${name}|${line.textContent}|${row?.getAttribute('aria-busy')}`,
				);
			}
		};
		new MutationObserver(record).observe(document.body, {
			childList: true,
			subtree: true,
		});
	});

	await dialogs.queueConfirm(true);
	await openFolderMenu(mainWindow, 'alpha');
	await contextMenuItem(mainWindow, 'Delete worktree').click();
	await expect(folderRow(mainWindow, 'alpha')).toHaveCount(0, {
		timeout: 10_000,
	});

	const seen = await mainWindow.evaluate(
		() => (window as unknown as { __deletingCards: string[] }).__deletingCards,
	);
	// Only the worktree that was deleted said so, and nothing says so now.
	expect(new Set(seen)).toEqual(new Set(['alpha|Deleting…|true']));
	await expect(
		foldersColumn(mainWindow).locator('.folders-tree__deleting'),
	).toHaveCount(0);
	await expect(folderRow(mainWindow, 'beta')).toBeVisible();
	expect(
		await git(repo.root, 'worktree', 'list', '--porcelain'),
	).not.toContain(repo.worktree('alpha'));
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('a terminal that runs git worktree add is moved into the new folder with nothing announced, stays in General once dragged back, and is offered the move when the setting is off', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-capture');
	await setProjectRoot(mainWindow, repo.root);
	// The project has settled on its repository before anything is created,
	// so the worktree below is one that appeared, not one that was found.
	await expect(
		folderRow(mainWindow, 'General').locator('.folders-tree__branch'),
	).toHaveText('main', { timeout: 10_000 });
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	const sessionId = await activeTerminalSessionId(mainWindow);
	await run(mainWindow, `cd "${repo.root}"`);

	// Typed at the prompt: the terminal's own Git tells the server who ran it.
	await run(mainWindow, 'git worktree add ../cap-one -b cap-one');

	await expect(folderRow(mainWindow, 'cap-one')).toBeVisible({
		timeout: 15_000,
	});
	await expect(terminalRowIn(mainWindow, 'cap-one', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(0);
	// The window is still showing that terminal, now in its new folder.
	await expect(folderRow(mainWindow, 'cap-one')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect(terminalPanelForSession(mainWindow, sessionId)).toBeVisible();
	expect(await activeTerminalSessionId(mainWindow)).toBe(sessionId);
	// The tree is what shows the move. Nothing announces it.
	await expect(movedAnnouncement(mainWindow)).toHaveCount(0);
	await mainWindow.waitForTimeout(1_000);
	await expect(movedAnnouncement(mainWindow)).toHaveCount(0);

	// Dragged back onto General, it is in General, and it stays there: the
	// terminal goes on running Git and is not moved again.
	await dragTerminalToFolder(mainWindow, sessionId, 'General');
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'cap-one')).toHaveCount(0);
	await expect(newTerminalRow(mainWindow, 'cap-one')).toBeVisible();
	await expect(terminalPanelForSession(mainWindow, sessionId)).toBeVisible();
	await run(mainWindow, "git status --short && printf 'still-%s\\n' here");
	await expect(terminalOutput(mainWindow)).toContainText('still-here');
	await mainWindow.waitForTimeout(2_000);
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'cap-one')).toHaveCount(0);

	// With the setting off the folder still appears, and offers the move.
	const settings = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'shell-lifecycle',
	});
	const toggle = settings
		.getByLabel('Move terminals into new worktree folders')
		.locator('input[type="checkbox"]');
	await expect(toggle).toBeChecked();
	await toggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(toggle).not.toBeChecked();
	await settings.close();

	await terminalRowOf(mainWindow, sessionId).click();
	await expect(terminalPanelForSession(mainWindow, sessionId)).toBeVisible();
	await run(mainWindow, 'git worktree add ../cap-two -b cap-two');

	const offered = folderGroup(mainWindow, 'cap-two');
	await expect(offered).toBeVisible({ timeout: 15_000 });
	await expect(offered.locator('.folders-tree__offer')).toContainText(
		'created this worktree',
	);
	await expect(
		offered.getByRole('button', { name: 'Not now' }),
	).toBeVisible();
	// Nothing moved: the terminal is in General, tagged with what it created.
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'cap-two')).toHaveCount(0);
	await expect(
		terminalRowOf(mainWindow, sessionId).locator('.folders-tree__tag'),
	).toHaveText('cap-two');
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(movedAnnouncement(mainWindow)).toHaveCount(0);

	await offered.getByRole('button', { name: 'Move it here' }).click();
	await expect(terminalRowIn(mainWindow, 'cap-two', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(0);
	await expect(offered.locator('.folders-tree__offer')).toHaveCount(0);
});

test('a worktree added outside the app gets an empty folder, and removing it outside moves its terminal to General still running', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-outside');
	await setProjectRoot(mainWindow, repo.root);
	await expect(
		folderRow(mainWindow, 'General').locator('.folders-tree__branch'),
	).toHaveText('main', { timeout: 10_000 });
	const generalSession = await activeTerminalSessionId(mainWindow);

	// Git run by the test process: no terminal of the project created this.
	await git(
		repo.root,
		'worktree',
		'add',
		'-b',
		'feat/outside',
		repo.worktree('outside'),
	);

	await expect(folderRow(mainWindow, 'feat/outside')).toBeVisible({
		timeout: 15_000,
	});
	await expect(folderTerminals(mainWindow, 'feat/outside')).toHaveCount(0);
	await expect(newTerminalRow(mainWindow, 'feat/outside')).toBeVisible();
	// No terminal moved, nothing is offered, and nothing is announced.
	await expect(terminalRowIn(mainWindow, 'General', generalSession)).toHaveCount(
		1,
	);
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(
		folderGroup(mainWindow, 'feat/outside').locator('.folders-tree__offer'),
	).toHaveCount(0);
	await expect(movedAnnouncement(mainWindow)).toHaveCount(0);
	await mainWindow.waitForTimeout(1_500);
	await expect(folderTerminals(mainWindow, 'feat/outside')).toHaveCount(0);

	// A terminal in the worktree's folder, with something still to say.
	await selectFolder(mainWindow, 'feat/outside');
	const sessionId = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'feat/outside',
	);
	await run(mainWindow, "cd / && printf 'before-%s\\n' removal");
	await expect(terminalOutput(mainWindow)).toContainText('before-removal');

	await git(repo.root, 'worktree', 'remove', '--force', repo.worktree('outside'));

	await expect(folderRow(mainWindow, 'feat/outside')).toHaveCount(0, {
		timeout: 15_000,
	});
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(2);
	// The same terminal, still running: its scrollback is there and it answers.
	await terminalRowOf(mainWindow, sessionId).click();
	const moved = terminalPanelForSession(mainWindow, sessionId);
	await expect(moved).toBeVisible();
	await expect(moved.locator('.xterm-rows')).toContainText('before-removal');
	await typeInVisibleTerminal(
		mainWindow,
		"printf 'after-%s\\n' removal\n",
		sessionId,
	);
	await expect(moved.locator('.xterm-rows')).toContainText('after-removal');
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('the Folders tree and the sidebar hide independently, and each choice survives a reload', async ({
	mainWindow,
}) => {
	const column = () => foldersColumn(mainWindow);
	const sidebar = () =>
		mainWindow.locator('.project-workspace--active .file-explorer-sidebar');
	const toggleFolders = mainWindow.getByLabel('Toggle folders');
	const toggleSidebar = mainWindow.getByLabel('Toggle file explorer');

	// A device with no preference shows the Folders tree.
	await expect(column()).toBeVisible();
	const sidebarWasOpen = await sidebar().isVisible();
	if (sidebarWasOpen) await toggleSidebar.click();
	await expect(sidebar()).toHaveCount(0);

	// Hide the tree: the sidebar is not affected.
	await toggleFolders.click();
	await expect(column()).toHaveCount(0);
	await expect(sidebar()).toHaveCount(0);
	// Show the sidebar: the tree stays hidden.
	await toggleSidebar.click();
	await expect(sidebar()).toBeVisible();
	await expect(column()).toHaveCount(0);
	// The sidebar is on the trailing side of the panel area.
	const panelBox = await mainWindow
		.locator('.project-workspace--active .workspace')
		.boundingBox();
	const sidebarBox = await sidebar().boundingBox();
	if (!panelBox || !sidebarBox) throw new Error('Expected layout boxes');
	expect(sidebarBox.x).toBeGreaterThanOrEqual(panelBox.x + panelBox.width - 1);

	await mainWindow.reload();
	await expect(sidebar()).toBeVisible();
	await expect(column()).toHaveCount(0);

	// The other way round: tree shown, sidebar hidden.
	await toggleFolders.click();
	await expect(column()).toBeVisible();
	await expect(sidebar()).toBeVisible();
	const columnBox = await column().boundingBox();
	const panelBoxNow = await mainWindow
		.locator('.project-workspace--active .workspace')
		.boundingBox();
	if (!columnBox || !panelBoxNow) throw new Error('Expected layout boxes');
	// The tree is on the leading side of the panel area.
	expect(columnBox.x + columnBox.width).toBeLessThanOrEqual(panelBoxNow.x + 1);
	await toggleSidebar.click();
	await expect(sidebar()).toHaveCount(0);
	await expect(column()).toBeVisible();

	await mainWindow.reload();
	await expect(column()).toBeVisible();
	await expect(folderRow(mainWindow, 'General')).toBeVisible();
	await expect(sidebar()).toHaveCount(0);
});

test('tab peek shows an inactive project and jumps to a terminal in it, and never gets in the way of a pass or a drag', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-peek', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const generalSession = await activeTerminalSessionId(mainWindow);
	await selectFolder(mainWindow, 'alpha');
	const alphaSession = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'alpha',
	);
	// Leave the project with General in front, so the jump has a folder to select.
	await selectFolder(mainWindow, 'General');
	expect(await activeTerminalSessionId(mainWindow)).toBe(generalSession);

	await appHarness.sendAppCommand('new-project');
	const tabs = mainWindow.locator('.project-tab:not(.project-tab--overflowed)');
	await expect(tabs).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	const peek = mainWindow.locator('[data-terminay-project-tab-peek]');
	const inactiveTab = tabs.first();
	const workspaceBox = await mainWindow
		.locator('.project-workspace--active .workspace')
		.boundingBox();
	const tabBox = await inactiveTab.boundingBox();
	if (!workspaceBox || !tabBox) throw new Error('Expected layout boxes');
	const restingPlace = {
		x: workspaceBox.x + workspaceBox.width / 2,
		y: workspaceBox.y + workspaceBox.height / 2,
	};
	const tabMiddle = { x: tabBox.x + tabBox.width / 2, y: tabBox.y + tabBox.height / 2 };

	// Passing over the tab without resting opens nothing.
	await mainWindow.mouse.move(restingPlace.x, restingPlace.y);
	await mainWindow.mouse.move(tabBox.x + 6, tabMiddle.y);
	await mainWindow.mouse.move(tabBox.x + tabBox.width - 6, tabMiddle.y, {
		steps: 4,
	});
	await mainWindow.mouse.move(restingPlace.x, restingPlace.y);
	await mainWindow.waitForTimeout(800);
	await expect(peek).toHaveCount(0);

	// The active tab has no peek.
	await mainWindow.locator('.project-tab--active').hover();
	await mainWindow.waitForTimeout(800);
	await expect(peek).toHaveCount(0);

	// Resting on the inactive tab shows its folders and their terminals.
	await mainWindow.mouse.move(tabMiddle.x, tabMiddle.y);
	await expect(peek).toBeVisible();
	const peekFolders = peek.locator(
		'.folders-tree__row--folder .folders-tree__text > .folders-tree__name',
	);
	await expect(peekFolders).toHaveText(['General', 'alpha']);
	// General's branch line is there; a linked folder's name is its branch.
	await expect(peek.locator('.folders-tree__branch')).toHaveText(['main']);
	await expect(
		peek.locator(`[data-folder-terminal-session="${generalSession}"]`),
	).toBeVisible();
	const peekedTerminal = peek.locator(
		`[data-folder-terminal-session="${alphaSession}"]`,
	);
	await expect(peekedTerminal).toBeVisible();
	// Nothing has been activated by looking.
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);

	// Choosing a terminal: its project in front, its folder selected, and the
	// terminal focused.
	await peekedTerminal.click();
	await expect(peek).toHaveCount(0);
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		/^Project(?! 2)/,
	);
	await expect(folderRow(mainWindow, 'alpha')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect(terminalPanelForSession(mainWindow, alphaSession)).toBeVisible();
	expect(await activeTerminalSessionId(mainWindow)).toBe(alphaSession);
	await expect(
		terminalPanelForSession(mainWindow, alphaSession).locator(
			'.xterm-helper-textarea',
		),
	).toBeFocused();

	// Hover the tab that is now inactive until its peek opens, then drag that
	// same tab along the strip: it reorders, and no peek is left open.
	await mainWindow.mouse.move(restingPlace.x, restingPlace.y);
	await expect(mainWindow.locator('.project-tab-title')).toHaveText([
		'Project',
		'Project 2',
	]);
	const firstBox = await tabs.first().boundingBox();
	const secondBox = await tabs.nth(1).boundingBox();
	if (!firstBox || !secondBox) throw new Error('Expected tab geometry');
	await mainWindow.mouse.move(
		secondBox.x + secondBox.width / 2,
		secondBox.y + secondBox.height / 2,
	);
	await expect(peek).toBeVisible();
	await mainWindow.mouse.down();
	await expect(peek).toHaveCount(0);
	await mainWindow.mouse.move(firstBox.x + 8, firstBox.y + firstBox.height / 2, {
		steps: 10,
	});
	await expect(peek).toHaveCount(0);
	await mainWindow.mouse.up();
	await expect(
		mainWindow.locator(
			'.project-tab:not(.project-tab--overflowed) .project-tab-title',
		),
	).toHaveText(['Project 2', 'Project']);
	await expect(peek).toHaveCount(0);
	await mainWindow.mouse.move(restingPlace.x, restingPlace.y);
	await mainWindow.waitForTimeout(800);
	await expect(peek).toHaveCount(0);
});

test('at phone width there is no Folders column and the switcher lists the folders with their terminals', async ({
	appHarness,
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-phone', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const generalSession = await activeTerminalSessionId(mainWindow);
	await selectFolder(mainWindow, 'alpha');
	const alphaSession = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'alpha',
	);
	await selectFolder(mainWindow, 'General');
	await expect(foldersColumn(mainWindow)).toBeVisible();

	const nativeWindow = await electronApp.browserWindow(mainWindow);
	await nativeWindow.evaluate((window) => {
		window.setBounds({ x: 40, y: 40, width: 390, height: 740 });
	});
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible();
	// The tree is not a column at this width.
	await expect(foldersColumn(mainWindow)).toBeHidden();
	await expect(
		mainWindow.locator(
			'.project-workspace--active .workspace-split-layout__folders',
		),
	).toHaveCount(0);

	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	const switcher = mainWindow.getByRole('dialog', { name: 'Switch terminal' });
	await expect(switcher).toBeVisible();
	const groups = switcher.locator('.compact-switcher__folder-group');
	await expect(groups.locator('.compact-switcher__folder-name')).toHaveText([
		'General',
		'alpha',
	]);
	const groupOf = (folder: string) =>
		groups.filter({
			has: mainWindow.locator(
				`.compact-switcher__folder-name:text-is(${JSON.stringify(folder)})`,
			),
		});
	// Each folder lists its own terminal, and only its own.
	await expect(
		groupOf('General').locator('[data-compact-switcher-terminal]'),
	).toHaveCount(1);
	const alphaRow = groupOf('alpha').locator('[data-compact-switcher-terminal]');
	await expect(alphaRow).toHaveCount(1);
	await expect(switcher.locator('[data-compact-switcher-terminal]')).toHaveCount(
		2,
	);
	expect(await activeTerminalSessionId(mainWindow)).toBe(generalSession);

	// A terminal in a folder that is not on screen is reachable from here.
	await alphaRow.click();
	await expect(switcher).toHaveCount(0);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect(terminalPanelForSession(mainWindow, alphaSession)).toBeVisible();
	expect(await activeTerminalSessionId(mainWindow)).toBe(alphaSession);
});

test('at phone width a folder label creates a terminal in that folder, from the project in front and from another project', async ({
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-phone-create', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const firstProject = await mainWindow
		.locator('.app-shell')
		.getAttribute('data-terminay-active-project-id');
	const generalSession = await activeTerminalSessionId(mainWindow);

	const nativeWindow = await electronApp.browserWindow(mainWindow);
	const phone = () =>
		nativeWindow.evaluate((window) => {
			window.setBounds({ x: 40, y: 40, width: 390, height: 740 });
		});
	const wide = () =>
		nativeWindow.evaluate((window) => {
			window.setBounds({ x: 40, y: 40, width: 1280, height: 800 });
		});
	const switcher = mainWindow.getByRole('dialog', { name: 'Switch terminal' });
	const openSwitcher = async () => {
		await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
		await expect(switcher).toBeVisible();
	};
	// The second project made below opens on the same repository and so has
	// an alpha of its own; every folder here is the first project's.
	const card = switcher.locator('.compact-switcher__card').filter({
		has: mainWindow.locator(
			`.compact-switcher__terminal[data-project-id="${firstProject}"]`,
		),
	});
	const groupOf = (folder: string) =>
		card.locator('.compact-switcher__folder-group').filter({
			has: mainWindow.locator(
				`.compact-switcher__folder-name:text-is(${JSON.stringify(folder)})`,
			),
		});
	const create = switcher.locator('[data-compact-switcher-new-terminal]');

	await phone();
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible();
	await openSwitcher();
	// General is in front, and the create bar says so.
	await expect(create).toHaveText(/ › General$/);
	// alpha is empty: its label line and nothing beneath it.
	await expect(
		groupOf('alpha').locator('[data-compact-switcher-terminal]'),
	).toHaveCount(0);
	await expect(switcher.getByText('No panels')).toHaveCount(0);

	// The control on alpha's label creates in alpha, not in the folder in front.
	await groupOf('alpha')
		.getByRole('button', { name: /^New terminal in alpha of / })
		.click();
	await expect(switcher).toHaveCount(0);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect
		.poll(() => activeTerminalSessionId(mainWindow))
		.not.toBe(generalSession);
	const alphaSession = await activeTerminalSessionId(mainWindow);

	await openSwitcher();
	const alphaRows = groupOf('alpha').locator('[data-compact-switcher-terminal]');
	await expect(alphaRows).toHaveCount(1);
	await expect(alphaRows).toHaveAttribute('aria-current', 'true');
	await expect(
		groupOf('General').locator('[data-compact-switcher-terminal]'),
	).toHaveCount(1);
	// The bar follows the folder that is now in front.
	await expect(create).toHaveText(/ › alpha$/);
	await mainWindow.keyboard.press('Escape');
	await expect(switcher).toHaveCount(0);

	// From another project: put General back in front here, then leave.
	await wide();
	await expect(foldersColumn(mainWindow)).toBeVisible();
	await selectFolder(mainWindow, 'General');
	await mainWindow.getByLabel('Create project').click();
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await phone();
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible();
	await openSwitcher();
	await groupOf('alpha')
		.getByRole('button', { name: /^New terminal in alpha of / })
		.click();
	await expect(switcher).toHaveCount(0);
	await expect
		.poll(() =>
			mainWindow
				.locator('.app-shell')
				.getAttribute('data-terminay-active-project-id'),
		)
		.toBe(firstProject);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect
		.poll(async () => {
			const shown = await activeTerminalSessionId(mainWindow);
			return shown !== generalSession && shown !== alphaSession;
		})
		.toBe(true);
	await openSwitcher();
	await expect(alphaRows).toHaveCount(2);
	await expect(alphaRows.last()).toHaveAttribute('aria-current', 'true');
});

test('activating a dashboard row for a terminal in an unselected folder shows its folder and focuses it', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-dashboard', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const generalSession = await activeTerminalSessionId(mainWindow);
	await selectFolder(mainWindow, 'alpha');
	const alphaSession = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'alpha',
	);
	const alphaPanelId = await mainWindow
		.locator('.project-workspace--active .terminal-tab-content')
		.first()
		.getAttribute('data-panel-id');
	if (!alphaPanelId) throw new Error('Expected the panel id of the new tab');
	// Leave General in front, so the row has a folder to select.
	await selectFolder(mainWindow, 'General');
	expect(await activeTerminalSessionId(mainWindow)).toBe(generalSession);

	await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
	await mainWindow.locator('[data-terminay-home-section-tab="tabs"]').click();
	const dashboard = mainWindow.locator(
		'[data-terminay-home-active="true"] [data-terminay-dashboard]',
	);
	await expect(dashboard).toBeVisible();
	await mainWindow.locator('[data-terminay-dashboard-mode="list"]').click();
	await dashboard
		.locator(`[data-terminay-dashboard-panel="${alphaPanelId}"]`)
		.click();

	await expect(dashboard).toHaveCount(0);
	await expect(folderRow(mainWindow, 'alpha')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(activeFolderWorkspace(mainWindow)).toHaveAttribute(
		'data-terminay-folder-kind',
		'linked',
	);
	await expect(terminalPanelForSession(mainWindow, alphaSession)).toBeVisible();
	expect(await activeTerminalSessionId(mainWindow)).toBe(alphaSession);
	await expect(
		terminalPanelForSession(mainWindow, alphaSession).locator(
			'.xterm-helper-textarea',
		),
	).toBeFocused();
});

test('a folder cannot be given a name the project already uses', async ({
	mainWindow,
}) => {
	await createPlainFolder(mainWindow, 'Servers');
	const banner = mainWindow.locator('.error-banner');
	const attempt = async (name: string): Promise<void> => {
		await foldersColumn(mainWindow)
			.getByRole('button', { name: 'New folder' })
			.click();
		const dialog = mainWindow.getByRole('dialog');
		await dialog.getByRole('textbox', { name: 'Folder name' }).fill(name);
		await dialog.getByRole('button', { name: 'Create', exact: true }).click();
		await expect(banner).toContainText('already has a folder named');
		await banner.getByRole('button', { name: 'Dismiss error' }).click();
		await expect(banner).toHaveCount(0);
		await expect(folderNames(mainWindow)).toHaveText(['General', 'Servers']);
	};

	// Letter case does not make a name different, and General is taken.
	await attempt('servers');
	await attempt('General');

	await createPlainFolder(mainWindow, 'Notes');
	await openFolderMenu(mainWindow, 'Notes');
	await contextMenuItem(mainWindow, 'Rename folder').click();
	const dialog = mainWindow.getByRole('dialog');
	await dialog.getByRole('textbox', { name: 'Folder name' }).fill('Servers');
	await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
	await expect(banner).toContainText('already has a folder named');
	await expect(folderNames(mainWindow)).toHaveText([
		'General',
		'Servers',
		'Notes',
	]);
});

test('a worktree moved from a shell keeps its folder and terminal, and one whose directory is deleted says so without an error', async ({
	appHarness,
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-underneath', [
		'alpha',
		'gamma',
	]);
	await setProjectRoot(mainWindow, repo.root);
	await openFileExplorer(mainWindow);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	await expect(folderRow(mainWindow, 'gamma')).toBeVisible();

	await selectFolder(mainWindow, 'alpha');
	const moved = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'alpha',
	);
	await run(mainWindow, "cd / && printf 'before-%s\\n' the-move");
	await expect(terminalOutput(mainWindow)).toContainText('before-the-move');

	// Git run by the test process, as a shell outside the app would.
	await git(
		repo.root,
		'worktree',
		'move',
		repo.worktree('alpha'),
		repo.worktree('alpha-moved'),
	);

	// The folder is named by its branch, so its card reads as it did; what it
	// stands for is the new directory.
	await expect(folderRow(mainWindow, 'alpha')).toHaveAttribute(
		'aria-description',
		`Branch alpha. Worktree alpha-moved-tree. Location ${repo.worktree('alpha-moved')}.`,
		{ timeout: 15_000 },
	);
	await expect(terminalRowIn(mainWindow, 'alpha', moved)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	// The same terminal, and the folder now reads the new directory.
	await terminalRowOf(mainWindow, moved).click();
	await expect(terminalPanelForSession(mainWindow, moved)).toBeVisible();
	await expect(terminalOutput(mainWindow)).toContainText('before-the-move');
	await writeFile(
		join(repo.worktree('alpha-moved'), 'after-move.txt'),
		'moved\n',
		'utf8',
	);
	await expect(fileItem(mainWindow, 'after-move.txt')).toBeVisible({
		timeout: 10_000,
	});

	// A directory deleted from under its folder, with Git none the wiser.
	await selectFolder(mainWindow, 'gamma');
	const stranded = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'gamma',
	);
	await rm(repo.worktree('gamma'), { recursive: true, force: true });

	await expect(
		folderRow(mainWindow, 'gamma').locator('.folders-tree__facts'),
	).toContainText('missing', { timeout: 15_000 });
	await expect(terminalRowIn(mainWindow, 'gamma', stranded)).toHaveCount(1);
	await expect(filesPane(mainWindow)).toContainText(
		"This worktree's directory is missing.",
	);
	await expect(changesPane(mainWindow)).toContainText(
		'Working tree is missing',
	);
	await mainWindow.waitForTimeout(1_500);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);

	// Git forgets it, and the terminal is in General, still running.
	await git(repo.root, 'worktree', 'prune');
	await expect(folderRow(mainWindow, 'gamma')).toHaveCount(0, {
		timeout: 15_000,
	});
	await expect(terminalRowIn(mainWindow, 'General', stranded)).toHaveCount(1);
	await terminalRowOf(mainWindow, stranded).click();
	await typeInVisibleTerminal(
		mainWindow,
		"cd / && printf 'after-%s\\n' prune\n",
		stranded,
	);
	await expect(
		terminalPanelForSession(mainWindow, stranded).locator('.xterm-rows'),
	).toContainText('after-prune');
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('a folder card colours its branch only when its checkout is dirty, keeps its facts on one line at any width, and tints a selected folder that has no active terminal', async ({
	createWorkspace,
	mainWindow,
}, testInfo) => {
	const repo = await repository(createWorkspace, 'lf-cards', [
		'alpha',
		'beta',
		'gamma',
		'delta',
	]);
	// alpha and beta hold work that main does not; gamma and delta hold none.
	for (const dirty of ['alpha', 'beta']) {
		await writeFile(
			join(repo.worktree(dirty), 'work.txt'),
			'one\ntwo\n',
			'utf8',
		);
		await git(repo.worktree(dirty), 'add', '.');
		await git(repo.worktree(dirty), 'commit', '-m', 'work');
	}
	await setProjectRoot(mainWindow, repo.root);
	const header = (folder: string) => folderRow(mainWindow, folder);
	for (const dirty of ['alpha', 'beta'])
		await expect(header(dirty)).toHaveAttribute('data-change', 'delta', {
			timeout: 15_000,
		});
	for (const clean of ['gamma', 'delta'])
		await expect(header(clean)).toHaveAttribute('data-change', 'clean', {
			timeout: 15_000,
		});

	const branchColour = (folder: string) =>
		header(folder)
			.locator(CHECKOUT_NAME)
			.evaluate((element) => getComputedStyle(element).color);
	for (const clean of ['General', 'gamma', 'delta'])
		expect(await branchColour(clean)).not.toBe(ACCENT);
	for (const dirty of ['alpha', 'beta'])
		expect(await branchColour(dirty)).toBe(ACCENT);

	// A dirty worktree says how much and that nobody has asked for it to be
	// merged. A clean checkout has no facts line at all.
	const facts = header('alpha').locator('.folders-tree__facts');
	for (const dirty of ['alpha', 'beta']) {
		const line = header(dirty).locator('.folders-tree__facts');
		await expect(line).toContainText('+2');
		await expect(line).toContainText('no PR');
	}
	for (const clean of ['General', 'gamma', 'delta'])
		await expect(header(clean).locator('.folders-tree__facts')).toHaveCount(0);

	// This harness has no forge, so nothing publishes a pull request or checks
	// for a worktree. The two chips are added with the markup the card draws
	// for them (pinned by scripts/folders-tree-row.test.mjs), which is enough
	// to exercise what is under test here: the line's layout at each width.
	// alpha stands for a worktree with a pull request, so its `no PR` is put
	// out of sight; beta is left as the one without.
	await facts.evaluate((line) => {
		const none = line.querySelector<HTMLElement>('.folders-tree__chip--quiet');
		if (none !== null) none.style.display = 'none';
		const chip = (className: string, html: string) => {
			const element = document.createElement('span');
			element.className = `folders-tree__chip ${className}`;
			element.innerHTML = html;
			line.append(element);
		};
		chip(
			'folders-tree__pr folders-tree__pr--open',
			'<span class="folders-tree__chip-extra">PR</span><span>#350</span>',
		);
		chip(
			'folders-tree__checks folders-tree__checks--pending',
			'<span>23</span><span class="folders-tree__chip-extra">running</span>',
		);
	});
	for (const target of [340, 268, 220]) {
		// The chips say everything from 300px up, and less below it.
		const wide = target >= 300;
		const width = await setFoldersWidth(mainWindow, target);
		const tops = await facts
			.locator('.folders-tree__chip')
			.evaluateAll((chips) =>
				chips
					.filter((chip) => chip.getClientRects().length > 0)
					.map((chip) => Math.round(chip.getBoundingClientRect().top)),
			);
		expect(tops).toHaveLength(3);
		expect(new Set(tops).size, `one line at ${width}px`).toBe(1);
		const extras = facts.locator('.folders-tree__chip-extra');
		await expect(extras).toHaveCount(2);
		for (const extra of await extras.all())
			if (wide) await expect(extra).toBeVisible();
			else await expect(extra).toBeHidden();
		await testInfo.attach(`folders-column-${Math.round(width)}px.png`, {
			body: await foldersColumn(mainWindow).screenshot(),
			contentType: 'image/png',
		});
	}

	// General holds the focused terminal: its row is what is highlighted, and
	// no card is marked.
	const activeRows = foldersColumn(mainWindow).locator(
		'.folders-tree__row--active',
	);
	const tinted = foldersColumn(mainWindow).locator(
		'.folders-tree__row--selected-alone',
	);
	await expect(activeRows).toHaveCount(1);
	await expect(tinted).toHaveCount(0);
	// An empty folder has no row to highlight, so its title is tinted instead.
	await selectFolder(mainWindow, 'beta');
	await expect(header('beta')).toHaveClass(/folders-tree__row--selected-alone/);
	await expect(activeRows).toHaveCount(0);
	const background = (folder: string) =>
		header(folder).evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		);
	expect(await background('beta')).not.toBe(await background('alpha'));
	await selectFolder(mainWindow, 'General');
	await expect(tinted).toHaveCount(0);
	await expect(activeRows).toHaveCount(1);
});

test('a pushed branch is not dirty and still shows the commits the default branch lacks, and a push from a shell clears a dirty card', async ({
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-pushed', [
		'alpha',
		'beta',
	]);
	const remote = join(repo.root, '..', 'remote.git');
	await git(repo.root, 'init', '--bare', '-b', 'main', remote);
	await git(repo.root, 'remote', 'add', 'origin', remote);
	await git(repo.root, 'push', '-u', 'origin', 'main');
	// Both hold a commit main does not; only alpha's is on the remote. The
	// contents differ so the two commits are not one and the same object.
	for (const worktree of ['alpha', 'beta']) {
		await writeFile(
			join(repo.worktree(worktree), 'work.txt'),
			`${worktree}\ntwo\n`,
			'utf8',
		);
		await git(repo.worktree(worktree), 'add', '.');
		await git(repo.worktree(worktree), 'commit', '-m', 'work');
	}
	await git(repo.worktree('alpha'), 'push', '-u', 'origin', 'alpha');
	await setProjectRoot(mainWindow, repo.root);

	const header = (folder: string) => folderRow(mainWindow, folder);
	const branchColour = (folder: string) =>
		header(folder)
			.locator(CHECKOUT_NAME)
			.evaluate((element) => getComputedStyle(element).color);
	const mark = (folder: string) =>
		header(folder).locator('.folders-tree__unmerged');
	await expect(header('beta')).toHaveAttribute('data-change', 'delta', {
		timeout: 15_000,
	});
	await expect(header('alpha')).toHaveAttribute('data-change', 'clean', {
		timeout: 15_000,
	});
	expect(await branchColour('General')).not.toBe(ACCENT);
	expect(await branchColour('alpha')).not.toBe(ACCENT);
	expect(await branchColour('beta')).toBe(ACCENT);

	// Pushed or not, each is one commit the default branch lacks, and General
	// is none.
	for (const unmerged of ['alpha', 'beta']) {
		await expect(mark(unmerged)).toHaveText('↑1');
		await expect(mark(unmerged)).toHaveAttribute(
			'aria-label',
			'1 commit not on the default branch',
		);
	}
	await expect(mark('General')).toHaveCount(0);

	// Nothing of alpha's is unpushed, so it has no change size; nobody has
	// asked for it to be merged, so it still says so.
	const facts = (folder: string) =>
		header(folder).locator('.folders-tree__facts');
	await expect(facts('alpha').locator('.folders-tree__change')).toHaveCount(0);
	await expect(facts('alpha')).toContainText('no PR');
	await expect(facts('beta')).toContainText('+2');
	await expect(facts('beta')).toContainText('no PR');

	// The push is what changes the card; nothing is refreshed by hand.
	await git(repo.worktree('beta'), 'push', '-u', 'origin', 'beta');
	await expect(header('beta')).toHaveAttribute('data-change', 'clean', {
		timeout: 15_000,
	});
	expect(await branchColour('beta')).not.toBe(ACCENT);
	await expect(mark('beta')).toHaveText('↑1');

	// An uncommitted edit is work on this machine again.
	await writeFile(
		join(repo.worktree('alpha'), 'work.txt'),
		'alpha\ntwo\nthree\n',
		'utf8',
	);
	await expect(header('alpha')).toHaveAttribute('data-change', 'delta', {
		timeout: 15_000,
	});
	await expect(facts('alpha')).toContainText('+1');
	expect(await branchColour('alpha')).toBe(ACCENT);
});

test('New terminal on a folder card creates a terminal in that folder, selects the folder, and focuses the terminal', async ({
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-card-new', ['alpha']);
	await setProjectRoot(mainWindow, repo.root);
	await expect(folderRow(mainWindow, 'alpha')).toBeVisible({ timeout: 10_000 });
	const generalSession = await activeTerminalSessionId(mainWindow);
	// Every card ends with the row, whether or not it holds a terminal.
	await expect(newTerminalRow(mainWindow, 'General')).toBeVisible();
	await expect(newTerminalRow(mainWindow, 'alpha')).toBeVisible();

	// An empty linked folder: the terminal starts in its worktree.
	await newTerminalRow(mainWindow, 'alpha').click();
	await expect(folderTerminals(mainWindow, 'alpha')).toHaveCount(1, {
		timeout: 10_000,
	});
	await expect(folderRow(mainWindow, 'alpha')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect
		.poll(() => activeTerminalSessionId(mainWindow))
		.not.toBe(generalSession);
	const first = await activeTerminalSessionId(mainWindow);
	await expect(terminalRowIn(mainWindow, 'alpha', first)).toHaveClass(
		/folders-tree__row--active/,
	);
	await expectTerminalIn(mainWindow, repo.worktree('alpha'), 'card-new');

	// A folder that is not the one on screen and already holds a terminal.
	await selectFolder(mainWindow, 'General');
	expect(await activeTerminalSessionId(mainWindow)).toBe(generalSession);
	await newTerminalRow(mainWindow, 'alpha').click();
	await expect(folderTerminals(mainWindow, 'alpha')).toHaveCount(2, {
		timeout: 10_000,
	});
	await expect(folderRow(mainWindow, 'alpha')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect
		.poll(async () => {
			const sessionId = await activeTerminalSessionId(mainWindow);
			return sessionId !== first && sessionId !== generalSession;
		})
		.toBe(true);
	const second = await activeTerminalSessionId(mainWindow);
	await expect(terminalRowIn(mainWindow, 'alpha', second)).toHaveClass(
		/folders-tree__row--active/,
	);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	// The row is still the last thing in the card.
	await expect(
		folderGroup(mainWindow, 'alpha').locator(':scope > *').last(),
	).toHaveClass(/folders-tree__new-terminal/);
});

test('every folder is reordered by dragging its grip or with the arrow keys, General included, and the card follows the pointer up and down only', async ({
	appHarness,
	mainWindow,
}) => {
	for (const name of ['alpha', 'beta', 'gamma'])
		await createPlainFolder(mainWindow, name);
	await selectFolder(mainWindow, 'General');
	await expect(folderNames(mainWindow)).toHaveText([
		'General',
		'alpha',
		'beta',
		'gamma',
	]);
	const grip = (folder: string) =>
		folderRow(mainWindow, folder).locator('.folders-tree__grip');
	for (const name of ['General', 'alpha', 'beta', 'gamma'])
		await expect(grip(name)).toHaveCount(1);
	const cardBox = async (folder: string) => {
		const box = await folderGroup(mainWindow, folder).boundingBox();
		if (box === null) throw new Error(`${folder} is not on screen.`);
		return box;
	};
	const pointIn = async (folder: string, fromTop: number) => {
		const box = await cardBox(folder);
		return { x: box.x + box.width / 2, y: box.y + fromTop };
	};
	/** The order shown is the order held: it outlasts the drop's own preview. */
	const expectOrder = async (names: string[]) => {
		await expect(folderNames(mainWindow)).toHaveText(names);
		await mainWindow.waitForTimeout(3_500);
		await expect(folderNames(mainWindow)).toHaveText(names);
	};

	// The last folder, dropped over the top of the one above it.
	await dragGripTo(mainWindow, 'gamma', await pointIn('beta', 2));
	await expectOrder(['General', 'alpha', 'gamma', 'beta']);
	// Pressing a grip is not selecting a folder.
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(folderRow(mainWindow, 'gamma')).not.toHaveClass(
		/folders-tree__row--selected/,
	);

	// Dropped over the top of General, it goes above it.
	await dragGripTo(mainWindow, 'gamma', await pointIn('General', 1));
	await expectOrder(['gamma', 'General', 'alpha', 'beta']);

	// General is carried like any other card. The pointer goes down and well
	// to the right; the card goes down with it and not sideways.
	const before = await cardBox('General');
	const last = await cardBox('beta');
	let held: { dx: number; dy: number; pointerDy: number } | undefined;
	const pressedAt = await grip('General').boundingBox();
	if (pressedAt === null) throw new Error('General has no grip.');
	await dragGripTo(
		mainWindow,
		'General',
		{ x: before.x + before.width / 2 + 160, y: last.y + last.height - 2 },
		async (pointer) => {
			const now = await cardBox('General');
			held = {
				dx: now.x + now.width / 2 - (before.x + before.width / 2),
				dy: now.y + now.height / 2 - (before.y + before.height / 2),
				pointerDy: pointer.y - (pressedAt.y + pressedAt.height / 2),
			};
		},
	);
	if (held === undefined) throw new Error('The card was never read in the hand.');
	expect(Math.abs(held.dx)).toBeLessThan(1.5);
	expect(held.pointerDy).toBeGreaterThan(20);
	expect(Math.abs(held.dy - held.pointerDy)).toBeLessThan(6);
	await expectOrder(['gamma', 'alpha', 'beta', 'General']);
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);

	// A press that does not start on a grip carries nothing.
	const name = await folderRow(mainWindow, 'alpha')
		.locator('.folders-tree__name')
		.boundingBox();
	if (name === null) throw new Error('alpha is not on screen.');
	await mainWindow.mouse.move(name.x + 4, name.y + name.height / 2);
	await mainWindow.mouse.down();
	for (let step = 1; step <= 8; step += 1) {
		await mainWindow.mouse.move(name.x + 4, name.y + step * 20);
		await mainWindow.waitForTimeout(20);
	}
	await mainWindow.mouse.up();
	await expect(folderNames(mainWindow)).toHaveText([
		'gamma',
		'alpha',
		'beta',
		'General',
	]);
	await selectFolder(mainWindow, 'General');

	// From the keyboard: one place for each press, the grip keeps focus, and
	// either end of the order is as far as a folder goes.
	await grip('beta').focus();
	await mainWindow.keyboard.press('ArrowUp');
	await expect(folderNames(mainWindow)).toHaveText([
		'gamma',
		'beta',
		'alpha',
		'General',
	]);
	await expect(grip('beta')).toBeFocused();
	await mainWindow.keyboard.press('ArrowUp');
	await expect(folderNames(mainWindow)).toHaveText([
		'beta',
		'gamma',
		'alpha',
		'General',
	]);
	await expect(grip('beta')).toBeFocused();
	await mainWindow.keyboard.press('ArrowUp');
	await mainWindow.waitForTimeout(500);
	await expect(folderNames(mainWindow)).toHaveText([
		'beta',
		'gamma',
		'alpha',
		'General',
	]);
	await expect(grip('beta')).toBeFocused();
	await grip('General').focus();
	await mainWindow.keyboard.press('ArrowDown');
	await mainWindow.waitForTimeout(500);
	await expect(folderNames(mainWindow)).toHaveText([
		'beta',
		'gamma',
		'alpha',
		'General',
	]);
	await mainWindow.keyboard.press('ArrowUp');
	await expect(folderNames(mainWindow)).toHaveText([
		'beta',
		'gamma',
		'General',
		'alpha',
	]);
	await expect(grip('General')).toBeFocused();

	// The order is the server's: a reload reads it back, General is still the
	// folder shown, and a new terminal still lands in it.
	await mainWindow.reload();
	await expect(folderNames(mainWindow)).toHaveText(
		['beta', 'gamma', 'General', 'alpha'],
		{ timeout: 15_000 },
	);
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await newTerminalHere(mainWindow, appHarness.sendAppCommand, 'General');
	await expect(folderTerminals(mainWindow, 'beta')).toHaveCount(0);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('a short card is carried past a tall one in both directions', async ({
	appHarness,
	mainWindow,
}) => {
	await createPlainFolder(mainWindow, 'solo');
	await selectFolder(mainWindow, 'General');
	await newTerminalHere(mainWindow, appHarness.sendAppCommand, 'General');
	await newTerminalHere(mainWindow, appHarness.sendAppCommand, 'General');
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(3);
	await expect(folderNames(mainWindow)).toHaveText(['General', 'solo']);
	const cardBox = async (folder: string) => {
		const box = await folderGroup(mainWindow, folder).boundingBox();
		if (box === null) throw new Error(`${folder} is not on screen.`);
		return box;
	};
	const tall = await cardBox('General');
	expect(tall.height).toBeGreaterThan((await cardBox('solo')).height * 1.5);

	await dragGripTo(mainWindow, 'solo', {
		x: tall.x + tall.width / 2,
		y: tall.y + 1,
	});
	await expect(folderNames(mainWindow)).toHaveText(['solo', 'General']);
	await mainWindow.waitForTimeout(3_500);
	await expect(folderNames(mainWindow)).toHaveText(['solo', 'General']);

	const below = await cardBox('General');
	await dragGripTo(mainWindow, 'solo', {
		x: below.x + below.width / 2,
		y: below.y + below.height - 2,
	});
	await expect(folderNames(mainWindow)).toHaveText(['General', 'solo']);
	await mainWindow.waitForTimeout(3_500);
	await expect(folderNames(mainWindow)).toHaveText(['General', 'solo']);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test('cards slide to their new places, and take them at once where the device asks for reduced motion', async ({
	mainWindow,
}) => {
	for (const name of ['alpha', 'beta']) await createPlainFolder(mainWindow, name);
	await expect(folderNames(mainWindow)).toHaveText(['General', 'alpha', 'beta']);
	const grip = (folder: string) =>
		folderRow(mainWindow, folder).locator('.folders-tree__grip');
	/**
	 * Move a folder one place from the keyboard and read where the card it
	 * passes is drawn: two frames after the key, and once everything is still.
	 */
	const moveAndWatch = async (folder: string, key: string, passed: string) => {
		await grip(folder).focus();
		await mainWindow.keyboard.press(key);
		const top = () =>
			folderGroup(mainWindow, passed).evaluate(
				(card) =>
					new Promise<number>((resolve) =>
						requestAnimationFrame(() =>
							requestAnimationFrame(() =>
								resolve(card.getBoundingClientRect().top),
							),
						),
					),
			);
		const early = await top();
		await mainWindow.waitForTimeout(600);
		return { early, settled: await top() };
	};

	// With motion, the passed card is still on its way two frames in.
	const sliding = await moveAndWatch('beta', 'ArrowUp', 'alpha');
	await expect(folderNames(mainWindow)).toHaveText(['General', 'beta', 'alpha']);
	expect(Math.abs(sliding.early - sliding.settled)).toBeGreaterThan(2);

	// The preference is read when the tree is first shown.
	await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
	await mainWindow.reload();
	await expect(folderNames(mainWindow)).toHaveText(
		['General', 'beta', 'alpha'],
		{ timeout: 15_000 },
	);
	const still = await moveAndWatch('alpha', 'ArrowUp', 'beta');
	await expect(folderNames(mainWindow)).toHaveText(['General', 'alpha', 'beta']);
	expect(Math.abs(still.early - still.settled)).toBeLessThan(0.5);

	// Carried by its grip, it ends where it would without the preference.
	const general = await folderGroup(mainWindow, 'General').boundingBox();
	if (general === null) throw new Error('General is not on screen.');
	await dragGripTo(mainWindow, 'beta', {
		x: general.x + general.width / 2,
		y: general.y + 1,
	});
	await expect(folderNames(mainWindow)).toHaveText(['beta', 'General', 'alpha']);
	await mainWindow.waitForTimeout(3_500);
	await expect(folderNames(mainWindow)).toHaveText(['beta', 'General', 'alpha']);
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});

test("a terminal's row in the Folders tree opens the menu its tab opens, for the terminal on screen and for one in another folder", async ({
	appHarness,
	mainWindow,
}) => {
	const menu = mainWindow.locator('.context-menu');
	const generalSession = await activeTerminalSessionId(mainWindow);
	await mainWindow
		.locator('.project-workspace--active .terminal-tab-content--active')
		.click({ button: 'right' });
	await expect(menu).toBeVisible();
	const fromTab = await contextMenuLabels(mainWindow);
	expect(fromTab).toContain('Close');
	await mainWindow.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);

	await terminalRowOf(mainWindow, generalSession).click({ button: 'right' });
	await expect(menu).toBeVisible();
	expect(await contextMenuLabels(mainWindow)).toEqual(fromTab);
	await mainWindow.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	// A terminal's menu is not its folder's menu.
	await openFolderMenu(mainWindow, 'General');
	expect(await contextMenuLabels(mainWindow)).not.toEqual(fromTab);
	await mainWindow.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);

	// A terminal in a folder that is not the one on screen.
	await createPlainFolder(mainWindow, 'Servers');
	await selectFolder(mainWindow, 'Servers');
	const serverSession = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'Servers',
	);
	await selectFolder(mainWindow, 'General');
	await terminalRowOf(mainWindow, serverSession).click({ button: 'right' });
	await expect(menu).toBeVisible();
	expect(await contextMenuLabels(mainWindow)).toContain('Close');
	// It is that terminal's menu: Close closes that terminal and no other.
	await menu.getByText('Close', { exact: true }).click();
	await expect(terminalRowOf(mainWindow, serverSession)).toHaveCount(0);
	await expect(terminalRowOf(mainWindow, generalSession)).toHaveCount(1);
});

test('a worktree is named by its branch on one line, by its directory when detached, and by both when its branch is shared; resting on it shows its branch, directory, and location', async ({
	createWorkspace,
	mainWindow,
}) => {
	const repo = await repository(createWorkspace, 'lf-label', ['alpha']);
	// A worktree on no branch, one forced onto the root checkout's branch, and
	// one deep enough that its path is wider than the tooltip.
	const detached = repo.worktree('bisect');
	const shared = repo.worktree('hotfix');
	const deep = join(
		repo.root,
		'..',
		'a-directory-with-a-long-name-of-its-own',
		'and-another-one-beneath-it-just-as-long',
		'deep-tree',
	);
	await git(repo.root, 'worktree', 'add', '--detach', detached);
	await git(repo.root, 'worktree', 'add', '--force', shared, 'main');
	await mkdir(join(deep, '..'), { recursive: true });
	await git(repo.root, 'worktree', 'add', '-b', 'deep', deep);
	await setProjectRoot(mainWindow, repo.root);

	// One line each: the branch, the directory, or the branch then the
	// directory. General keeps its title with its branch beneath.
	await expect(folderNames(mainWindow)).toHaveText(
		['General', 'deep', 'alpha', 'bisect-tree', 'main hotfix-tree'],
		{ timeout: 15_000 },
	);
	const alpha = folderRow(mainWindow, 'alpha');
	await expect(alpha.locator('.folders-tree__branch')).toHaveCount(0);
	await expect(alpha).not.toContainText('alpha-tree');
	await expect(alpha.locator('.folders-tree__title svg.lucide-git-branch')).toHaveCount(1);
	await expect(alpha.locator('svg.lucide-folder')).toHaveCount(0);
	const general = folderRow(mainWindow, 'General');
	await expect(general.locator('svg.lucide-folder')).toHaveCount(1);
	await expect(general.locator('.folders-tree__branch')).toHaveText('main');
	// Only the worktree sharing a branch says its directory, and says it apart
	// from the branch.
	await expect(
		foldersColumn(mainWindow).locator('.folders-tree__label-suffix'),
	).toHaveText(['hotfix-tree']);

	// The card follows its worktree's branch, and stays where it was.
	await git(repo.worktree('alpha'), 'switch', '-c', 'renamed');
	await expect(folderNames(mainWindow)).toHaveText(
		['General', 'deep', 'renamed', 'bisect-tree', 'main hotfix-tree'],
		{ timeout: 15_000 },
	);

	const tooltip = detailsTooltip(mainWindow);
	const title = (folder: string) =>
		folderRow(mainWindow, folder).locator('.folders-tree__title');
	const away = async () => {
		await mainWindow.mouse.move(900, 500);
		await expect(tooltip).toHaveCount(0);
	};

	// Passing over a card shows nothing, however long ago it was.
	await title('deep').hover();
	await mainWindow.waitForTimeout(400);
	await expect(tooltip).toHaveCount(0);
	await away();
	await mainWindow.waitForTimeout(1_200);
	await expect(tooltip).toHaveCount(0);

	// Resting on it does, after a second and not before.
	await title('deep').hover();
	await mainWindow.waitForTimeout(700);
	await expect(tooltip).toHaveCount(0);
	await expect(tooltip).toBeVisible({ timeout: 2_000 });
	await expect(tooltip.locator('dt')).toHaveText([
		'Branch',
		'Worktree',
		'Location',
	]);
	await expect(tooltip.locator('dd')).toHaveText([
		'deep',
		'deep-tree',
		await realpath(deep),
	]);
	// Three lines, one beneath another, inside the window.
	const lines = await tooltip
		.locator('dd')
		.evaluateAll((values) =>
			values.map((value) => {
				const box = value.getBoundingClientRect();
				return { top: Math.round(box.top), height: Math.round(box.height) };
			}),
		);
	expect(new Set(lines.map((line) => line.top)).size).toBe(3);
	expect(new Set(lines.map((line) => line.height)).size).toBe(1);
	const fits = await tooltip.evaluate((element) => {
		const box = element.getBoundingClientRect();
		return (
			box.left >= 0 &&
			box.top >= 0 &&
			box.right <= window.innerWidth &&
			box.bottom <= window.innerHeight
		);
	});
	expect(fits).toBe(true);
	// The location is wider than its line: its end is shown and its start is
	// what gives way.
	const location = await tooltip
		.locator('.folders-tree-details__location')
		.evaluate((line) => {
			const text = line.querySelector('bdi');
			if (text === null) throw new Error('the location has no text');
			const outer = line.getBoundingClientRect();
			const inner = text.getBoundingClientRect();
			return {
				overflows: line.scrollWidth > line.clientWidth,
				startHidden: inner.left < outer.left - 1,
				endShown: inner.right <= outer.right + 1,
			};
		});
	expect(location).toEqual({ overflows: true, startHidden: true, endShown: true });
	// It is never between the pointer and a control.
	expect(
		await tooltip.evaluate((element) => getComputedStyle(element).pointerEvents),
	).toBe('none');
	await away();

	// A detached worktree says where it is detached.
	await title('bisect-tree').hover();
	await expect(tooltip).toBeVisible({ timeout: 2_500 });
	await expect(tooltip.locator('dd').first()).toHaveText(
		/^detached at [0-9a-f]{8}$/,
	);
	await expect(tooltip.locator('dd').nth(1)).toHaveText('bisect-tree');
	// Opening the menu takes the details away.
	await folderRow(mainWindow, 'bisect-tree')
		.getByRole('button', { name: 'Actions for bisect-tree' })
		.click();
	await expect(mainWindow.locator('.context-menu')).toBeVisible();
	await expect(tooltip).toHaveCount(0);
	await mainWindow.keyboard.press('Escape');
	await expect(mainWindow.locator('.context-menu')).toHaveCount(0);
	await away();

	// General and its branch have no details to show.
	await title('General').hover();
	await mainWindow.waitForTimeout(1_500);
	await expect(tooltip).toHaveCount(0);
	await away();

	// From the keyboard: focus resting on a card shows them, Escape closes.
	await mainWindow.keyboard.press('Shift');
	await folderRow(mainWindow, 'renamed').focus();
	await expect(tooltip).toBeVisible({ timeout: 2_500 });
	await expect(tooltip.locator('dd').first()).toHaveText('renamed');
	await mainWindow.keyboard.press('Escape');
	await expect(tooltip).toHaveCount(0);
});

test("double-clicking a terminal's row renames it in place: Enter and leaving the input save, Escape and a blank name do not", async ({
	appHarness,
	mainWindow,
}) => {
	const firstSession = await activeTerminalSessionId(mainWindow);
	await newTerminalHere(mainWindow, appHarness.sendAppCommand, 'General');
	const row = terminalRowOf(mainWindow, firstSession);
	const name = row.locator('.folders-tree__name');
	const input = row.locator('.folders-tree__rename');
	const tabs = mainWindow.locator(
		'.project-workspace--active .terminal-tab-content',
	);
	const original = (await name.textContent()) ?? '';
	expect(original.length).toBeGreaterThan(0);
	const rowHeight = (await row.boundingBox())?.height;

	// The row of a terminal that is not the one in front: the double-click
	// also activates it, and the input still keeps focus.
	await row.dblclick();
	await expect(input).toBeFocused();
	await expect(input).toHaveValue(original);
	expect(
		await input.evaluate((element: HTMLInputElement) =>
			element.value.slice(
				element.selectionStart ?? 0,
				element.selectionEnd ?? 0,
			),
		),
	).toBe(original);
	expect((await row.boundingBox())?.height).toBe(rowHeight);
	await expect(row).toHaveAttribute('draggable', 'false');
	// Outliving the moment the activated terminal takes focus.
	await mainWindow.waitForTimeout(500);
	await expect(input).toBeFocused();

	// Typing replaces the selected name, and a space does not activate the row.
	await mainWindow.keyboard.type('api server');
	await expect(input).toHaveValue('api server');
	await mainWindow.keyboard.press('Enter');
	await expect(input).toHaveCount(0);
	await expect(name).toHaveText('api server');
	await expect(tabs.filter({ hasText: 'api server' })).toHaveCount(1);
	await expect(
		terminalPanelForSession(mainWindow, firstSession).locator(
			'.xterm-helper-textarea',
		),
	).toBeFocused();

	// Escape leaves the name.
	await row.dblclick();
	await expect(input).toBeFocused();
	await mainWindow.keyboard.type('thrown away');
	await mainWindow.keyboard.press('Escape');
	await expect(input).toHaveCount(0);
	await expect(name).toHaveText('api server');

	// So does a blank name.
	await row.dblclick();
	await expect(input).toBeFocused();
	await input.fill('   ');
	await mainWindow.keyboard.press('Enter');
	await expect(input).toHaveCount(0);
	await expect(name).toHaveText('api server');

	// Leaving the input saves what was typed.
	await row.dblclick();
	await expect(input).toBeFocused();
	await mainWindow.waitForTimeout(500);
	await input.fill('logs');
	await folderRow(mainWindow, 'General').click();
	await expect(input).toHaveCount(0);
	await expect(name).toHaveText('logs');
	await expect(tabs.filter({ hasText: 'logs' })).toHaveCount(1);

	// The server holds the name: it is there after a reload.
	await mainWindow.reload();
	await expect(
		terminalRowOf(mainWindow, firstSession).locator('.folders-tree__name'),
	).toHaveText('logs', { timeout: 15_000 });
	await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
});
