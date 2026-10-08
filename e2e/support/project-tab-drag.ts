import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect } from '../fixtures';

export type ScreenPoint = { x: number; y: number };

/** The tear-off decision is made in the main process from the OS cursor, which
 * synthetic page input never moves, so the test states where the cursor is. */
export async function setCursorScreenPoint(
	electronApp: ElectronApplication,
	point: ScreenPoint,
): Promise<void> {
	await electronApp.evaluate(({ screen }, next) => {
		screen.getCursorScreenPoint = () => next;
	}, point);
}

/** Screen points on a window's project tab bar and well clear of it. */
export async function tabBarScreenPoints(
	electronApp: ElectronApplication,
	page: Page,
): Promise<{ onBar: ScreenPoint; clearOfBar: ScreenPoint }> {
	const nativeWindow = await electronApp.browserWindow(page);
	const content = await nativeWindow.evaluate((window) =>
		window.getContentBounds(),
	);
	const x = Math.round(content.x + content.width / 2);
	return {
		onBar: { x, y: content.y + 24 },
		clearOfBar: { x, y: content.y + 400 },
	};
}

/** Pull a project tab out of its strip and keep holding it, torn off. */
export async function holdTornOffProjectTab(
	electronApp: ElectronApplication,
	page: Page,
	tab: Locator,
): Promise<void> {
	const { clearOfBar } = await tabBarScreenPoints(electronApp, page);
	const box = await tab.boundingBox();
	if (!box) throw new Error('Expected the project tab to have a layout box');
	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;
	await setCursorScreenPoint(electronApp, clearOfBar);
	const windowCount = () =>
		electronApp.evaluate(
			({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
		);
	const windowsBeforeDrag = await windowCount();
	await page.mouse.move(centerX, centerY);
	await page.mouse.down();
	await page.mouse.move(centerX, centerY + 180, { steps: 12 });
	// The main process shows a drag ghost window once the tab is torn off.
	await expect.poll(windowCount).toBe(windowsBeforeDrag + 1);
}

/** Pull a project tab out of its strip and release it with the cursor at
 * `releaseAt`. */
export async function tearOffProjectTab(
	electronApp: ElectronApplication,
	page: Page,
	tab: Locator,
	releaseAt: ScreenPoint,
): Promise<void> {
	await holdTornOffProjectTab(electronApp, page, tab);
	await setCursorScreenPoint(electronApp, releaseAt);
	await page.mouse.up();
}
