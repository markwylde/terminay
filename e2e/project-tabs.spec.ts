import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	cancelEditWindow,
	openProjectEditWindow,
	submitEditWindow,
} from './support/ui';

async function readCssVariableFromStyle(
	locator: Locator,
	variableName: string,
): Promise<string> {
	const style = await locator.getAttribute('style');
	const match = style?.match(new RegExp(`${variableName}:\\s*([^;]+)`));

	if (!match?.[1]) {
		throw new Error(
			`Missing ${variableName} in style attribute: ${style ?? '(none)'}`,
		);
	}

	return match[1].trim();
}

async function expectTerminalInputFocused(page: Page): Promise<void> {
	await expect
		.poll(async () =>
			page.evaluate(
				() =>
					document.activeElement?.classList.contains('xterm-helper-textarea') ??
					false,
			),
		)
		.toBe(true);
}

test.describe('project tabs', () => {
	test('native project popout adopts its live workspace in a new window', async ({
		electronApp,
		mainWindow,
	}) => {
		const sessionId = await mainWindow
			.locator('.terminal-panel')
			.first()
			.getAttribute('data-terminay-terminal-session-id');
		if (!sessionId)
			throw new Error('Expected the active server terminal identity');

		const nextWindow = electronApp.waitForEvent('window');
		const result = await mainWindow.evaluate(
			async (activeSessionId) =>
				window.terminayWorkspaceTransferHost?.popoutProject(
					{
						project: {
							id: 'project-1',
							title: 'Project 1',
							color: '#4db5ff',
							emoji: '',
							fileExplorerWidth: 320,
							isFileExplorerOpen: false,
							isExplorerPaneCollapsed: false,
							isAgentsPaneCollapsed: false,
							isGitPaneCollapsed: false,
							expandedAgentEntryIds: [],
							sidebarAgentsHeight: 240,
							sidebarExplorerHeight: 240,
							sidebarGitHeight: 240,
							sidebarPanelOrder: ['explorer', 'agents', 'git'],
							rootFolder: '',
						},
						terminals: [{ sessionId: activeSessionId, title: 'Terminal 1' }],
						activeSessionId,
					},
					100,
					100,
				),
			sessionId,
		);
		expect(result?.ok).toBe(true);

		const adoptedWindow = await nextWindow;
		await adoptedWindow.waitForLoadState('domcontentloaded');
		await expect(adoptedWindow.locator('.project-tab--active')).toContainText(
			'Project 1',
		);
		await expect(
			adoptedWindow
				.locator(
					`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
				)
				.last(),
		).toBeVisible();
	});

	test('adds, edits, switches, and closes project tabs', async ({
		createWorkspace,
		electronApp,
		mainWindow,
	}) => {
		const workspace = await createWorkspace({ name: 'project-tab-root' });
		const initialProjectTab = mainWindow.locator('.project-tab').first();
		await expect(initialProjectTab).toContainText('Project');

		await mainWindow.getByLabel('Add project tab').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Project 2',
		);

		const editWindow = await openProjectEditWindow(mainWindow);
		await expect(
			editWindow.getByRole('heading', { name: 'Edit Project Tab' }),
		).toBeVisible();

		await editWindow.getByPlaceholder('Project name').fill('Workspace QA');
		await editWindow.getByLabel('Tab icon').fill('W');
		await editWindow
			.getByPlaceholder('Enter folder path')
			.fill(workspace.rootDir);
		await editWindow.locator('.hue-slider').fill('120');
		await submitEditWindow(editWindow);

		const updatedProjectTab = mainWindow.locator('.project-tab').nth(1);
		await expect(updatedProjectTab).toContainText('Workspace QA');
		await expect(updatedProjectTab.locator('.project-tab-emoji')).toHaveText(
			'W',
		);
		await expect(updatedProjectTab).toHaveAttribute('style', /#57db57/i);
		await expectTerminalInputFocused(mainWindow);

		await initialProjectTab.click();
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Project',
		);

		await updatedProjectTab.click();
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Workspace QA',
		);
		await electronApp.evaluate(({ dialog }) => {
			dialog.showMessageBox = async () => ({ checkboxChecked: false, response: 0 });
		});

		await initialProjectTab.getByLabel('Close Project').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Workspace QA',
		);
	});

	test('project edit window uses a single-character icon input and cancel keeps the project unchanged', async ({
		appHarness,
		mainWindow,
	}) => {
		const activeProjectTab = mainWindow.locator('.project-tab--active');
		const originalTitle =
			(
				await activeProjectTab.locator('.project-tab-title').textContent()
			)?.trim() ?? 'Project';
		const originalIcon = (
			(await activeProjectTab
				.locator('.project-tab-emoji')
				.textContent()
				.catch(() => null)) ?? ''
		).trim();

		await appHarness.openMacroLauncher(mainWindow);
		const editWindow = await appHarness.openChildWindow(async () => {
			await mainWindow
				.getByRole('button', { name: 'Edit project settings' })
				.click();
		});
		const iconInput = editWindow.getByLabel('Tab icon');

		await expect(
			editWindow.getByRole('heading', { name: 'Edit Project Tab' }),
		).toBeVisible();
		await iconInput.fill('QA');
		await expect(iconInput).toHaveValue('Q');
		await editWindow.getByPlaceholder('Project name').fill('Should Not Save');
		await cancelEditWindow(editWindow);

		await expect(activeProjectTab).toContainText(originalTitle);
		if (originalIcon) {
			await expect(activeProjectTab.locator('.project-tab-emoji')).toHaveText(
				originalIcon,
			);
		} else {
			await expect(activeProjectTab.locator('.project-tab-emoji')).toHaveCount(
				0,
			);
		}
	});

	test('new project tabs do not reuse palette colours until the palette is exhausted', async ({
		mainWindow,
	}) => {
		const addProjectButton = mainWindow.getByLabel('Add project tab');

		for (let index = 0; index < 19; index += 1) {
			await addProjectButton.click();
		}

		const projectTabs = mainWindow.locator('.project-tab');
		await expect(projectTabs).toHaveCount(20);

		const colors = await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				readCssVariableFromStyle(projectTabs.nth(index), '--project-color'),
			),
		);

		expect(new Set(colors).size, JSON.stringify(colors)).toBe(20);

		await addProjectButton.click();
		await expect(projectTabs).toHaveCount(21);
	});
});
