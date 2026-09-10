import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';

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
		].map((panel) =>
			panel.getAttribute('data-terminay-terminal-session-id'),
		);
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
	settleMs = 15_000,
): Promise<void> {
	const deadline = Date.now() + settleMs;
	do {
		if ((await terminalTabs(page).count()) === expected) return;
		await page.waitForTimeout(200);
	} while (Date.now() < deadline);
	throw new Error(
		`Expected ${expected} terminal tabs, found ${await terminalTabs(page).count()}.\n${await workspaceReport(page)}`,
	);
}

/** A tab count that has to still hold after the workspace settles. */
async function expectStableTerminalCount(
	page: Page,
	expected: number,
	holdMs = 2_500,
): Promise<void> {
	const deadline = Date.now() + holdMs;
	do {
		const count = await terminalTabs(page).count();
		if (count !== expected) {
			throw new Error(
				`Expected ${expected} terminal tabs, found ${count}.\n${await workspaceReport(page)}`,
			);
		}
		await page.waitForTimeout(250);
	} while (Date.now() < deadline);
}

test('keeps every terminal added by repeated add-tab clicks', async ({
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	// Every click lands while the terminal from the click before is still
	// starting, and none of them is ever typed into.
	const delaysMs = [0, 40, 120, 250, 40, 0, 160, 60];
	let expected = 1;
	for (const delayMs of delaysMs) {
		await addTabButton(mainWindow).click();
		expected += 1;
		if (delayMs > 0) await mainWindow.waitForTimeout(delayMs);
	}

	await expectTerminalCount(mainWindow, expected);
	await expectStableTerminalCount(mainWindow, expected);
});

test('keeps both terminals when the add-tab button is clicked twice in a row', async ({
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	await addTabButton(mainWindow).click();
	await expect(terminalTabs(mainWindow)).toHaveCount(2);
	await addTabButton(mainWindow).click();

	await expect(terminalTabs(mainWindow)).toHaveCount(3, { timeout: 15_000 });
	await expectStableTerminalCount(mainWindow, 3);
});

test('keeps both terminals when two add-tab clicks overlap', async ({
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
	await expectStableTerminalCount(mainWindow, 3);
});

test('keeps terminals added to a second project while the first still holds its own', async ({
	mainWindow,
}) => {
	await recordWorkspaceDiagnostics(mainWindow);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	// Terminals in the project the user is not looking at are still live
	// sessions in the workspace projection every reconciliation pass walks.
	await addTabButton(mainWindow).click();
	await addTabButton(mainWindow).click();
	await expect(terminalTabs(mainWindow)).toHaveCount(3, { timeout: 15_000 });

	await mainWindow.getByLabel('Create project').click();
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await expect(terminalTabs(mainWindow)).toHaveCount(1, { timeout: 15_000 });

	for (const delayMs of [0, 100, 0, 200]) {
		await addTabButton(mainWindow).click();
		if (delayMs > 0) await mainWindow.waitForTimeout(delayMs);
	}

	await expectTerminalCount(mainWindow, 5);
	await expectStableTerminalCount(mainWindow, 5);
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
	if (popout === undefined) throw new Error('Expected the project popout window');
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

	await mainWindow.getByLabel('Create project').click();
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);

	await sendAppCommand(mainWindow, 'popout-active');
	await waitForWorkspacePopout(electronApp, mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await expect(terminalTabs(mainWindow)).toHaveCount(1);

	const delaysMs = [0, 60, 120, 0, 250, 40, 90, 0];
	let expected = 1;
	for (const delayMs of delaysMs) {
		await addTabButton(mainWindow).click();
		expected += 1;
		if (delayMs > 0) await mainWindow.waitForTimeout(delayMs);
	}

	await expectTerminalCount(mainWindow, expected);
	await expectStableTerminalCount(mainWindow, expected);
});
