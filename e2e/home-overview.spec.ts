import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { activeHome, frontHomeTab } from './support/home-tabs';

/**
 * The Home overview: its widget catalogue, the quick actions, and edit mode.
 * The layout is a server setting (ADR-0101), so a change outlives a reload.
 */

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });
const overview = (page: Page) =>
	frontHomeTab(page).locator('[data-terminay-home-overview]');
const widgets = (page: Page) =>
	overview(page).locator('.home-overview__grid [data-terminay-home-widget]');
const widget = (page: Page, id: string): Locator =>
	overview(page).locator(`[data-terminay-home-widget="${id}"]`);
const tools = (page: Page, id: string): Locator =>
	overview(page).locator(`[data-terminay-home-widget-tools="${id}"]`);

const DEFAULT_ORDER = [
	'quick-actions',
	'needs-you',
	'agents',
	'workflows',
	'bots',
	'run-history',
	'pull-requests',
	'notifications',
	'projects',
	'bot-sessions',
	'automations',
	'recordings',
];

async function widgetOrder(page: Page): Promise<string[]> {
	return widgets(page).evaluateAll((nodes) =>
		nodes.map((node) => node.getAttribute('data-terminay-home-widget') ?? ''),
	);
}

async function openOverview(page: Page): Promise<void> {
	await homeControl(page).click();
	await expect(activeHome(page)).toHaveAttribute(
		'data-terminay-home-view',
		'home',
	);
	await expect(overview(page)).toBeVisible();
}

/** Bring the Home section's tab back to the front from another Home tab. */
async function backToOverview(page: Page): Promise<void> {
	await page.locator('[data-terminay-home-section-tab="home"]').click();
	await expect(overview(page)).toBeVisible();
}

test.describe('Home overview', () => {
	test('shows the default widgets in order, with Tabs and Connections hidden', async ({
		mainWindow,
	}, testInfo) => {
		await openOverview(mainWindow);
		await expect.poll(() => widgetOrder(mainWindow)).toEqual(DEFAULT_ORDER);
		await expect(widget(mainWindow, 'quick-actions')).toHaveAttribute(
			'data-terminay-home-widget-size',
			'wide',
		);
		await expect(widget(mainWindow, 'needs-you')).toContainText(
			'Nothing needs you',
		);
		await expect(widget(mainWindow, 'recordings')).toContainText(
			'No recordings yet',
		);
		await expect(
			widget(mainWindow, 'agents').locator('[data-terminay-home-agent-group]'),
		).toHaveCount(4);

		// Strict order: with wide and small widgets mixed, no later widget is
		// placed before an earlier one to fill a gap.
		const boxes = await widgets(mainWindow).evaluateAll((nodes) =>
			nodes.map((node) => {
				const box = node.getBoundingClientRect();
				return { top: Math.round(box.top), left: Math.round(box.left) };
			}),
		);
		for (let index = 1; index < boxes.length; index += 1) {
			const before = boxes[index - 1];
			const after = boxes[index];
			expect(
				after.top > before.top ||
					(after.top === before.top && after.left > before.left),
			).toBe(true);
		}
		await mainWindow.setViewportSize({ width: 1440, height: 1000 });
		await mainWindow.screenshot({
			path: testInfo.outputPath('home-overview.png'),
			fullPage: true,
		});
	});

	test('edit mode hides, adds back, reorders, resizes, and resets, and the layout survives a reload', async ({
		mainWindow,
	}, testInfo) => {
		await openOverview(mainWindow);
		await overview(mainWindow).locator('[data-terminay-home-customise]').click();
		await expect(overview(mainWindow)).toHaveAttribute(
			'data-terminay-home-overview-editing',
			'true',
		);
		const tray = overview(mainWindow).locator(
			'[data-terminay-home-hidden-widgets]',
		);
		await expect(
			tray.locator('[data-terminay-home-widget-add="connections"]'),
		).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('home-overview-editing.png'),
			fullPage: true,
		});

		// Hide Recordings: it leaves the grid for the tray.
		await tools(mainWindow, 'recordings')
			.locator('[data-terminay-home-widget-hide]')
			.click();
		await expect(widget(mainWindow, 'recordings')).toHaveCount(0);
		await expect(
			tray.locator('[data-terminay-home-widget-add="recordings"]'),
		).toBeVisible();

		// Add Connections back: it joins after the last shown widget.
		await tray.locator('[data-terminay-home-widget-add="connections"]').click();
		await expect
			.poll(async () => (await widgetOrder(mainWindow)).at(-1))
			.toBe('connections');

		// Move Bots earlier: it swaps with Workflows.
		await tools(mainWindow, 'bots')
			.locator('[data-terminay-home-widget-move="earlier"]')
			.click();
		await expect
			.poll(async () => (await widgetOrder(mainWindow)).slice(2, 5))
			.toEqual(['agents', 'bots', 'workflows']);

		// Make Bots wide; Quick actions offers no tall size.
		await tools(mainWindow, 'bots')
			.locator('[data-terminay-home-widget-resize="wide"]')
			.click();
		await expect(widget(mainWindow, 'bots')).toHaveAttribute(
			'data-terminay-home-widget-size',
			'wide',
		);
		await expect(
			tools(mainWindow, 'quick-actions').locator(
				'[data-terminay-home-widget-resize="tall"]',
			),
		).toHaveCount(0);

		// While editing, a widget's contents do not navigate.
		await expect(
			widget(mainWindow, 'quick-actions').locator('.home-widget__body'),
		).toHaveAttribute('inert', '');

		await overview(mainWindow).locator('[data-terminay-home-layout-done]').click();
		const edited = await widgetOrder(mainWindow);

		// The layout is the server's, so a reload shows it unchanged.
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await openOverview(mainWindow);
		await expect.poll(() => widgetOrder(mainWindow)).toEqual(edited);
		await expect(widget(mainWindow, 'bots')).toHaveAttribute(
			'data-terminay-home-widget-size',
			'wide',
		);

		// Reset returns every widget to its default.
		await overview(mainWindow).locator('[data-terminay-home-customise]').click();
		await overview(mainWindow).locator('[data-terminay-home-layout-reset]').click();
		await expect.poll(() => widgetOrder(mainWindow)).toEqual(DEFAULT_ORDER);
		await expect(widget(mainWindow, 'bots')).toHaveAttribute(
			'data-terminay-home-widget-size',
			'small',
		);
	});

	test('quick actions reach their destinations', async ({ mainWindow }) => {
		await openOverview(mainWindow);
		const action = (id: string) =>
			widget(mainWindow, 'quick-actions').locator(
				`[data-terminay-home-quick-action="${id}"]`,
			);

		await action('new-automation').click();
		await expect(
			frontHomeTab(mainWindow).locator('[data-terminay-automation-editor]'),
		).toBeVisible();

		await backToOverview(mainWindow);
		await action('new-bot').click();
		await expect(activeHome(mainWindow)).toHaveAttribute(
			'data-terminay-home-view',
			'bots',
		);

		await backToOverview(mainWindow);
		await action('command-bar').click();
		await expect(
			mainWindow.getByRole('dialog', { name: 'Command bar' }),
		).toBeVisible();
		await mainWindow.keyboard.press('Escape');

		await backToOverview(mainWindow);
		const projects = await mainWindow.locator('.project-tab').count();
		await action('new-project').click();
		await expect(mainWindow.locator('.project-tab')).toHaveCount(projects + 1);
	});
});
