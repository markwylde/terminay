import { type ElectronApplication, expect, type Page } from '@playwright/test';

type BusyTerminalsMain = typeof globalThis & {
	__terminayTestRunningTerminalCountForWindow?: (
		webContentsId: number,
	) => Promise<number>;
};

/**
 * Wait until the application counts a terminal of this window as running a
 * foreground process: what decides whether closing or quitting asks first.
 */
export async function waitUntilBusy(
	electronApp: ElectronApplication,
	page: Page,
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	const webContentsId = await nativeWindow.evaluate(
		(window) => window.webContents.id,
	);
	await expect
		.poll(() =>
			electronApp.evaluate(async (_electron, id) => {
				const count = await (
					globalThis as BusyTerminalsMain
				).__terminayTestRunningTerminalCountForWindow?.(id);
				return count ?? 0;
			}, webContentsId),
		)
		.toBeGreaterThan(0);
}
