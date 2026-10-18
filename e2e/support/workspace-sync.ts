import { type ElectronApplication, expect, type Page } from '@playwright/test';

/** The revision of the canonical workspace this window last drew. */
export async function workspaceRevision(page: Page): Promise<number> {
	return Number(
		await page
			.locator('.app-shell')
			.first()
			.getAttribute('data-terminay-workspace-revision'),
	);
}

/**
 * Do something that changes the canonical workspace, and wait until this
 * window has drawn a revision after it. The window draws the revision in the
 * same render that reconciles its projects with it, so what it shows from
 * then on is what that synchronization left: a negative assertion made after
 * it is ordered after the pass that would have broken it.
 */
export async function afterWorkspaceSync(
	page: Page,
	change: () => Promise<unknown>,
): Promise<void> {
	const before = await workspaceRevision(page);
	await change();
	await expect.poll(() => workspaceRevision(page)).toBeGreaterThan(before);
}

/**
 * Wait until this window has drawn every revision of the canonical workspace
 * the embedded server has committed so far. A window reconciles its projects
 * only when a revision arrives, so once it has drawn the latest there is no
 * reconciliation still to come, and what it shows is what they all left.
 */
export async function synchronizeWorkspace(
	electronApp: ElectronApplication,
	page: Page,
): Promise<void> {
	const committed = await electronApp.evaluate(() =>
		(
			globalThis as typeof globalThis & {
				__terminayTestWorkspaceRevision?: () => number;
			}
		).__terminayTestWorkspaceRevision?.(),
	);
	if (committed === undefined)
		throw new Error('The workspace revision test seam is unavailable.');
	await expect
		.poll(() => workspaceRevision(page))
		.toBeGreaterThanOrEqual(committed);
}
