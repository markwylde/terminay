import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { fileExplorerItem, openFileExplorer, openProjectEditWindow, setProjectRoot } from './support/ui';

const execFileAsync = promisify(execFile);

async function getActiveSessionId(page: Page): Promise<string> {
	const sessionId = await page
		.locator(
			'.project-workspace--active .terminal-panel:has(.xterm-helper-textarea:focus)',
		)
		.getAttribute('data-terminay-terminal-session-id');

	if (!sessionId) {
		throw new Error('Active terminal session id is unavailable');
	}

	return sessionId;
}

async function writeToActiveTerminal(
	page: Page,
	data: string,
): Promise<string> {
	const sessionId = await getActiveSessionId(page);
	const input = page.locator(
		'.project-workspace--active .terminal-panel:has(.xterm-helper-textarea:focus) .xterm-helper-textarea',
	);
	await input.focus();
	const command = data.replace(/[\r\n]+$/u, '');
	if (command.length > 0) await page.keyboard.insertText(command);
	if (command.length !== data.length) await page.keyboard.press('Enter');
	return sessionId;
}

async function getAppMenuItemAccelerator(
	electronApp: ElectronApplication,
	label: string,
): Promise<string | null> {
	return electronApp.evaluate(({ Menu }, itemLabel) => {
		const findItem = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
			for (const item of items) {
				if (item.label === itemLabel) {
					return item;
				}

				const child = item.submenu ? findItem(item.submenu.items) : null;
				if (child) {
					return child;
				}
			}

			return null;
		};

		const item = Menu.getApplicationMenu()
			? findItem(Menu.getApplicationMenu()!.items)
			: null;
		if (!item) {
			throw new Error(`Unable to find menu item: ${itemLabel}`);
		}

		return item.accelerator;
	}, label);
}

