import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { createStartedProject } from './support/project-start';
import { synchronizeWorkspace } from './support/workspace-sync';

/**
 * Creating terminals back to back, without ever using the terminals that
 * appear. A tab that is created must stay created: the reported failure is a
 * new tab that flashes into the strip and is then taken away again, which
 * means the workspace removed a panel it had just adopted — and, through the
 * Dockview removal path, closed its server session with it.
 */

const addTabButton = (page: Page) =>
	page.locator('.project-workspace--active .terminay-add-tab-button').first();
const terminalTabs = (page: Page) =>
	page.locator('.project-workspace--active').getByLabel('Close terminal');

/**
 * Record the renderer's own workspace diagnostics so a lost tab reports what
 * the workspace was doing when it went, not just that it is missing.
 */
async function recordWorkspaceDiagnostics(page: Page): Promise<void> {
	await page.evaluate(() => {
		const sink = globalThis as unknown as {
			__terminayRendererDiagnostic?: unknown;
			__terminayDiagnosticLog?: string[];
		};
		sink.__terminayDiagnosticLog = [];
		sink.__terminayRendererDiagnostic = (diagnostic: {
			phase?: string;
			count?: number;
		}) => {
			sink.__terminayDiagnosticLog?.push(
				`${Date.now()} ${diagnostic.phase ?? 'unknown'}${
					diagnostic.count === undefined ? '' : ` (${diagnostic.count})`
				}`,
			);
			if ((sink.__terminayDiagnosticLog?.length ?? 0) > 4_000)
				sink.__terminayDiagnosticLog?.shift();
		};
	});
}

async function workspaceReport(page: Page): Promise<string> {
	const report = await page.evaluate(() => {
		const sink = globalThis as unknown as {
			__terminayDiagnosticLog?: string[];
		};
		const panels = [
			...document.querySelectorAll(
				'.project-workspace--active .terminal-panel[data-terminay-terminal-session-id]',
			),
		].map((panel) => panel.getAttribute('data-terminay-terminal-session-id'));
		const tabs = [
			...document.querySelectorAll(
				'.project-workspace--active .terminal-tab-title',
			),
		].map((tab) => tab.textContent);
		const error = document.querySelector('.error-banner')?.textContent ?? null;
		return {
			panels,
			tabs,
			error,
			diagnostics: (sink.__terminayDiagnosticLog ?? []).slice(-60),
		};
	});
	return JSON.stringify(report, null, 2);
}

/** Settle on a tab count, reporting what the workspace did if it never does. */
async function expectTerminalCount(
	page: Page,
	expected: number,
): Promise<void> {
	try {
		await expect(terminalTabs(page)).toHaveCount(expected, { timeout: 15_000 });
	} catch (error) {
		throw new Error(
			`Expected ${expected} terminal tabs, found ${await terminalTabs(page).count()}.\n${await workspaceReport(page)}`,
			{ cause: error },
		);
	}
}

/**
 * A tab count that still holds once the window has drawn every revision of
 * the workspace the server has committed: a tab the workspace was going to
 * take away would be gone by then, since only a revision reconciles it.
 */
async function expectStableTerminalCount(
	electronApp: ElectronApplication,
	page: Page,
	expected: number,
): Promise<void> {
	await synchronizeWorkspace(electronApp, page);
	const count = await terminalTabs(page).count();
	if (count !== expected) {
		throw new Error(
			`Expected ${expected} terminal tabs, found ${count}.\n${await workspaceReport(page)}`,
		);
	}
}

/**
 * Click the add-tab button `clicks` times. Where `wait` says so, the next
 * click waits until the tab the last one asked for is in the strip: still
 * starting, never used. Elsewhere it follows at once. Every click lands while
 * a terminal from one before it is still being set up.
 */
async function addTabs(
	page: Page,
	from: number,
	wait: readonly boolean[],
): Promise<number> {
	let expected = from;
	for (const waitForTab of wait) {
		await addTabButton(page).click();
		expected += 1;
		if (waitForTab) await expect(terminalTabs(page)).toHaveCount(expected);
	}
	return expected;
}

test('keeps every terminal added by repeated add-tab clicks', async ({
	electronApp,
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	// Some clicks follow at once, some once the last click's tab is in the
	// strip, and none of the terminals is ever typed into.
	const expected = await addTabs(mainWindow, 1, [
		false,
		true,
		true,
		true,
		true,
		false,
		true,
		true,
	]);

	await expectTerminalCount(mainWindow, expected);
	await expectStableTerminalCount(electronApp, mainWindow, expected);
});

test('keeps both terminals when the add-tab button is clicked twice in a row', async ({
	electronApp,
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	await addTabButton(mainWindow).click();
	await expect(terminalTabs(mainWindow)).toHaveCount(2);
	await addTabButton(mainWindow).click();

	await expect(terminalTabs(mainWindow)).toHaveCount(3, { timeout: 15_000 });
	await expectStableTerminalCount(electronApp, mainWindow, 3);
});

test('keeps both terminals when two add-tab clicks overlap', async ({
	electronApp,
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	// Two clicks inside one creation round trip: the second is dispatched
	// before the first has resolved a session, a panel, or an active tab.
	await Promise.all([
		addTabButton(mainWindow).click(),
		addTabButton(mainWindow).click(),
	]);

	await expect(terminalTabs(mainWindow)).toHaveCount(3, { timeout: 15_000 });
	await expectStableTerminalCount(electronApp, mainWindow, 3);
});

test('keeps terminals added to a second project while the first still holds its own', async ({
	electronApp,
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	// Terminals in the project the user is not looking at are still live
	// sessions in the workspace projection every reconciliation pass walks.
	await addTabButton(mainWindow).click();
	await addTabButton(mainWindow).click();
	await expect(terminalTabs(mainWindow)).toHaveCount(3, { timeout: 15_000 });

	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await expect(terminalTabs(mainWindow)).toHaveCount(1, { timeout: 15_000 });

	await addTabs(mainWindow, 1, [false, true, false, true]);

	await expectTerminalCount(mainWindow, 5);
	await expectStableTerminalCount(electronApp, mainWindow, 5);
});

async function waitForWorkspacePopout(
	electronApp: ElectronApplication,
	mainWindow: Page,
): Promise<Page> {
	let popout: Page | undefined;
	await expect
		.poll(
			async () => {
				popout = electronApp
					.windows()
					.find(
						(page) =>
							page !== mainWindow &&
							!page.isClosed() &&
							!page.url().startsWith('about:blank') &&
							!page.url().startsWith('data:'),
					);
				return popout === undefined
					? false
					: (await popout.locator('[data-terminay-app-component]').count()) > 0;
			},
			{ timeout: 20_000 },
		)
		.toBe(true);
	if (popout === undefined)
		throw new Error('Expected the project popout window');
	return popout;
}

/**
 * The workspace projection is server-wide, so a project presented in another
 * window still contributes its terminal sessions to every window's
 * reconciliation pass. Creating terminals here must not be disturbed by the
 * sessions this window does not present.
 */
test('keeps terminals created while another window presents a project', async ({
	electronApp,
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);

	await sendAppCommand(mainWindow, 'popout-active');
	await waitForWorkspacePopout(electronApp, mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	const expected = await addTabs(mainWindow, 1, [
		false,
		true,
		true,
		false,
		true,
		true,
		true,
		false,
	]);

	await expectTerminalCount(mainWindow, expected);
	await expectStableTerminalCount(electronApp, mainWindow, expected);
});
