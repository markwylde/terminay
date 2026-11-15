import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMacroLauncher, sendAppCommand } from './support/app';
import { activeHome } from './support/home-tabs';

/**
 * On a phone, Home has no sidebar and no on-page toolbar. The trailing header
 * control opens the Home options panel: a drawer from the trailing edge that
 * holds the front section's search, filters, and view controls.
 */

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;
const WIDE = { x: 40, y: 40, width: 1280, height: 820 } as const;

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

const chrome = (page: Page) => page.locator('[data-compact-chrome="true"]');
const toggle = (page: Page) =>
	page.locator('[data-compact-home-options-toggle="true"]');
const panel = (page: Page) => page.locator('[data-home-options-panel="true"]');
const switcher = (page: Page) =>
	page.getByRole('dialog', { name: 'Switch terminal' });
const homeSidebar = (page: Page) =>
	page.locator('[data-terminay-home-sidebar]');

async function settled(locator: Locator): Promise<void> {
	await locator.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished)),
	);
}

async function goToPhone(page: Page, electronApp: ElectronApplication) {
	await expect(page.locator('[data-terminay-app-component]')).toBeVisible();
	await resize(page, electronApp, PHONE);
	await expect(chrome(page)).toBeVisible();
}

/** Opens a Home section from the switcher's Home panel. */
async function openSection(page: Page, section: string): Promise<void> {
	await page.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = switcher(page);
	await expect(drawer).toBeVisible();
	await settled(drawer);
	await drawer.locator('[data-compact-switcher-home="true"]').click();
	await drawer.locator(`[data-compact-home-section="${section}"]`).click();
	await expect(drawer).toHaveCount(0);
	await expect(activeHome(page)).toHaveAttribute(
		'data-terminay-home-view',
		section,
	);
}

async function listedSections(page: Page): Promise<string[]> {
	await page.locator('[data-compact-breadcrumb="true"]').click();
	const drawer = switcher(page);
	await expect(drawer).toBeVisible();
	await settled(drawer);
	await drawer.locator('[data-compact-switcher-home="true"]').click();
	const sections = await drawer
		.locator('[data-compact-home-section]')
		.evaluateAll((items) =>
			items.map((item) => item.getAttribute('data-compact-home-section') ?? ''),
		);
	await page.keyboard.press('Escape');
	await expect(drawer).toHaveCount(0);
	return sections;
}

async function openPanel(page: Page): Promise<Locator> {
	await toggle(page).click();
	await expect(panel(page)).toBeVisible();
	await settled(panel(page));
	return panel(page);
}

test.describe('command bar close control', () => {
	test('the close control closes the command bar on a wide window', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, WIDE);
		await openMacroLauncher(mainWindow);
		const bar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		await bar.getByRole('button', { name: 'Close command bar' }).click();
		await expect(bar).toHaveCount(0);
	});

	test('a tap on the close control closes the command bar on a phone', async ({
		electronApp,
		mainWindow,
	}) => {
		await goToPhone(mainWindow, electronApp);
		await openMacroLauncher(mainWindow);
		const bar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		const close = bar.getByRole('button', { name: 'Close command bar' });
		await expect(close).toBeVisible();
		await close.click();
		await expect(bar).toHaveCount(0);
	});
});

