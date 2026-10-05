import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Home keeps every tab rendered, and stays mounted while a project is in
 * front, so a locator for something inside Home has to say which tab it means.
 * These name the parts of Home a person can actually see.
 */

/** Home, while it is the selected view. Absent while a project is in front. */
export const activeHome = (page: Page): Locator =>
	page.locator('[data-terminay-home-view][data-terminay-home-active="true"]');

/** The Home tab on screen. With tabs side by side there is one per group. */
export const frontHomeTab = (page: Page): Locator =>
	page.locator(
		'[data-terminay-home-tab-panel][data-terminay-home-tab-visible="true"]',
	);

/** Every tab chip in Home's tab strip, in order. */
export const homeTabChips = (page: Page): Locator =>
	page.locator('[data-terminay-home-tab]');

/** The chip of the tab whose id starts with `idPrefix`, e.g. `automation:`. */
export const homeTabChip = (page: Page, idPrefix: string): Locator =>
	page.locator(`[data-terminay-home-tab^="${idPrefix}"]`);

export async function frontHomeTabId(page: Page): Promise<string> {
	const id = await frontHomeTab(page).getAttribute(
		'data-terminay-home-tab-panel',
	);
	if (id === null) throw new Error('No Home tab is in front');
	return id;
}

/** Close the tab in front with its own close control. */
export async function closeFrontHomeTab(page: Page): Promise<void> {
	const id = await frontHomeTabId(page);
	await page.locator(`[data-terminay-home-tab-close="${id}"]`).click();
}

export async function expectHomeSection(
	page: Page,
	section: 'home' | 'tabs' | 'automations' | 'none',
): Promise<void> {
	await expect(activeHome(page)).toHaveAttribute(
		'data-terminay-home-view',
		section,
	);
}
