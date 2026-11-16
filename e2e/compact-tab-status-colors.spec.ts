import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Status on a phone matches the wide workspace (workspace-dashboard): a Tabs
 * row draws the same agent status indicator, in the same colours, as the
 * dashboard on a wide window. Status colours have one source (ADR-0126).
 */

test.describe.configure({ timeout: 180_000 });

const READY = 20_000;
const WIDE = { x: 40, y: 40, width: 1280, height: 820 } as const;
const PHONE = { x: 40, y: 40, width: 390, height: 780 } as const;
const AMBER = 'rgb(232, 185, 49)';
const RED = 'rgb(238, 98, 88)';

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

const activeSessionId = (page: Page) =>
	page
		.locator('.project-workspace--active .terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');

async function publishAgent(
	page: Page,
	sessionId: string,
	id: string,
	title: string,
	status: string,
): Promise<void> {
	const accepted = await page.evaluate(
		async ({ sessionId, id, title, status }) => {
			const seam = window.terminayAgentStatusTest;
			if (!seam) throw new Error('Agent status test seam is unavailable');
			const pid = await seam.terminalShellPid(sessionId);
			if (pid === null) throw new Error('Terminal shell pid is unavailable');
			return await seam.publishSessions({
				sourceId: `com.terminay.e2e/${id}`,
				harnesses: [{ id: 'codex', displayName: 'Codex' }],
				publication: {
					upserts: [{ harness: 'codex', pid, cwd: '/tmp', id, title, status }],
				},
			});
		},
		{ sessionId, id, title, status },
	);
	if (!accepted) throw new Error('Agent session publication was not accepted');
}

const colourOf = (
	locator: import('@playwright/test').Locator,
	property: 'color' | 'backgroundColor' | 'animationName',
) =>
	locator.evaluate(
		(element, name) => getComputedStyle(element)[name],
		property,
	);

test('a phone draws Tabs status in the wide workspace colours', async ({
	appHarness,
	electronApp,
	mainWindow,
}, testInfo) => {
	const working = await activeSessionId(mainWindow);
	if (!working) throw new Error('Expected the first terminal session');
	await appHarness.sendAppCommand('new-terminal');
	await expect.poll(() => activeSessionId(mainWindow)).not.toBe(working);
	const waiting = await activeSessionId(mainWindow);
	if (!waiting) throw new Error('Expected the second terminal session');
	await publishAgent(mainWindow, working, 'codex-e2e-working', 'Fix the flaky upload', 'running');
	await publishAgent(mainWindow, waiting, 'codex-e2e-waiting', 'Approve the migration', 'waiting');

	// Wide: the dashboard card's indicator is the reference.
	await resize(mainWindow, electronApp, WIDE);
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toHaveCount(0, { timeout: READY });
	await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
	await mainWindow.locator('[data-terminay-home-section-tab="tabs"]').click();
	const wideWorking = mainWindow
		.locator('.workspace-dashboard [data-terminay-dashboard-status="working"] .agent-status-indicator')
		.first();
	await expect(wideWorking).toBeVisible({ timeout: READY });
	expect(await colourOf(wideWorking, 'color')).toBe(AMBER);

	// Phone: the same indicator, the same colours, the same breathing.
	await resize(mainWindow, electronApp, PHONE);
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toBeVisible({ timeout: READY });
	const tabs = mainWindow.locator('[data-compact-section="tabs"]');
	await expect(tabs).toBeVisible({ timeout: READY });

	const workingRow = tabs.locator('[data-terminay-dashboard-status="working"]').first();
	const workingDot = workingRow.locator('.agent-status-indicator');
	await expect(workingDot).toHaveAttribute('data-agent-state', 'working', { timeout: READY });
	expect(await colourOf(workingDot, 'color')).toBe(AMBER);
	expect(
		await colourOf(workingDot.locator('.agent-status-indicator__glyph'), 'animationName'),
	).toBe('agent-status-breathe');

	const waitingRow = tabs.locator('[data-terminay-dashboard-status="waiting"]').first();
	const waitingDot = waitingRow.locator('.agent-status-indicator');
	await expect(waitingDot).toHaveAttribute('data-agent-state', 'waiting', { timeout: READY });
	expect(await colourOf(waitingDot, 'color')).toBe(RED);
	expect(await colourOf(waitingRow.locator('.crow__detail--attention'), 'color')).toBe(RED);

	// No look-alike marks are left on the Tabs page.
	await expect(tabs.locator('.crow__mark')).toHaveCount(0);

	await mainWindow.screenshot({ path: testInfo.outputPath('screenshots', 'tabs-status-phone.png') });

	// Reduced motion stops the breathing.
	await mainWindow.emulateMedia({ reducedMotion: 'reduce' });
	expect(
		await colourOf(workingDot.locator('.agent-status-indicator__glyph'), 'animationName'),
	).toBe('none');
	await mainWindow.emulateMedia({ reducedMotion: 'no-preference' });
});