test.describe('compact Home options panel', () => {
	test('every section but the overview offers its controls in the panel', async ({
		electronApp,
		mainWindow,
	}, testInfo) => {
		await goToPhone(mainWindow, electronApp);
		const sections = await listedSections(mainWindow);
		expect(sections).toContain('home');
		expect(sections).toContain('tabs');

		for (const section of sections) {
			await openSection(mainWindow, section);
			await expect(homeSidebar(mainWindow)).toHaveCount(0);
			if (section === 'home') {
				await expect(toggle(mainWindow)).toHaveCount(0);
				continue;
			}
			// Automations has controls only with more than one server.
			if (section === 'automations') {
				await expect(toggle(mainWindow)).toHaveCount(0);
				continue;
			}
			await expect(toggle(mainWindow)).toBeVisible();
			await expect(toggle(mainWindow)).toHaveAttribute(
				'aria-label',
				/^Show options/,
			);
			const drawer = await openPanel(mainWindow);
			await expect(toggle(mainWindow)).toHaveAttribute('aria-pressed', 'true');
			await expect(
				drawer.locator('[data-home-options-controls] > *').first(),
			).toBeVisible();
			// The panel sits on the trailing edge and stays inside the screen.
			const box = await drawer.boundingBox();
			expect(box).not.toBeNull();
			if (box) {
				expect(box.x).toBeGreaterThan(0);
				expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(PHONE.width);
			}
			await mainWindow.screenshot({
				path: testInfo.outputPath('home-options', `${section}.png`),
			});
			await drawer.getByRole('button', { name: 'Close options' }).click();
			await expect(panel(mainWindow)).toHaveCount(0);
		}
	});

	test('a filter marks the toggle, survives a round trip, and the empty state clears it', async ({
		electronApp,
		mainWindow,
	}, testInfo) => {
		await goToPhone(mainWindow, electronApp);
		await openSection(mainWindow, 'tabs');
		await expect(toggle(mainWindow)).toHaveAttribute('data-filtered', 'false');

		const drawer = await openPanel(mainWindow);
		const filter = drawer.getByRole('searchbox', {
			name: 'Filter the dashboard',
		});
		await filter.fill('zz-no-such-thing');
		await mainWindow.keyboard.press('Escape');
		await expect(panel(mainWindow)).toHaveCount(0);
		// Focus goes back to the control that opened it.
		await expect(toggle(mainWindow)).toBeFocused();

		await expect(toggle(mainWindow)).toHaveAttribute('data-filtered', 'true');
		await expect(toggle(mainWindow)).toHaveAttribute(
			'aria-label',
			'Show options, filters applied',
		);
		await expect(
			mainWindow.locator('.compact-chrome__filtered-dot'),
		).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('home-options', 'tabs-filtered-empty.png'),
		});

		// The controls stay mounted while the panel is shut.
		const reopened = await openPanel(mainWindow);
		await expect(
			reopened.getByRole('searchbox', { name: 'Filter the dashboard' }),
		).toHaveValue('zz-no-such-thing');
		await reopened.getByRole('button', { name: 'Close options' }).click();

		const clear = mainWindow.locator('[data-home-clear-filters="true"]');
		await expect(clear).toBeVisible();
		await clear.click();
		await expect(toggle(mainWindow)).toHaveAttribute('data-filtered', 'false');
	});

	test('the toggle follows the tab in front and a filter survives a round trip and the breakpoint', async ({
		electronApp,
		mainWindow,
	}) => {
		await goToPhone(mainWindow, electronApp);
		await openSection(mainWindow, 'workflows');
		let drawer = await openPanel(mainWindow);
		await expect(drawer.locator('.home-options__title')).toHaveText(
			'Workflows',
		);
		await drawer
			.getByRole('textbox', { name: 'Filter workflows' })
			.or(drawer.getByRole('searchbox', { name: 'Filter workflows' }))
			.fill('zz-kept');
		await drawer.getByRole('button', { name: 'Close options' }).click();
		await expect(toggle(mainWindow)).toHaveAttribute('data-filtered', 'true');

		// Bots in front: its own panel, unfiltered.
		await openSection(mainWindow, 'bots');
		await expect(toggle(mainWindow)).toHaveAttribute('data-filtered', 'false');
		drawer = await openPanel(mainWindow);
		await expect(drawer.locator('.home-options__title')).toHaveText('Bots');
		await drawer.getByRole('button', { name: 'Close options' }).click();

		// Back to Workflows: the filter is still there.
		await openSection(mainWindow, 'workflows');
		await expect(toggle(mainWindow)).toHaveAttribute('data-filtered', 'true');

		// Widening puts the same control, with the same value, on the page.
		await resize(mainWindow, electronApp, WIDE);
		await expect(chrome(mainWindow)).toHaveCount(0);
		await expect(mainWindow.getByLabel('Filter workflows').first()).toHaveValue(
			'zz-kept',
		);
	});

	test('the panel closes on the scrim, Escape, and leaving compact', async ({
		electronApp,
		mainWindow,
	}) => {
		await goToPhone(mainWindow, electronApp);
		await openSection(mainWindow, 'tabs');

		await openPanel(mainWindow);
		const scrim = mainWindow.locator('.home-options-scrim');
		await scrim.click({ position: { x: 10, y: 300 } });
		await expect(panel(mainWindow)).toHaveCount(0);

		await openPanel(mainWindow);
		await mainWindow.keyboard.press('Escape');
		await expect(panel(mainWindow)).toHaveCount(0);

		// The Command Bar opening closes it.
		await openPanel(mainWindow);
		await sendAppCommand(mainWindow, 'open-command-bar');
		await expect(panel(mainWindow)).toHaveCount(0);
		await expect(
			mainWindow.getByRole('dialog', { name: 'Command bar' }),
		).toBeVisible();
		await mainWindow.keyboard.press('Escape');

		// A wider window has no panel; the controls are back on the page.
		await openPanel(mainWindow);
		await resize(mainWindow, electronApp, WIDE);
		await expect(panel(mainWindow)).toHaveCount(0);
		await expect(chrome(mainWindow)).toHaveCount(0);
	});

	test('focus stays in the panel while it is open', async ({
		electronApp,
		mainWindow,
	}) => {
		await goToPhone(mainWindow, electronApp);
		await openSection(mainWindow, 'tabs');
		const drawer = await openPanel(mainWindow);
		for (let step = 0; step < 8; step++) {
			await mainWindow.keyboard.press('Tab');
			const inside = await drawer.evaluate((element) =>
				element.contains(document.activeElement),
			);
			expect(inside).toBe(true);
		}
	});

	test('with reduced motion the panel opens without animating', async ({
		electronApp,
		mainWindow,
	}) => {
		await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
		await goToPhone(mainWindow, electronApp);
		await openSection(mainWindow, 'tabs');
		await toggle(mainWindow).click();
		await expect(panel(mainWindow)).toBeVisible();
		const running = await panel(mainWindow).evaluate(
			(element) =>
				element
					.getAnimations({ subtree: true })
					.filter((animation) => animation.playState === 'running').length,
		);
		expect(running).toBe(0);
	});

	test('a phone visit leaves the wide Home sidebar choice alone', async ({
		electronApp,
		mainWindow,
	}) => {
		await resize(mainWindow, electronApp, WIDE);
		await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
		await expect(homeSidebar(mainWindow)).toBeVisible();

		await resize(mainWindow, electronApp, PHONE);
		await expect(chrome(mainWindow)).toBeVisible();
		await expect(homeSidebar(mainWindow)).toHaveCount(0);

		await resize(mainWindow, electronApp, WIDE);
		await expect(chrome(mainWindow)).toHaveCount(0);
		await expect(homeSidebar(mainWindow)).toBeVisible();
	});
});
