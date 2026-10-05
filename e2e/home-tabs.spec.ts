import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMacroLauncher, sendAppCommand } from './support/app';
import {
	activeHome,
	expectHomeSection,
	frontHomeTab as front,
	frontHomeTabId,
	homeTabChip,
	homeTabChips,
} from './support/home-tabs';

/**
 * Home's tabs: Home presents what it holds the way a project presents its
 * panels. A tab stays open, and keeps what was put into it, while another tab
 * or a project is in front; an unsaved automation is asked about before it is
 * closed; and the arrangement belongs to this device.
 */

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });
const sectionTab = (page: Page, section: 'home' | 'tabs' | 'automations') =>
	page.locator(`[data-terminay-home-section-tab="${section}"]`);
const field = (page: Page, name: string) =>
	front(page).locator(`[data-terminay-automation-field="${name}"]`);
const discardDialog = (page: Page) =>
	page.locator('[data-terminay-home-discard-dialog]');

async function openAutomations(page: Page): Promise<void> {
	await homeControl(page).click();
	await sectionTab(page, 'automations').click();
	await expect(
		front(page).locator('[data-terminay-automation-new]').first(),
	).toBeVisible();
}

/** Opens a new automation tab from the list. */
async function newAutomation(page: Page): Promise<void> {
	await sectionTab(page, 'automations').click();
	await front(page).locator('[data-terminay-automation-new]').first().click();
	await expect(
		front(page).locator('[data-terminay-automation-editor]'),
	).toBeVisible();
}

