import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMacroLauncher, sendAppCommand } from './support/app';
import {
	activeHome,
	closeFrontHomeTab,
	frontHomeTab,
	homeTabChips,
} from './support/home-tabs';

/**
 * Home's sidebar: Home, Tabs, and Automations, each opening as a Home tab. Its
 * visibility, and the tabs it opened, belong to this device and to no project.
 */

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });
const sidebarToggle = (page: Page) => page.getByLabel('Toggle file explorer');
const homeView = activeHome;
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

		// Exactly three sections, in order, and the one in front is current.
		const items = homeSidebar(mainWindow).getByRole('tab');
		await expect(items).toHaveText(['Home', 'Tabs', 'Automations']);
		await expect(sectionTab(mainWindow, 'home')).toHaveAttribute(
			'aria-selected',
			'true',
		);
		// Home opens into its own tab strip, holding the Home tab alone.
		await expect(homeTabChips(mainWindow)).toHaveText(['Home']);
		// Home's sidebar shows none of a project's panes.
		await expect(
			homeView(mainWindow).locator('.sidebar-group-tabs'),
		).toHaveCount(0);

		// Its empty band continues Home's tab strip across the sidebar.
		const band = await mainWindow
			.locator('[data-terminay-home-sidebar-band]')
			.boundingBox();
		const strip = await homeView(mainWindow)
			.locator('.dv-tabs-and-actions-container')
			.first()
			.boundingBox();
		expect(band?.y).toBe(strip?.y);
		expect(band?.height).toBe(strip?.height);

		// One empty-ish project and no automations: the overview says so.
		await expect(
			mainWindow.locator(
				'[data-terminay-home-widget="projects"] [data-terminay-home-count]',
			),
		).toHaveText('1');
		await expect(
			mainWindow.locator('[data-terminay-home-create-automation]'),
		).toBeVisible();

		// Arrow keys move through the list without opening anything; Enter
		// opens the section as a tab.
		await sectionTab(mainWindow, 'home').focus();
		await mainWindow.keyboard.press('ArrowDown');
		await expect(sectionTab(mainWindow, 'tabs')).toBeFocused();
		await expectSection(mainWindow, 'home');
		await mainWindow.keyboard.press('Enter');
		await expectSection(mainWindow, 'tabs');
		await expect(dashboard(mainWindow)).toBeVisible();
		await mainWindow.keyboard.press('End');
		await expect(sectionTab(mainWindow, 'automations')).toBeFocused();
		await mainWindow.keyboard.press('Enter');
		await expectSection(mainWindow, 'automations');
		await expect(homeTabChips(mainWindow)).toHaveText([
			'Home',
			'Tabs',
			'Automations',
		]);
		// A section that is already open comes to the front; it never opens twice.
		await sectionTab(mainWindow, 'home').click();
		await expectSection(mainWindow, 'home');
		await expect(homeTabChips(mainWindow)).toHaveCount(3);
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
		// The tab in front fills the area.
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

	test('the tabs open in Home, and the one in front, are remembered', async ({
		mainWindow,
	}) => {
		await homeControl(mainWindow).click();
		await sectionTab(mainWindow, 'automations').click();
		await expectSection(mainWindow, 'automations');
		await expect(sectionTab(mainWindow, 'automations')).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(
			frontHomeTab(mainWindow).locator('[data-terminay-automations]'),
		).toBeVisible();

		await mainWindow.locator('.project-tab').first().click();
		await expect(homeView(mainWindow)).toHaveCount(0);
		await homeControl(mainWindow).click();
		await expectSection(mainWindow, 'automations');

		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expectSection(mainWindow, 'automations');
		await expect(homeTabChips(mainWindow)).toHaveText(['Home', 'Automations']);
	});

	test('closing every tab leaves an empty Home that offers the sections', async ({
		mainWindow,
	}) => {
		await homeControl(mainWindow).click();
		await closeFrontHomeTab(mainWindow);
		await expect(homeTabChips(mainWindow)).toHaveCount(0);
		// Home stays selected, with its sidebar, and no section is current.
		await expectSection(mainWindow, 'none');
		await expect(homeSidebar(mainWindow)).toBeVisible();
		const empty = mainWindow.locator('[data-terminay-home-empty]');
		await expect(
			empty.locator('[data-terminay-home-empty-section]'),
		).toHaveText(['Home', 'Tabs', 'Automations']);
		await empty.locator('[data-terminay-home-empty-section="automations"]').click();
		await expectSection(mainWindow, 'automations');
		await expect(homeTabChips(mainWindow)).toHaveText(['Automations']);
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
	test('Home opens into a tab strip, and the Command Bar goes to any tab or section', async ({
		mainWindow,
	}) => {
		const projectId = await activeProjectId(mainWindow);
		await homeControl(mainWindow).click();
		await expect(homeControl(mainWindow)).toHaveClass(/project-tab-home--active/);
		await expect(
			mainWindow.locator('[data-terminay-home-tabs] .dv-tabs-and-actions-container'),
		).toBeVisible();

		// The Command Bar opens over Home, and lists no place until something is typed.
		await openMacroLauncher(mainWindow);
		const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		const input = mainWindow.getByRole('searchbox', { name: 'Search commands' });
		const places = commandBar.locator('[data-terminay-command-bar-item^="place:"]');
		await expect(commandBar.locator('.macro-launcher-item')).not.toHaveCount(0);
		await expect(places).toHaveCount(0);

		// A section is a place to go: it opens as a tab.
		await input.fill('autom');
		await expect(
			commandBar.locator('[data-terminay-command-bar-item="place:section:automations"]'),
		).toBeVisible();
		await commandBar
			.locator('[data-terminay-command-bar-item="place:section:automations"]')
			.click();
		await expect(commandBar).toHaveCount(0);
		await expectSection(mainWindow, 'automations');

		// So is a tab: choosing it leaves Home for its project.
		await openMacroLauncher(mainWindow);
		await input.fill('terminal 1');
		const tabs = commandBar.locator('[data-terminay-command-bar-group="Tabs"]');
		await expect(tabs.locator('.macro-launcher-item').first()).toContainText(
			'Terminal 1',
		);
		await tabs.locator('.macro-launcher-item').first().click();
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'project',
		);
		expect(await activeProjectId(mainWindow)).toBe(projectId);
		await expect(commandBar).toHaveCount(0);

		// From a project, a section is still a place to go.
		await openMacroLauncher(mainWindow);
		await input.fill('tabs');
		await commandBar
			.locator('[data-terminay-command-bar-item="place:section:tabs"]')
			.click();
		await expectSection(mainWindow, 'tabs');
		await expect(commandBar).toHaveCount(0);

		// Nothing found says so.
		await openMacroLauncher(mainWindow);
		await input.fill('no-such-thing-anywhere');
		await expect(commandBar).toContainText('Nothing matches');
		await mainWindow.keyboard.press('Escape');
		await expect(commandBar).toHaveCount(0);
	});
});
