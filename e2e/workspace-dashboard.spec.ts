import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { settledTerminalSessionId } from './support/terminal-session';
import {
	fileExplorerItem,
	openFileExplorer,
	openProjectEditWindow,
	setProjectRoot,
	submitEditWindow,
} from './support/ui';

const homeControl = (page: Page) => page.getByLabel('Show dashboard');
const dashboard = (page: Page) => page.locator('[data-terminay-dashboard]');
const projectRow = (page: Page, projectId: string) =>
	page.locator(`[data-terminay-dashboard-project="${projectId}"]`);
const panelRows = (page: Page) => page.locator('[data-terminay-dashboard-panel]');

async function showDashboard(page: Page): Promise<void> {
	await homeControl(page).click();
	await expect(dashboard(page)).toBeVisible();
}

async function activeProjectId(page: Page): Promise<string> {
	const id = await page.locator('.project-tab--active').getAttribute('data-project-id');
	if (!id) throw new Error('Expected an active project tab');
	return id;
}

test.describe('workspace dashboard', () => {
	test('the Home control sits between the sidebar toggle and the first project tab', async ({
		mainWindow,
	}) => {
		const order = await mainWindow.evaluate(() => {
			const bar = document.querySelector('.project-tabbar');
			if (!bar) return [];
			return [...bar.children].map((child) => child.className);
		});

		const toggleIndex = order.findIndex((name) =>
			name.includes('project-tab-sidebar-toggle-box'),
		);
		const homeIndex = order.findIndex((name) =>
			name.includes('project-tab-home-box'),
		);
		const tabsIndex = order.findIndex((name) =>
			name.includes('project-tabbar-projects'),
		);

		expect(toggleIndex).toBeGreaterThanOrEqual(0);
		expect(homeIndex).toBe(toggleIndex + 1);
		expect(tabsIndex).toBeGreaterThan(homeIndex);
	});

	test('selecting Home shows every project and tab while terminals keep running', async ({
		createWorkspace,
		mainWindow,
	}) => {
		const workspace = await createWorkspace({
			name: 'dashboard-inventory',
			seed: { files: { 'notes.txt': 'dashboard inventory\n' } },
		});
		await setProjectRoot(mainWindow, workspace.rootDir);

		// A file panel alongside the project's terminal: the dashboard lists both.
		await openFileExplorer(mainWindow);
		await fileExplorerItem(mainWindow, 'notes.txt').dblclick();
		await expect(mainWindow.locator('.file-preview-text')).toBeVisible();

		const firstProjectId = await activeProjectId(mainWindow);
		const firstSessionId = await settledTerminalSessionId(
			mainWindow.locator('.project-workspace--active .terminal-panel').first(),
		);
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
		const secondProjectId = await activeProjectId(mainWindow);

		await showDashboard(mainWindow);

		// Home is not a project: no project tab reads as active while it is shown.
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
		await expect(mainWindow.locator('.project-tab--active')).toHaveCount(0);

		await expect(projectRow(mainWindow, firstProjectId)).toBeVisible();
		await expect(projectRow(mainWindow, secondProjectId)).toBeVisible();
		// Two terminals and one file panel, none of them notable.
		await expect(panelRows(mainWindow)).toHaveCount(3);
		await expect(
			mainWindow.locator('[data-terminay-dashboard-status="idle"]'),
		).toHaveCount(3);

		// Every project workspace is off screen.
		await expect(mainWindow.locator('.project-workspace--active')).toHaveCount(
			0,
		);

		// Nothing was closed: going back to the first project finds the same live
		// session it had before Home, not a replacement.
		await projectRow(mainWindow, firstProjectId).click();
		await expect(dashboard(mainWindow)).toHaveCount(0);
		await expect(mainWindow.locator('.project-tab--active')).toHaveAttribute(
			'data-project-id',
			firstProjectId,
		);
		const restoredSessionId = await settledTerminalSessionId(
			mainWindow.locator('.project-workspace--active .terminal-panel').first(),
		);
		expect(restoredSessionId).toBe(firstSessionId);
	});

	test('rows stay one line and truncate rather than wrapping', async ({
		electronApp,
		mainWindow,
	}) => {
		const editWindow = await openProjectEditWindow(mainWindow);
		await editWindow
			.getByPlaceholder('Project name')
			.fill(
				'a project whose name is far too long to fit on one dashboard line without help',
			);
		await submitEditWindow(editWindow);

		await showDashboard(mainWindow);
		const rows = mainWindow.locator('.workspace-dashboard__row');
		const before = await rows.count();
		const heights = await rows.evaluateAll((elements) =>
			elements.map((element) => Math.round(element.getBoundingClientRect().height)),
		);

		await electronApp.evaluate(async ({ BrowserWindow }) => {
			const [window] = BrowserWindow.getAllWindows();
			const [, height] = window?.getSize() ?? [1200, 800];
			window?.setSize(520, height ?? 800);
		});
		await expect
			.poll(async () =>
				mainWindow.evaluate(() => Math.round(window.innerWidth)),
			)
			.toBeLessThan(600);

		await expect(rows).toHaveCount(before);
		const narrowed = await rows.evaluateAll((elements) =>
			elements.map((element) => Math.round(element.getBoundingClientRect().height)),
		);
		expect(narrowed).toEqual(heights);

		// The title cell truncates rather than growing the row.
		const title = mainWindow.locator('.workspace-dashboard__title').first();
		const overflows = await title.evaluate(
			(element) => element.scrollWidth > element.clientWidth,
		);
		expect(overflows).toBe(true);
	});

	test('activating a row lands on that project and panel', async ({
		mainWindow,
	}) => {
		const firstProjectId = await activeProjectId(mainWindow);
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);

		await showDashboard(mainWindow);
		await projectRow(mainWindow, firstProjectId).click();

		await expect(dashboard(mainWindow)).toHaveCount(0);
		await expect(mainWindow.locator('.project-tab--active')).toHaveAttribute(
			'data-project-id',
			firstProjectId,
		);

		await showDashboard(mainWindow);
		const panelRow = panelRows(mainWindow).last();
		const panelId = await panelRow.getAttribute('data-terminay-dashboard-panel');
		await panelRow.click();

		await expect(dashboard(mainWindow)).toHaveCount(0);
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-panel'),
		).toHaveCount(1);
		expect(panelId).not.toBeNull();
	});

	test('a rename republishes the inventory the dashboard reads', async ({
		mainWindow,
	}) => {
		const projectId = await activeProjectId(mainWindow);
		await showDashboard(mainWindow);
		await expect(projectRow(mainWindow, projectId)).toContainText('Project');

		// Renaming happens on the project tab, which is still there behind Home.
		await projectRow(mainWindow, projectId).click();
		const editWindow = await openProjectEditWindow(mainWindow);
		await editWindow.getByPlaceholder('Project name').fill('renamed-on-purpose');
		await submitEditWindow(editWindow);

		await showDashboard(mainWindow);
		await expect(projectRow(mainWindow, projectId)).toContainText(
			'renamed-on-purpose',
		);
	});

	test('closing a project updates the dashboard in place', async ({
		mainWindow,
	}) => {
		const firstProjectId = await activeProjectId(mainWindow);
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
		const secondProjectId = await activeProjectId(mainWindow);

		await showDashboard(mainWindow);
		await expect(projectRow(mainWindow, secondProjectId)).toBeVisible();

		await mainWindow
			.locator(`.project-tab[data-project-id="${secondProjectId}"]`)
			.locator('.project-tab-close')
			.click();

		// The row goes, and the dashboard stays selected.
		await expect(projectRow(mainWindow, secondProjectId)).toHaveCount(0);
		await expect(projectRow(mainWindow, firstProjectId)).toBeVisible();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
	});

	test('the Show Dashboard command works and Home survives a reload', async ({
		mainWindow,
	}) => {
		await sendAppCommand(mainWindow, 'show-dashboard');
		await expect(dashboard(mainWindow)).toBeVisible();

		await mainWindow.reload({ waitUntil: 'domcontentloaded' });

		await expect(dashboard(mainWindow)).toBeVisible();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
	});

	test('dragging a project tab never displaces the Home control', async ({
		electronApp,
		mainWindow,
	}) => {
		await mainWindow.getByLabel('Create project on This server').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);

		const homeBox = await homeControl(mainWindow).boundingBox();
		const orderBefore = await mainWindow
			.locator('.project-tab')
			.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-project-id')));
		if (!homeBox) throw new Error('Expected the Home control to have a layout box');

		const dragged = mainWindow.locator('.project-tab').last();
		const box = await dragged.boundingBox();
		if (!box) throw new Error('Expected the project tab to have a layout box');

		// Drag the last tab left, across the Home control and past it.
		await mainWindow.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(homeBox.x - 8, box.y + box.height / 2, {
			steps: 14,
		});
		await mainWindow.mouse.up();

		const homeBoxAfter = await homeControl(mainWindow).boundingBox();
		expect(homeBoxAfter?.x).toBeCloseTo(homeBox.x, 0);
		await expect(homeControl(mainWindow)).toBeVisible();

		const orderAfter = await mainWindow
			.locator('.project-tab')
			.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-project-id')));
		expect(orderAfter).toHaveLength(orderBefore.length);
		expect(new Set(orderAfter)).toEqual(new Set(orderBefore));

		// Squeezing the bar until the project tabs overflow must not push the
		// Home control out with them: it is chrome, not a tab.
		await electronApp.evaluate(async ({ BrowserWindow }) => {
			const [window] = BrowserWindow.getAllWindows();
			const [, height] = window?.getSize() ?? [1200, 800];
			window?.setSize(460, height ?? 800);
		});
		await expect
			.poll(async () =>
				mainWindow.evaluate(() => Math.round(window.innerWidth)),
			)
			.toBeLessThan(600);

		await expect(homeControl(mainWindow)).toBeVisible();
		const squeezed = await homeControl(mainWindow).boundingBox();
		const barBox = await mainWindow.locator('.project-tabbar').boundingBox();
		if (!squeezed || !barBox)
			throw new Error('Expected the Home control and tab bar to have layout');
		expect(squeezed.width).toBeGreaterThan(0);
		expect(squeezed.x).toBeGreaterThanOrEqual(barBox.x - 1);
		expect(squeezed.x + squeezed.width).toBeLessThanOrEqual(
			barBox.x + barBox.width + 1,
		);
	});
});
