import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';

/**
 * Home's sidebar: a menu over Home, Tabs, and Automations whose visibility and
 * section belong to this device and to no project.
 */

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });
const sidebarToggle = (page: Page) => page.getByLabel('Toggle file explorer');
const homeView = (page: Page) => page.locator('[data-terminay-home-view]');
const homeSidebar = (page: Page) =>
	page.locator('[data-terminay-home-sidebar]');
const sectionTab = (page: Page, section: 'home' | 'tabs' | 'automations') =>
	page.locator(`[data-terminay-home-section-tab="${section}"]`);
const dashboard = (page: Page) => page.locator('[data-terminay-dashboard]');
const panelRows = (page: Page) =>
	page.locator('[data-terminay-dashboard-panel]');
/** A project's sidebar is rendered only while it is visible for that project. */
const projectSidebar = (page: Page, projectId: string) =>
	page.locator(
		`.project-workspace[data-terminay-project-id="${projectId}"] .file-explorer-sidebar`,
	);

async function activeProjectId(page: Page): Promise<string> {
	const id = await page
		.locator('.project-tab--active')
		.getAttribute('data-project-id');
	if (!id) throw new Error('Expected an active project tab');
	return id;
}

async function expectSection(
	page: Page,
	section: 'home' | 'tabs' | 'automations',
): Promise<void> {
	await expect(homeView(page)).toHaveAttribute(
		'data-terminay-home-view',
		section,
	);
}

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

