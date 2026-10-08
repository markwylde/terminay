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
 * A repository with one commit on `main`, and one worktree per name on a
 * branch `feat/<name>`. Worktrees sit beside the checkout, so a folder is
 * named exactly after its worktree's directory.
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
			`feat/${directory}`,
			join(base, directory),
		);
	return { root, worktree: (directory) => join(base, directory) };
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
	await expect(branchOf('alpha')).toHaveText('feat/alpha');
	await expect(branchOf('beta')).toHaveText('feat/beta');
	// The project's first terminal is in General; a worktree nobody has
	// opened a terminal in says so.
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	await expect(folderGroup(mainWindow, 'alpha')).toContainText(
		'No terminals yet',
	);

	await appHarness.sendAppCommand('new-project');
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	await setProjectRoot(mainWindow, notes.rootDir);
	await openFileExplorer(mainWindow);
	await expect(fileItem(mainWindow, 'notes.txt')).toBeVisible();
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	// No branch line, and nothing Git-shaped anywhere on the row.
	await expect(
		folderRow(mainWindow, 'General').locator('.folders-tree__meta'),
	).toHaveCount(0);
	await expect(
		changesPane(mainWindow).locator('.git-panel__message'),
	).toHaveText('This folder is not in a Git repository', { timeout: 6000 });
	// A listing has arrived by now, so the absence of a branch is not a wait.
	await expect(folderNames(mainWindow)).toHaveText(['General']);
	await expect(
		folderRow(mainWindow, 'General').locator('.folders-tree__meta'),
	).toHaveCount(0);
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
	).toHaveText('feat/alpha', { timeout: 6000 });
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
	await expect(folderGroup(mainWindow, 'General')).toContainText(
		'No terminals yet',
	);
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
	await expect(folderGroup(mainWindow, 'Servers')).toContainText(
		'No terminals yet',
	);

	// Drag the terminal's tree row onto the folder's row. Chromium can drop a
	// synthetic drag while the renderer is busy, so each attempt is one whole
	// gesture and the outcome is asserted strictly afterwards.
	const row = terminalRowOf(mainWindow, sessionId);
	const target = folderRow(mainWindow, 'Servers');
	let moved = false;
	for (let attempt = 0; attempt < 4 && !moved; attempt += 1) {
		await row.dragTo(target);
		moved = await terminalRowIn(mainWindow, 'Servers', sessionId)
			.waitFor({ state: 'visible', timeout: 3_000 })
			.then(
				() => true,
				() => false,
			);
	}
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

	expect(await menuOf('alpha')).toEqual([
		'Commit & push with AI…',
		'Pull from origin',
		'Rename folder',
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

test('a terminal that runs git worktree add is moved into the new folder with Undo, and is offered the move when the setting is off', async ({
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
	const notice = mainWindow.locator('.folder-capture-notice:visible');
	await expect(notice).toHaveCount(1);
	await expect(notice).toContainText('into the folder for its new worktree');

	// Undo: back in General, and it stays there.
	await notice.getByRole('button', { name: 'Undo' }).click();
	await expect(terminalRowIn(mainWindow, 'General', sessionId)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'cap-one')).toHaveCount(0);
	await expect(folderGroup(mainWindow, 'cap-one')).toContainText(
		'No terminals yet',
	);
	await expect(notice).toHaveCount(0);
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
	await expect(mainWindow.locator('.folder-capture-notice:visible')).toHaveCount(
		0,
	);

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

	await expect(folderRow(mainWindow, 'outside')).toBeVisible({
		timeout: 15_000,
	});
	await expect(
		folderRow(mainWindow, 'outside').locator('.folders-tree__branch'),
	).toHaveText('feat/outside');
	await expect(folderGroup(mainWindow, 'outside')).toContainText(
		'No terminals yet',
	);
	// No terminal moved, nothing is offered, and nothing is announced.
	await expect(terminalRowIn(mainWindow, 'General', generalSession)).toHaveCount(
		1,
	);
	await expect(folderRow(mainWindow, 'General')).toHaveClass(
		/folders-tree__row--selected/,
	);
	await expect(
		folderGroup(mainWindow, 'outside').locator('.folders-tree__offer'),
	).toHaveCount(0);
	await expect(mainWindow.locator('.folder-capture-notice:visible')).toHaveCount(
		0,
	);
	await mainWindow.waitForTimeout(1_500);
	await expect(folderTerminals(mainWindow, 'outside')).toHaveCount(0);

	// A terminal in the worktree's folder, with something still to say.
	await selectFolder(mainWindow, 'outside');
	const sessionId = await newTerminalHere(
		mainWindow,
		appHarness.sendAppCommand,
		'outside',
	);
	await run(mainWindow, "cd / && printf 'before-%s\\n' removal");
	await expect(terminalOutput(mainWindow)).toContainText('before-removal');

	await git(repo.root, 'worktree', 'remove', '--force', repo.worktree('outside'));

	await expect(folderRow(mainWindow, 'outside')).toHaveCount(0, {
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
	// Each folder's branch line is there where it has one.
	await expect(peek.locator('.folders-tree__branch')).toHaveText([
		'main',
		'feat/alpha',
	]);
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
	await expect(
		folderRow(mainWindow, 'alpha').locator('.folders-tree__branch'),
	).toHaveText('feat/alpha');

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

	await expect(folderRow(mainWindow, 'alpha-moved')).toBeVisible({
		timeout: 15_000,
	});
	await expect(folderRow(mainWindow, 'alpha')).toHaveCount(0);
	await expect(terminalRowIn(mainWindow, 'alpha-moved', moved)).toHaveCount(1);
	await expect(folderTerminals(mainWindow, 'General')).toHaveCount(1);
	await expect(
		folderRow(mainWindow, 'alpha-moved').locator('.folders-tree__branch'),
	).toHaveText('feat/alpha');
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
		folderRow(mainWindow, 'gamma').locator('.folders-tree__meta'),
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
