import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { openProjectEditWindow, submitEditWindow } from './support/ui';

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

async function waitForWorkspacePopout(
	electronApp: ElectronApplication,
	mainWindow: Page,
): Promise<Page> {
	let popout: Page | undefined;
	await expect
		.poll(async () => {
			popout = electronApp
				.windows()
				.find(
					(page) =>
						page !== mainWindow &&
						!page.isClosed() &&
						!page.url().startsWith('about:blank') &&
						!page.url().startsWith('data:'),
				);
			return popout === undefined
				? false
				: (await popout.locator('[data-terminay-app-component]').count()) >
						0;
		}, { timeout: 20_000 })
		.toBe(true);
	if (popout === undefined)
		throw new Error('Expected the project popout window');
	await expect(popout.locator('[data-terminay-app-component]')).toBeVisible({
		timeout: 20_000,
	});
	return popout;
}

test.describe('project tabs', () => {
	test('dragging a project into a new window preserves its canonical project and terminal', async ({
		electronApp,
		mainWindow,
	}) => {
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);

		const editWindow = await openProjectEditWindow(mainWindow);
		await editWindow
			.getByPlaceholder('Project name')
			.fill('react-massive-table');
		await submitEditWindow(editWindow);

		const draggedProject = mainWindow
			.locator('.project-tab', { hasText: 'react-massive-table' })
			.first();
		await expect(draggedProject).toBeVisible();
		const projectId = await draggedProject.getAttribute('data-project-id');
		if (!projectId) throw new Error('Expected the moved project identity');
		const activeWorkspace = mainWindow.locator('.project-workspace--active');
		await expect(activeWorkspace.locator('.terminal-panel')).toHaveCount(1);
		const sessionId = await mainWindow
			.locator('.project-workspace--active .terminal-panel')
			.first()
			.getAttribute('data-terminay-terminal-session-id');
		if (!sessionId) throw new Error('Expected the moved terminal identity');

		const projectBox = await draggedProject.boundingBox();
		if (!projectBox)
			throw new Error('Expected the project tab to have a layout box');
		const revisionBeforeMove = Number(
			await mainWindow
				.locator('.app-shell')
				.getAttribute('data-terminay-workspace-revision'),
		);

		const centerX = projectBox.x + projectBox.width / 2;
		const centerY = projectBox.y + projectBox.height / 2;
		await mainWindow.mouse.move(centerX, centerY);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(centerX, centerY + 180, { steps: 12 });
		await mainWindow.mouse.up();
		const popoutWindow = await waitForWorkspacePopout(electronApp, mainWindow);

		await expect(mainWindow.locator('.project-tab-title')).toHaveText([
			'Project',
		]);
		await expect
			.poll(async () =>
				Number(
					await popoutWindow
						.locator('.app-shell')
						.getAttribute('data-terminay-workspace-revision'),
				),
			)
			.toBeGreaterThan(revisionBeforeMove);

		await expect(popoutWindow.locator('.project-tab-title')).toHaveText([
			'react-massive-table',
		]);
		await expect(popoutWindow.locator('.project-tab')).toHaveAttribute(
			'data-project-id',
			projectId,
		);
		await expect(
			popoutWindow.locator(
				`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
			),
		).toBeVisible();
		await popoutWindow.reload();
		await expect(popoutWindow.locator('.project-tab-title')).toHaveText([
			'react-massive-table',
		]);
		await expect(popoutWindow.locator('.project-tab')).toHaveAttribute(
			'data-project-id',
			projectId,
		);
		await expect(
			popoutWindow.locator('.project-workspace--active .terminal-tab-title'),
		).toHaveText(['Terminal 1']);
		await expect(
			popoutWindow.locator(
				`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
			),
		).toBeVisible();
	});

	test('closing a busy torn-off project window leaves its sibling window alive', async ({
		electronApp,
		mainWindow,
	}) => {
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		const draggedProject = mainWindow.locator('.project-tab').last();
		const projectBox = await draggedProject.boundingBox();
		if (!projectBox)
			throw new Error('Expected the project tab to have a layout box');
		const centerX = projectBox.x + projectBox.width / 2;
		const centerY = projectBox.y + projectBox.height / 2;
		await mainWindow.mouse.move(centerX, centerY);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(centerX, centerY + 180, { steps: 12 });
		await mainWindow.mouse.up();
		const popoutWindow = await waitForWorkspacePopout(electronApp, mainWindow);
		const sessionId = await popoutWindow
			.locator('.project-workspace--active .terminal-panel')
			.getAttribute('data-terminay-terminal-session-id');
		if (!sessionId) throw new Error('Expected the popout terminal');

		await electronApp.evaluate(({ dialog }) => {
			const state = globalThis as typeof globalThis & {
				closeDialog?: Electron.MessageBoxOptions;
			};
			dialog.showMessageBox = async (...args) => {
				state.closeDialog = args.at(-1) as Electron.MessageBoxOptions;
				return { checkboxChecked: false, response: 0 };
			};
		});
		await typeInVisibleTerminal(popoutWindow, 'sleep 30\n', sessionId);
		await electronApp.evaluate(({ BrowserWindow }) =>
			BrowserWindow.getFocusedWindow()?.close(),
		);
		await expect
			.poll(() =>
				electronApp.evaluate(
					() =>
						(
							globalThis as typeof globalThis & {
								closeDialog?: Electron.MessageBoxOptions;
							}
						).closeDialog?.buttons?.[0] ?? null,
				),
			)
			.toBe('Close Window');
		await expect.poll(() => popoutWindow.isClosed()).toBe(true);
		await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-tab-title'),
		).toHaveText(['Terminal 1']);
		await expectTerminalInputFocused(mainWindow);
	});

	test('adds, edits, switches, and closes project tabs', async ({
		createWorkspace,
		electronApp,
		mainWindow,
	}) => {
		const workspace = await createWorkspace({ name: 'project-tab-root' });
		const initialProjectTab = mainWindow.locator('.project-tab').first();
		await expect(initialProjectTab).toContainText('Project');

		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Project 2',
		);

		const editWindow = await openProjectEditWindow(mainWindow);
		await expect(
			editWindow.getByRole('heading', { name: 'Edit Project Tab' }),
		).toBeVisible();

		await editWindow.getByPlaceholder('Project name').fill('Workspace QA');
		const iconInput = editWindow.getByLabel('Tab icon');
		await iconInput.fill('QA');
		await expect(iconInput).toHaveValue('Q');
		await iconInput.fill('W');
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
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response: 0,
			});
		});

		await initialProjectTab.getByLabel('Close Project').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Workspace QA',
		);
	});

	test('new project tabs do not reuse palette colours until the palette is exhausted', async ({
		mainWindow,
	}) => {
		const addProjectButton = mainWindow.getByLabel(
			'Create project on This server',
		);

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