test.describe('Home sidebar', () => {
	test('first visit shows the sidebar open on the Home overview', async ({
		mainWindow,
	}) => {
		await expect(homeControl(mainWindow)).toBeVisible();
		await homeControl(mainWindow).click();

		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'home',
		);
		await expect(homeSidebar(mainWindow)).toBeVisible();
		await expectSection(mainWindow, 'home');

		// Exactly three sections, in order, as a tab list.
		const tabs = homeSidebar(mainWindow).getByRole('tab');
		await expect(tabs).toHaveText(['Home', 'Tabs', 'Automations']);
		await expect(sectionTab(mainWindow, 'home')).toHaveAttribute(
			'aria-selected',
			'true',
		);
		// Home's sidebar shows none of a project's panes.
		await expect(
			homeView(mainWindow).locator('.sidebar-group-tabs'),
		).toHaveCount(0);

		// One empty-ish project and no automations: the overview says so.
		await expect(
			mainWindow.locator(
				'[data-terminay-home-widget="projects"] [data-terminay-home-count]',
			),
		).toHaveText('1');
		await expect(
			mainWindow.locator('[data-terminay-home-create-automation]'),
		).toBeVisible();

		// The keyboard moves between sections.
		await sectionTab(mainWindow, 'home').focus();
		await mainWindow.keyboard.press('ArrowDown');
		await expectSection(mainWindow, 'tabs');
		await expect(sectionTab(mainWindow, 'tabs')).toBeFocused();
		await expect(dashboard(mainWindow)).toBeVisible();
		await mainWindow.keyboard.press('End');
		await expectSection(mainWindow, 'automations');
		await mainWindow.keyboard.press('Home');
		await expectSection(mainWindow, 'home');
	});

	test('hidden visibility is remembered across leaving Home and a reload', async ({
		mainWindow,
	}) => {
		await homeControl(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toBeVisible();

		// The toggle is live on Home and hides Home's own sidebar.
		await expect(sidebarToggle(mainWindow)).toBeEnabled();
		await sidebarToggle(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toHaveCount(0);
		// The selected section's content fills the area.
		await expect(
			mainWindow.locator('[data-terminay-home-overview]'),
		).toBeVisible();

		await mainWindow.locator('.project-tab').first().click();
		await expect(homeView(mainWindow)).toHaveCount(0);
		await homeControl(mainWindow).click();
		await expect(homeView(mainWindow)).toBeVisible();
		await expect(homeSidebar(mainWindow)).toHaveCount(0);

		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expect(homeView(mainWindow)).toBeVisible();
		await expect(homeSidebar(mainWindow)).toHaveCount(0);

		await sidebarToggle(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toBeVisible();
	});

	test('toggling on Home never changes a project sidebar, and the reverse', async ({
		mainWindow,
	}) => {
		const projectId = await activeProjectId(mainWindow);
		// A device with no preference shows a project's sidebar closed.
		await expect(projectSidebar(mainWindow, projectId)).toHaveCount(0);

		await homeControl(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toBeVisible();
		await sidebarToggle(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toHaveCount(0);
		// The command answers for Home too, not for the project behind it.
		await sendAppCommand(mainWindow, 'toggle-file-explorer-sidebar');
		await expect(homeSidebar(mainWindow)).toBeVisible();
		await expect(projectSidebar(mainWindow, projectId)).toHaveCount(0);

		// And a project's toggle leaves Home's sidebar as it was.
		await mainWindow.locator('.project-tab').first().click();
		await sidebarToggle(mainWindow).click();
		await expect(projectSidebar(mainWindow, projectId)).toHaveCount(1);
		await homeControl(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toBeVisible();
		await sidebarToggle(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toHaveCount(0);
		await expect(projectSidebar(mainWindow, projectId)).toHaveCount(1);

		await mainWindow.locator('.project-tab').first().click();
		await expect(projectSidebar(mainWindow, projectId)).toBeVisible();
	});

	test('the chosen section is remembered', async ({ mainWindow }) => {
		await homeControl(mainWindow).click();
		await sectionTab(mainWindow, 'automations').click();
		await expectSection(mainWindow, 'automations');
		await expect(sectionTab(mainWindow, 'automations')).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(
			mainWindow.locator('[data-terminay-automations]'),
		).toBeVisible();

		await mainWindow.locator('.project-tab').first().click();
		await expect(homeView(mainWindow)).toHaveCount(0);
		await homeControl(mainWindow).click();
		await expectSection(mainWindow, 'automations');

		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expectSection(mainWindow, 'automations');
	});

	test('Tabs shows the dashboard and a panel row still activates its project', async ({
		mainWindow,
	}) => {
		const firstProjectId = await activeProjectId(mainWindow);
		await mainWindow.getByLabel('Create project').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
		await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(
			0,
		);

		await homeControl(mainWindow).click();
		await sectionTab(mainWindow, 'tabs').click();
		await expect(dashboard(mainWindow)).toBeVisible();
		await expect(
			mainWindow.locator(
				`[data-terminay-dashboard-project="${firstProjectId}"]`,
			),
		).toBeVisible();

		const firstPanel = mainWindow
			.locator(`[data-terminay-dashboard-panel]`)
			.first();
		await expect(panelRows(mainWindow)).toHaveCount(2);
		await firstPanel.click();

		await expect(homeView(mainWindow)).toHaveCount(0);
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'project',
		);
		await expect(mainWindow.locator('.project-tab--active')).toHaveAttribute(
			'data-project-id',
			firstProjectId,
		);
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-panel'),
		).toHaveCount(1);
	});

	test('the narrow-layout drawer dismisses via Escape', async ({
		electronApp,
		mainWindow,
	}) => {
		await homeControl(mainWindow).click();
		await expect(homeSidebar(mainWindow)).toBeVisible();

		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 600,
			height: 760,
		});
		const layout = homeView(mainWindow).locator('.workspace-split-layout');
		await expect(layout).toHaveAttribute('data-navigation-drawer', 'true');
		// The drawer takes focus, and the content behind it is inert.
		await expect(sectionTab(mainWindow, 'home')).toBeFocused();
		await expect(
			homeView(mainWindow).locator('.workspace-split-layout__content'),
		).toHaveAttribute('inert', '');

		await mainWindow.keyboard.press('Escape');
		await expect(homeSidebar(mainWindow)).toHaveCount(0);
		await expect(layout).toHaveAttribute('data-navigation-drawer', 'false');
		await expect(
			mainWindow.locator('[data-terminay-home-overview]'),
		).toBeVisible();
	});
});
