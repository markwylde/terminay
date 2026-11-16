import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Dashboard shows a panel's pull request and checks (workspace-dashboard): on
 * a List row the chips sit on the row's own line, after the detail, whole.
 *
 * Seeding a real forge pull request needs a remote forge, so this test adds
 * the chips' own markup to real dashboard rows and measures the layout. The
 * CSS grid placement is what is under test; the chips' data path is not.
 */

test.describe.configure({ timeout: 180_000 });

const READY = 20_000;
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

const activeSessionId = (page: Page) =>
	page
		.locator('.project-workspace--active .terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');

async function publishAgent(page: Page, sessionId: string): Promise<void> {
	const accepted = await page.evaluate(async (sessionId) => {
		const seam = window.terminayAgentStatusTest;
		if (!seam) throw new Error('Agent status test seam is unavailable');
		const pid = await seam.terminalShellPid(sessionId);
		if (pid === null) throw new Error('Terminal shell pid is unavailable');
		return await seam.publishSessions({
			sourceId: 'com.terminay.e2e/row-chips',
			harnesses: [{ id: 'codex', displayName: 'Codex' }],
			publication: {
				upserts: [
					{
						harness: 'codex',
						pid,
						cwd: '/tmp',
						id: 'codex-e2e-row-chips',
						title: 'Mobile view blue progress dots',
						status: 'running',
					},
				],
			},
		});
	}, sessionId);
	if (!accepted) throw new Error('Agent session publication was not accepted');
}

/** Adds the markup `WorktreeChips` renders for PR #605 with checks running. */
async function addChips(row: Locator): Promise<void> {
	await row.evaluate((element) => {
		const facts = document.createElement('span');
		facts.className = 'workspace-dashboard__worktree';
		facts.dataset.e2eChips = '';
		for (const text of ['PR #605', '12 running']) {
			const chip = document.createElement('span');
			chip.className = 'workspace-dashboard__chip';
			chip.textContent = text;
			facts.append(chip);
		}
		element.append(facts);
	});
}

async function expectChipsInline(row: Locator, afterDetail: boolean): Promise<void> {
	const layout = await row.evaluate((element) => {
		const box = (node: Element | null) => node?.getBoundingClientRect() ?? null;
		const facts = element.querySelector('[data-e2e-chips]');
		return {
			row: box(element),
			facts: box(facts),
			title: box(element.querySelector('.workspace-dashboard__title')),
			detail: box(element.querySelector('.workspace-dashboard__row-detail')),
			chips: [...(facts?.children ?? [])].map((chip) => ({
				box: chip.getBoundingClientRect(),
				clipped: chip.scrollWidth > chip.clientWidth,
			})),
			factsClipped: facts ? facts.scrollWidth > facts.clientWidth : true,
		};
	});
	if (!layout.row || !layout.facts || !layout.title)
		throw new Error('Expected a row, its title, and its chips');
	// On the row's own line: nothing below or above it.
	expect(layout.facts.top).toBeGreaterThanOrEqual(layout.row.top - 0.5);
	expect(layout.facts.bottom).toBeLessThanOrEqual(layout.row.bottom + 0.5);
	// After the title, and after the detail when there is one.
	expect(layout.facts.left).toBeGreaterThanOrEqual(layout.title.right);
	if (afterDetail) {
		if (!layout.detail) throw new Error('Expected an agent detail');
		expect(layout.facts.left).toBeGreaterThanOrEqual(layout.detail.right);
	}
	// Whole: neither the container nor a chip is cut.
	expect(layout.factsClipped).toBe(false);
	expect(layout.chips).toHaveLength(2);
	for (const chip of layout.chips) {
		expect(chip.clipped).toBe(false);
		expect(chip.box.width).toBeGreaterThan(20);
		expect(chip.box.right).toBeLessThanOrEqual(layout.row.right + 0.5);
	}
}

test('a List row keeps its pull request and checks chips on its own line', async ({
	appHarness,
	electronApp,
	mainWindow,
}, testInfo) => {
	const agentSession = await activeSessionId(mainWindow);
	if (!agentSession) throw new Error('Expected the first terminal session');
	await appHarness.sendAppCommand('new-terminal');
	await expect.poll(() => activeSessionId(mainWindow)).not.toBe(agentSession);
	const plainSession = await activeSessionId(mainWindow);
	if (!plainSession) throw new Error('Expected the second terminal session');
	await publishAgent(mainWindow, agentSession);

	await resize(mainWindow, electronApp, WIDE);
	await expect(mainWindow.locator('[data-compact-chrome="true"]')).toHaveCount(0, { timeout: READY });
	await mainWindow.getByRole('button', { name: 'Home', exact: true }).click();
	await mainWindow.locator('[data-terminay-home-section-tab="tabs"]').click();
	const dashboard = mainWindow.locator('[data-terminay-home-active="true"] [data-terminay-dashboard]');
	await expect(dashboard).toBeVisible({ timeout: READY });
	await mainWindow.locator('[data-terminay-dashboard-mode="list"]').click();
	await expect(dashboard).toHaveAttribute('data-terminay-dashboard-view', 'list');

	// A row with an agent detail.
	const agentRow = dashboard.locator('.workspace-dashboard__row--panel[data-terminay-dashboard-status="working"]').first();
	await expect(agentRow.locator('.workspace-dashboard__row-detail')).toBeVisible({ timeout: READY });
	// A row with no detail.
	const plainRow = dashboard.locator('.workspace-dashboard__row--panel:not(:has(.workspace-dashboard__row-detail))').first();
	await expect(plainRow).toBeVisible({ timeout: READY });

	await addChips(agentRow);
	await addChips(plainRow);
	await expectChipsInline(agentRow, true);
	await expectChipsInline(plainRow, false);

	await mainWindow.screenshot({ path: testInfo.outputPath('screenshots', 'dashboard-list-row-chips.png') });
});