test.describe('workspace shell', () => {
	test('adds and closes terminal tabs from the workspace shell', async ({
		appHarness,
		mainWindow,
	}) => {
		const closeButtons = mainWindow.getByLabel('Close terminal');

		await expect(closeButtons).toHaveCount(1);
		await expect(mainWindow.locator('.dv-groupview')).toHaveCount(1);

		await appHarness.sendAppCommand('new-terminal');
		await expect(closeButtons).toHaveCount(2);

		await appHarness.sendAppCommand('close-active');
		await expect(closeButtons).toHaveCount(1);
	});

	test('closes several terminal panels sequentially while a file panel remains', async ({
		appHarness,
		createWorkspace,
		electronApp,
		mainWindow,
	}) => {
		await electronApp.evaluate(({ dialog }) => {
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response: 0,
			});
		});
		const workspace = await createWorkspace({
			name: 'sequential-panel-close',
			seed: { files: { 'README.md': 'remaining panel\n' } },
		});
		await setProjectRoot(mainWindow, workspace.rootDir);
		for (let index = 1; index < 4; index += 1) {
			await appHarness.sendAppCommand('new-terminal');
		}
		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(4);

		await openFileExplorer(mainWindow);
		await fileExplorerItem(mainWindow, 'README.md').dblclick();
		await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1);

		for (const [index, title] of ['Terminal 1', 'Terminal 2', 'Terminal 3', 'Terminal 4'].entries()) {
			await mainWindow.locator('.dv-tab:visible').filter({ hasText: title }).first().click();
			await appHarness.sendAppCommand('close-active');
			await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(3 - index);
		}

		await expect(mainWindow.getByLabel('Close file tab')).toHaveCount(1);
		await expect(
			mainWindow.getByRole('alert').filter({ hasText: 'Workspace synchronization failed' }),
		).toHaveCount(0);
	});

	test('warns only when closing a terminal with a foreground process', async ({
		appHarness,
		mainWindow,
	}) => {
		await appHarness.sendAppCommand('new-terminal');
		const closeButtons = mainWindow.getByLabel('Close terminal');
		await expect(closeButtons).toHaveCount(2);
		await mainWindow.locator('.terminal-panel').last().click();

		const foregroundStarted = `foreground-started-${Date.now()}`;
		await writeToActiveTerminal(
			mainWindow,
			`sleep 2.1; printf '${foregroundStarted}\\n'; sleep 30\n`,
		);
		await expect(
			mainWindow.locator('.terminal-panel:visible .xterm-rows'),
		).toContainText(foregroundStarted);
		const keepRunning = mainWindow.waitForEvent('dialog');
		await closeButtons.last().click();
		const dismissedDialog = await keepRunning;
		expect(dismissedDialog.type()).toBe('confirm');
		expect(dismissedDialog.message()).toContain('A process is still running');
		await dismissedDialog.dismiss();
		await expect(closeButtons).toHaveCount(2);

		const confirmClose = mainWindow.waitForEvent('dialog');
		await closeButtons.last().click();
		await (await confirmClose).accept();
		await expect(closeButtons).toHaveCount(1);
		await expect(
			mainWindow
				.getByRole('alert')
				.filter({ hasText: 'Workspace synchronization failed' }),
		).toHaveCount(0);
	});

	test('closes the project when its last tab is closed', async ({
		appHarness,
		mainWindow,
	}) => {
		await appHarness.sendAppCommand('new-project');
		await expect(mainWindow.locator('.project-tab-title')).toHaveText([
			'Project',
			'Project 2',
		]);
		await expect(
			mainWindow.locator('.project-tab--active .project-tab-title'),
		).toHaveText('Project 2');
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-tab-content'),
		).toHaveCount(1);

		await appHarness.sendAppCommand('close-active');

		await expect(mainWindow.locator('.project-tab-title')).toHaveText([
			'Project',
		]);
		await expect(
			mainWindow.locator('.project-tab--active .project-tab-title'),
		).toHaveText('Project');
	});

	test('keeps the app open when closing the first project while another project exists', async ({
		appHarness,
		mainWindow,
	}) => {
		await appHarness.sendAppCommand('new-project');
		await expect(mainWindow.locator('.project-tab-title')).toHaveText([
			'Project',
			'Project 2',
		]);

		await mainWindow.locator('.project-tab').first().click();
		await expect(
			mainWindow.locator('.project-tab--active .project-tab-title'),
		).toHaveText('Project');

		await appHarness.sendAppCommand('close-active');

		await expect(mainWindow.locator('.project-tab-title')).toHaveText([
			'Project 2',
		]);
		await expect(
			mainWindow.locator('.project-tab--active .project-tab-title'),
		).toHaveText('Project 2');
	});

	test('splits the active terminal vertically', async ({
		appHarness,
		mainWindow,
	}) => {
		await mainWindow.locator('.terminal-panel').first().click();
		await appHarness.sendAppCommand('split-vertical');

		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
		await expect(mainWindow.locator('.dv-groupview')).toHaveCount(2);
		await expect(mainWindow.locator('.terminal-tab-title')).toHaveText([
			'Terminal 1',
			'Terminal 2',
		]);
	});

	test('splits the active terminal horizontally', async ({
		appHarness,
		mainWindow,
	}) => {
		await mainWindow.locator('.terminal-panel').first().click();
		await appHarness.sendAppCommand('split-horizontal');

		await expect(mainWindow.getByLabel('Close terminal')).toHaveCount(2);
		await expect(mainWindow.locator('.dv-groupview')).toHaveCount(2);
		await expect(mainWindow.locator('.terminal-tab-title')).toHaveText([
			'Terminal 1',
			'Terminal 2',
		]);
	});

	test('pops out the active terminal panel into a new window', async ({
		appHarness,
		mainWindow,
	}) => {
		await mainWindow.locator('.terminal-panel').first().click();
		const terminalTab = mainWindow
			.locator('.dv-tab', { hasText: 'Terminal 1' })
			.first();
		await expect(terminalTab).toBeVisible();
		const terminalTabBox = await terminalTab.boundingBox();
		if (!terminalTabBox) {
			throw new Error('Expected terminal dock tab to have a layout box');
		}

		const popoutWindow = await appHarness.openChildWindow(async () => {
			await mainWindow.mouse.move(
				terminalTabBox.x + terminalTabBox.width / 2,
				terminalTabBox.y + terminalTabBox.height / 2,
			);
			await mainWindow.mouse.down();
			await mainWindow.mouse.move(
				terminalTabBox.x + terminalTabBox.width / 2 + 18,
				terminalTabBox.y + terminalTabBox.height / 2 + 18,
			);
			await mainWindow.mouse.move(0, 0);
			await mainWindow.mouse.up();
		});

		await expect(popoutWindow.locator('.terminal-tab-title')).toContainText(
			'Terminal 1',
		);
		await expect(popoutWindow.getByLabel('Close terminal')).toHaveCount(1);
	});

	test('sets the project root from the active terminal working directory with the CmdOrCtrl+R menu command', async ({
		appHarness,
		createWorkspace,
		electronApp,
		mainWindow,
	}) => {
		const workspace = await createWorkspace({
			name: 'shortcut-project-root',
			seed: {
				files: {
					'README.md': 'initial readme\n',
				},
			},
		});
		const expectedRoot = await realpath(workspace.rootDir);
		const sessionId = await getActiveSessionId(mainWindow);

		await execFileAsync('git', ['init'], { cwd: workspace.rootDir });
		await execFileAsync('git', ['config', 'user.name', 'Terminay E2E'], {
			cwd: workspace.rootDir,
		});
		await execFileAsync(
			'git',
			['config', 'user.email', 'terminay@example.com'],
			{ cwd: workspace.rootDir },
		);
		await execFileAsync('git', ['add', '.'], { cwd: workspace.rootDir });
		await execFileAsync('git', ['commit', '-m', 'initial'], {
			cwd: workspace.rootDir,
		});

		const cwdReady = `cwd-ready-${sessionId}`;
		await writeToActiveTerminal(
			mainWindow,
			`cd ${JSON.stringify(workspace.rootDir)} && printf ${JSON.stringify(cwdReady)}\r`,
		);
		await expect(
			mainWindow.locator('.terminal-panel').filter({ hasText: cwdReady }),
		).toBeVisible();
		await expect
			.poll(async () => {
				return mainWindow.evaluate(async (nextSessionId) => {
					return window.terminayTest!.getServerTerminalCwd(nextSessionId);
				}, sessionId);
			})
			.toMatchObject({ cwd: expectedRoot, source: 'observed' });

		await mainWindow.bringToFront();
		await mainWindow.locator('.terminal-panel').first().click();
		const accelerator = await getAppMenuItemAccelerator(
			electronApp,
			'Set Project Root to Working Directory',
		);
		expect(accelerator).toBe('CmdOrCtrl+R');
		await appHarness.sendAppCommand(
			'set-project-root-folder-to-working-directory',
		);
		await mainWindow.waitForTimeout(500);

		const editWindow = await openProjectEditWindow(mainWindow);
		await expect(editWindow.getByPlaceholder('Enter folder path')).toHaveValue(
			expectedRoot,
		);
		await editWindow.getByRole('button', { name: 'Cancel' }).click();

		await openFileExplorer(mainWindow);
		const gitPane = mainWindow.locator('.sidebar-pane').filter({
			has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }),
		});
		const worktree = gitPane.locator('.worktrees-panel__worktree').first();
		await expect(
			worktree.locator('.worktrees-panel__worktree-name'),
		).toContainText('shortcut-project-root', {
			timeout: 6000,
		});
		await expect(
			gitPane
				.locator('.git-panel__message')
				.filter({ hasText: 'Not a git repository' }),
		).toHaveCount(0);
	});
});