/** Creates and saves an automation; its tab is in front afterwards. */
async function createAutomation(page: Page, name: string): Promise<string> {
	await newAutomation(page);
	await field(page, 'name').fill(name);
	await field(page, 'command').fill('echo home-tabs-e2e');
	await front(page).locator('[data-terminay-automation-save]').click();
	const detail = front(page).locator('[data-terminay-automation-detail]');
	await expect(detail).toContainText(name);
	const id = await detail.getAttribute('data-terminay-automation-detail');
	if (id === null) throw new Error('Saved automation has no id');
	return id;
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

test.describe('Home tabs', () => {
	test('an unsaved automation is still there after a visit to a project and to another tab', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await newAutomation(mainWindow);
		await field(mainWindow, 'name').fill('Half written');
		await field(mainWindow, 'command').fill('echo half');

		// The tab names what is being written and says it is unsaved.
		const draft = homeTabChip(mainWindow, 'automation-new:');
		await expect(draft).toContainText('Half written');
		await expect(draft).toHaveAttribute('data-terminay-home-tab-dirty', 'true');
		// The list it was opened from is still open behind it.
		await expect(homeTabChips(mainWindow)).toHaveText([
			'Home',
			'Automations',
			'Half written',
		]);

		// Leave for a project: Home is out of the way, and the project works.
		await mainWindow.locator('.project-tab').first().click();
		await expect(activeHome(mainWindow)).toHaveCount(0);
		await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
			'data-terminay-selected-view',
			'project',
		);
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-panel'),
		).toBeVisible();

		// Come back: the same tab is in front, as it was left.
		await homeControl(mainWindow).click();
		expect(await frontHomeTabId(mainWindow)).toMatch(/^automation-new:/);
		await expect(field(mainWindow, 'name')).toHaveValue('Half written');
		await expect(field(mainWindow, 'command')).toHaveValue('echo half');

		// Another Home tab in front does not disturb it either.
		await sectionTab(mainWindow, 'tabs').click();
		await expect(
			front(mainWindow).locator('[data-terminay-dashboard]'),
		).toBeVisible();
		await draft.click();
		await expect(field(mainWindow, 'name')).toHaveValue('Half written');
		await expect(field(mainWindow, 'command')).toHaveValue('echo half');
	});

	test('several drafts are open at once, and an automation has one tab', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await newAutomation(mainWindow);
		await field(mainWindow, 'name').fill('First draft');
		await newAutomation(mainWindow);
		await field(mainWindow, 'name').fill('Second draft');

		const drafts = homeTabChip(mainWindow, 'automation-new:');
		await expect(drafts).toHaveText(['First draft', 'Second draft']);
		await drafts.first().click();
		await expect(field(mainWindow, 'name')).toHaveValue('First draft');

		// Saving closes the editor's tab and opens the automation's.
		await field(mainWindow, 'command').fill('echo first');
		await front(mainWindow).locator('[data-terminay-automation-save]').click();
		await expect(
			front(mainWindow).locator('[data-terminay-automation-detail]'),
		).toContainText('First draft');
		await expect(drafts).toHaveText(['Second draft']);
		const saved = homeTabChip(mainWindow, 'automation:');
		await expect(saved).toHaveText(['First draft']);

		// Opening it again from the list finds its tab rather than a second.
		await sectionTab(mainWindow, 'automations').click();
		await front(mainWindow)
			.locator('[data-terminay-automation-row] .automations-row__main')
			.click();
		await expect(saved).toHaveCount(1);
		expect(await frontHomeTabId(mainWindow)).toMatch(/^automation:/);
		// And the list is as it was, behind it.
		await expect(homeTabChip(mainWindow, 'section:automations')).toHaveCount(1);
	});

	test('closing a tab with unsaved edits asks first, and one without does not', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		const drafts = homeTabChip(mainWindow, 'automation-new:');

		// Nothing typed: Cancel just closes it.
		await newAutomation(mainWindow);
		await front(mainWindow)
			.getByRole('button', { name: 'Cancel', exact: true })
			.click();
		await expect(drafts).toHaveCount(0);
		await expect(discardDialog(mainWindow)).toHaveCount(0);

		// Something typed: the tab's own close control asks, and keeping it
		// keeps what was typed.
		await newAutomation(mainWindow);
		await field(mainWindow, 'name').fill('Not yet saved');
		const id = await frontHomeTabId(mainWindow);
		await mainWindow.locator(`[data-terminay-home-tab-close="${id}"]`).click();
		await expect(discardDialog(mainWindow)).toBeVisible();
		await mainWindow.locator('[data-terminay-home-keep-editing]').click();
		await expect(discardDialog(mainWindow)).toHaveCount(0);
		await expect(field(mainWindow, 'name')).toHaveValue('Not yet saved');

		// The keyboard's close asks too, and closes Home's tab — never a panel
		// of the project behind Home.
		await sendAppCommand(mainWindow, 'close-active');
		await expect(discardDialog(mainWindow)).toBeVisible();
		await mainWindow.keyboard.press('Escape');
		await expect(discardDialog(mainWindow)).toHaveCount(0);
		await expect(drafts).toHaveCount(1);

		// Cancel asks as well; discarding closes the tab.
		await front(mainWindow)
			.getByRole('button', { name: 'Cancel', exact: true })
			.click();
		await mainWindow.locator('[data-terminay-home-discard]').click();
		await expect(drafts).toHaveCount(0);
		await expect(mainWindow.locator('.project-workspace .terminal-panel')).toHaveCount(1);
	});

	test('deleting an automation closes its tabs and says which edits went with it', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await createAutomation(mainWindow, 'Doomed');
		await front(mainWindow).locator('[data-terminay-automation-edit]').click();
		await field(mainWindow, 'name').fill('Doomed, renamed');
		const editorChip = homeTabChip(mainWindow, 'automation-edit:');
		await expect(editorChip).toHaveAttribute(
			'data-terminay-home-tab-dirty',
			'true',
		);

		const detailChip = homeTabChip(mainWindow, 'automation:');
		await detailChip.click();
		await front(mainWindow)
			.getByRole('button', { name: 'Delete', exact: true })
			.click();
		await front(mainWindow)
			.locator('[data-terminay-automation-confirm-delete]')
			.click();

		await expect(detailChip).toHaveCount(0);
		await expect(editorChip).toHaveCount(0);
		await expect(mainWindow.locator('[data-terminay-home-notice]')).toContainText(
			'were dropped because the automation was deleted',
		);
		await expect(homeTabChips(mainWindow)).toHaveText(['Home', 'Automations']);
	});

	test('Home restores its tabs side by side, and leaves out what no longer exists', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		const automationId = await createAutomation(mainWindow, 'Kept open');
		const tabId = await frontHomeTabId(mainWindow);
		const prefix = tabId.slice(0, tabId.length - automationId.length);

		// What a device remembered: the list beside the automation, plus a tab
		// for an automation that has since been deleted and an unsaved draft.
		const remember = (layout: unknown) =>
			mainWindow.evaluate((value) => {
				window.localStorage.setItem(
					'terminay.view.home-layout.v1',
					typeof value === 'string' ? value : JSON.stringify(value),
				);
			}, layout);
		await remember({
			grid: {
				root: {
					type: 'branch',
					data: [
						{
							type: 'leaf',
							data: { views: ['section:automations'], activeView: 'section:automations', id: '1' },
							size: 500,
						},
						{
							type: 'leaf',
							data: {
								views: [tabId, `${prefix}no-longer-here`, 'automation-new:x:7'],
								activeView: tabId,
								id: '2',
							},
							size: 500,
						},
					],
					size: 600,
				},
				width: 1000,
				height: 600,
				orientation: 'HORIZONTAL',
			},
			panels: {},
			activeGroup: '2',
		});
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });

		// Both are on screen at once, each in its own tab strip.
		await expect(front(mainWindow)).toHaveCount(2);
		await expect(
			mainWindow.locator('[data-terminay-home-tabs] .dv-tabs-and-actions-container'),
		).toHaveCount(2);
		await expect(
			mainWindow.locator(
				'[data-terminay-home-tab-visible="true"] [data-terminay-automation-detail]',
			),
		).toContainText('Kept open');
		await expect(
			mainWindow.locator(
				'[data-terminay-home-tab-visible="true"] [data-terminay-automations-list]',
			),
		).toBeVisible();
		// The draft was never restored; the deleted automation's tab closes
		// itself once the server has answered.
		await expect(homeTabChips(mainWindow)).toHaveText(['Automations', 'Kept open']);
		await expectHomeSection(mainWindow, 'automations');

		// Something unreadable is no arrangement, and no error.
		await remember('{not a layout');
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expect(homeTabChips(mainWindow)).toHaveText(['Home']);
		await expect(
			mainWindow.locator('.workspace-empty-state--error'),
		).toHaveCount(0);
	});

	test('a compact Home shows the tab in front and gives each opened tab a way back', async ({
		electronApp,
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await createAutomation(mainWindow, 'On a phone');

		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 600,
			height: 760,
		});
		// The sidebar becomes a drawer over Home at this width; put it away.
		await expect(
			activeHome(mainWindow).locator('.workspace-split-layout'),
		).toHaveAttribute('data-navigation-drawer', 'true');
		await mainWindow.keyboard.press('Escape');
		await expect(
			mainWindow.locator('[data-terminay-home-sidebar]'),
		).toHaveCount(0);
		// No tab strip is drawn; the tab in front fills Home.
		await expect(
			mainWindow.locator('[data-terminay-home-tabs] .dv-tabs-and-actions-container'),
		).toBeHidden();
		await expect(front(mainWindow)).toHaveCount(1);
		await expect(
			front(mainWindow).locator('[data-terminay-automation-detail]'),
		).toContainText('On a phone');

		// Its own control closes it and returns to the tab it was opened from.
		await front(mainWindow).locator('[data-terminay-automations-back]').click();
		await expect(homeTabChip(mainWindow, 'automation:')).toHaveCount(0);
		await expect(
			front(mainWindow).locator('[data-terminay-automations-list]'),
		).toBeVisible();
	});

	test('the Command Bar finds an automation from a project, and on Home lists no project command', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await createAutomation(mainWindow, 'Findable nightly');
		await mainWindow.locator('.project-tab').first().click();
		await expect(activeHome(mainWindow)).toHaveCount(0);

		// From a project: the automation is a place to go.
		await openMacroLauncher(mainWindow);
		const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		const input = mainWindow.getByRole('searchbox', { name: 'Search commands' });
		await input.fill('findable');
		await commandBar
			.locator('[data-terminay-command-bar-group="Automations"] .macro-launcher-item')
			.first()
			.click();
		await expect(commandBar).toHaveCount(0);
		await expectHomeSection(mainWindow, 'automations');
		await expect(
			front(mainWindow).locator('[data-terminay-automation-detail]'),
		).toContainText('Findable nightly');

		// On Home the shortcut opens it, with the workspace view's own commands.
		await mainWindow.keyboard.press('ControlOrMeta+l');
		await expect(commandBar).toBeVisible();
		await input.fill('edit tab');
		await expect(
			commandBar.getByText('Edit tab settings', { exact: true }),
		).toHaveCount(0);
		await input.fill('new automation');
		await commandBar.getByText('New automation', { exact: true }).click();
		await expect(commandBar).toHaveCount(0);
		expect(await frontHomeTabId(mainWindow)).toMatch(/^automation-new:/);
	});
});
