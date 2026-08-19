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

async function closeNativePageWindow(
	electronApp: ElectronApplication,
	page: Page,
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window) => {
		window.close();
	});
}

type BusyWindowTestMain = typeof globalThis & {
	closeDialog?: Electron.MessageBoxOptions;
	__terminayTestRunningTerminalCountForWindow?: (
		webContentsId: number,
	) => Promise<number>;
};

/** Wait until close-protection would treat this native window as busy. */
async function waitUntilNativeWindowHasBusyTerminal(
	electronApp: ElectronApplication,
	page: Page,
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	const webContentsId = await nativeWindow.evaluate(
		(window) => window.webContents.id,
	);
	await expect
		.poll(
			() =>
				electronApp.evaluate(async (_electron, id) => {
					const count = await (
						globalThis as BusyWindowTestMain
					).__terminayTestRunningTerminalCountForWindow?.(id);
					return count ?? 0;
				}, webContentsId),
			{ timeout: 15_000 },
		)
		.toBeGreaterThan(0);
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
		const foregroundStarted = `foreground-started-${Date.now()}`;

		await electronApp.evaluate(({ dialog }) => {
			const state = globalThis as BusyWindowTestMain;
			state.closeDialog = undefined;
			dialog.showMessageBox = async (...args) => {
				state.closeDialog = args.at(-1) as Electron.MessageBoxOptions;
				return { checkboxChecked: false, response: 0 };
			};
		});
		// Drive one non-shell process that prints the marker and stays in the
		// foreground. `sh -c "…; printf; exec sleep"` prints while `sh`/`dash`
		// is still foreground; Debian E2E treats those names as the idle login
		// shell, so close-protection skips the warning. Playwright retries are
		// a new worker, so that race fails all three attempts on a fast VM.
		await typeInVisibleTerminal(
			popoutWindow,
			`python3 -c "import time; print('${foregroundStarted}', flush=True); time.sleep(30)"\n`,
			sessionId,
		);
		await expect(
			popoutWindow.locator('.terminal-panel:visible .xterm-rows'),
		).toContainText(foregroundStarted);
		await waitUntilNativeWindowHasBusyTerminal(electronApp, popoutWindow);
		// Close this torn-off window by identity. Linux/Xvfb does not reliably
		// move native focus after a drag-created BrowserWindow, so
		// getFocusedWindow() can no-op or close the idle sibling instead.
		await closeNativePageWindow(electronApp, popoutWindow);
		await expect
			.poll(() =>
				electronApp.evaluate(
					() =>
						(globalThis as BusyWindowTestMain).closeDialog?.buttons?.[0] ??
						null,
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

	test('the Local-matching project switcher keeps trailing chrome visible and activates overflowed projects', async ({
		mainWindow,
		electronApp,
	}) => {
		const addProjectButton = mainWindow.getByLabel(
			'Create project on This server',
		);
		for (let index = 0; index < 11; index += 1) {
			await addProjectButton.click();
		}
		await expect(mainWindow.locator('.project-tab')).toHaveCount(12);

		const nativeWindow = await electronApp.browserWindow(mainWindow);
		await nativeWindow.evaluate((window) => {
			window.setBounds({ x: 40, y: 40, width: 720, height: 700 });
		});
		await expect(mainWindow.locator('.project-switcher-button')).toBeVisible();
		await expect(mainWindow.locator('.project-tabbar-projects')).toHaveClass(
			/project-tabbar-projects--overflow/,
		);
		const strip = mainWindow.locator('.project-tabbar-projects');
		const add = mainWindow.locator('.project-tab-add-box');
		const stripBox = await strip.boundingBox();
		const addBox = await add.boundingBox();
		if (!stripBox || !addBox) {
			throw new Error('Expected overflow strip geometry');
		}
		expect(addBox.x - (stripBox.x + stripBox.width)).toBeLessThan(8);
		const lastVisible = mainWindow
			.locator('.project-tab:not(.project-tab--overflowed)')
			.last();
		const lastBox = await lastVisible.boundingBox();
		const switcherBox = await mainWindow
			.locator('.project-switcher-button')
			.boundingBox();
		if (!lastBox || !switcherBox) {
			throw new Error('Expected overflow switcher to meet the last tab');
		}
		expect(lastBox.x + lastBox.width).toBeGreaterThan(switcherBox.x + 24);
		await nativeWindow.evaluate((window) => {
			window.setBounds({ x: 40, y: 40, width: 1280, height: 700 });
		});
		await expect(mainWindow.locator('.project-switcher-button')).toBeVisible();
		const wideStripBox = await strip.boundingBox();
		const wideAddBox = await add.boundingBox();
		if (!wideStripBox || !wideAddBox) {
			throw new Error('Expected a filled overflow strip on a wide bar');
		}
		expect(wideAddBox.x - (wideStripBox.x + wideStripBox.width)).toBeLessThan(
			8,
		);
		await expect(mainWindow.locator('.remote-access-button')).toBeVisible();
		await expect
			.poll(async () =>
				Number(
					await mainWindow
						.locator('.project-tabbar-projects')
						.getAttribute('data-project-tab-hidden-count'),
				),
			)
			.toBeGreaterThan(0);

		const overflowedTitle = (
			await mainWindow
				.locator('.project-tab--overflowed .project-tab-title')
				.last()
				.textContent()
		)?.trim();
		if (!overflowedTitle) throw new Error('Expected an overflowed project title');

		await mainWindow.locator('.project-switcher-button').click();
		await mainWindow.getByRole('menuitem', { name: overflowedTitle }).click();
		await expect(
			mainWindow.locator('.project-tab--active .project-tab-title'),
		).toHaveText(overflowedTitle);

		await nativeWindow.evaluate((window) => {
			window.setBounds({ x: 40, y: 40, width: 390, height: 740 });
		});
		await expect(mainWindow.locator('.project-tabbar-projects')).toHaveAttribute(
			'data-project-tab-layout',
			'compact',
		);
		await expect(mainWindow.locator('.remote-access-button')).toBeVisible();
		await expect(mainWindow.locator('.project-switcher-button')).toContainText(
			overflowedTitle,
		);
		await mainWindow.locator('.project-switcher-button').click();
		const compactMenu = mainWindow.locator('.project-switcher-menu');
		await expect(compactMenu).toBeVisible();
		const compactMenuBox = await compactMenu.boundingBox();
		if (!compactMenuBox) {
			throw new Error('Expected a compact project switcher menu');
		}
		expect(compactMenuBox.width).toBeGreaterThan(330);
		await expect(
			compactMenu.getByRole('menuitem', { name: overflowedTitle }),
		).toBeVisible();
		await expect(add).toBeHidden();
		const compactCreate = compactMenu.getByRole('menuitem', {
			name: 'Create project on This server',
		});
		await expect(compactCreate).toBeVisible();
		const compactSwitcherBox = await mainWindow
			.locator('.project-switcher-button')
			.boundingBox();
		const countBox = await mainWindow
			.locator('.project-switcher-button__count')
			.boundingBox();
		if (!compactSwitcherBox || !countBox) {
			throw new Error('Expected compact switcher trailing chrome');
		}
		expect(
			compactSwitcherBox.x +
				compactSwitcherBox.width -
				(countBox.x + countBox.width),
		).toBeLessThan(28);
	});

	test('reorders visible project tabs when one is dragged along the strip', async ({
		mainWindow,
	}) => {
		await mainWindow.getByLabel('Create project on This server').click();
		const tabs = mainWindow.locator(
			'.project-tab:not(.project-tab--overflowed)',
		);
		await expect(tabs).toHaveCount(2);
		await expect(mainWindow.locator('.project-tab-title')).toHaveText([
			'Project',
			'Project 2',
		]);
		const firstBox = await tabs.first().boundingBox();
		const secondBox = await tabs.nth(1).boundingBox();
		if (!firstBox || !secondBox) {
			throw new Error('Project tab drag geometry is unavailable');
		}
		await mainWindow.mouse.move(
			secondBox.x + secondBox.width / 2,
			secondBox.y + secondBox.height / 2,
		);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(
			firstBox.x + 8,
			firstBox.y + firstBox.height / 2,
			{ steps: 10 },
		);
		await mainWindow.mouse.up();
		await expect(
			mainWindow.locator(
				'.project-tab:not(.project-tab--overflowed) .project-tab-title',
			),
		).toHaveText(['Project 2', 'Project']);
	});

	test('creating a project focuses the new terminal', async ({
		mainWindow,
	}) => {
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('.project-tab--active')).toContainText(
			'Project 2',
		);
		await expectTerminalInputFocused(mainWindow);
	});

	test('the new-project control stays after the last project tab', async ({
		mainWindow,
	}) => {
		const lastTab = mainWindow.locator('.project-tab:not(.project-tab--overflowed)').last();
		const add = mainWindow.locator('.project-tab-add-box');
		const local = mainWindow.locator('.remote-access-button');
		await expect(lastTab).toBeVisible();
		await expect(add).toBeVisible();
		const tabBox = await lastTab.boundingBox();
		const addBox = await add.boundingBox();
		const localBox = await local.boundingBox();
		if (!tabBox || !addBox || !localBox) {
			throw new Error('Expected project bar geometry');
		}
		expect(addBox.x - (tabBox.x + tabBox.width)).toBeLessThan(20);
		expect(localBox.x - (addBox.x + addBox.width)).toBeGreaterThan(40);
	});

	test('project switcher grips reorder projects', async ({
		electronApp,
		mainWindow,
	}) => {
		const addProjectButton = mainWindow.getByLabel(
			'Create project on This server',
		);
		for (let index = 0; index < 5; index += 1) {
			await addProjectButton.click();
		}
		await expect(mainWindow.locator('.project-tab')).toHaveCount(6);
		const nativeWindow = await electronApp.browserWindow(mainWindow);
		await nativeWindow.evaluate((window) => {
			window.setBounds({ x: 40, y: 40, width: 720, height: 700 });
		});
		await expect(mainWindow.locator('.project-switcher-button')).toBeVisible();
		const titlesBefore = await mainWindow
			.locator('.project-tab-title')
			.allTextContents();

		await mainWindow.locator('.project-switcher-button').click();
		const menu = mainWindow.locator('.project-switcher-menu');
		await expect(menu).toBeVisible();
		const lastTitle = titlesBefore.at(-1)?.trim();
		const firstTitle = titlesBefore[0]?.trim();
		if (!lastTitle || !firstTitle) {
			throw new Error('Expected project titles for switcher reorder');
		}
		const sourceGrip = menu.getByLabel(`Reorder ${lastTitle}`);
		const targetRow = menu.locator('[data-project-switcher-row]').first();
		const gripBox = await sourceGrip.boundingBox();
		const targetBox = await targetRow.boundingBox();
		if (!gripBox || !targetBox) {
			throw new Error('Expected switcher grip geometry');
		}

		await mainWindow.mouse.move(
			gripBox.x + gripBox.width / 2,
			gripBox.y + gripBox.height / 2,
		);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(
			targetBox.x + targetBox.width / 2,
			targetBox.y + 4,
			{ steps: 8 },
		);
		await mainWindow.mouse.up();

		await expect(mainWindow.locator('.project-tab-title').first()).toHaveText(
			lastTitle,
		);
		await expect(menu).toBeVisible();
	});
});
