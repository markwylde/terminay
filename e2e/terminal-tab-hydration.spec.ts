import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { activateDockTab } from './support/ui';

async function activeTerminalPanel(page: Page): Promise<Locator> {
	const panel = page.locator(
		'.project-workspace--active .terminal-panel:visible',
	);
	await expect(panel).toHaveCount(1);
	return panel;
}

async function expectHydratedViewportGrid(panel: Locator): Promise<void> {
	const root = panel.locator('.terminal-panel-root');
	const geometry = await root.evaluate((element) => ({
		cols: Number(element.dataset.terminalCols ?? 0),
		width: element.clientWidth,
	}));

	// A terminal at this viewport cannot legitimately have a handful of columns.
	// Keep the bound deliberately loose so font and display scaling do not affect
	// the assertion, while an accidental minimum grid remains observable.
	expect(geometry.width).toBeGreaterThan(400);
	expect(geometry.cols).toBeGreaterThanOrEqual(Math.floor(geometry.width / 20));
}

async function monitorTerminalGridDuringTabSwitch(
	page: Page,
	sessionId: string,
): Promise<Array<{ cols: number; width: number }>> {
	return await page.evaluate(async (targetSessionId) => {
		const root = document.querySelector<HTMLElement>(
			`.terminal-panel[data-terminay-terminal-session-id="${CSS.escape(targetSessionId)}"] .terminal-panel-root`,
		);
		if (!root) throw new Error('The terminal root to monitor is unavailable.');

		const samples: Array<{ cols: number; width: number }> = [];
		const startedAt = performance.now();
		await new Promise<void>((resolve) => {
			const sample = () => {
				samples.push({
					cols: Number(root.dataset.terminalCols ?? 0),
					width: root.clientWidth,
				});
				if (performance.now() - startedAt < 500) {
					requestAnimationFrame(sample);
					return;
				}
				resolve();
			};
			requestAnimationFrame(sample);
		});
		return samples;
	}, sessionId);
}

test('switching a tabbed terminal never claims its detached zero-width grid', async ({
	mainWindow,
}) => {
	await sendAppCommand(mainWindow, 'new-terminal');
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(2);

	const secondPanel = await activeTerminalPanel(mainWindow);
	const secondSessionId = await secondPanel.getAttribute(
		'data-terminay-terminal-session-id',
	);
	if (!secondSessionId)
		throw new Error('The second terminal session is unavailable.');
	await expectHydratedViewportGrid(secondPanel);

	// Dockview detaches inactive content while retaining its xterm. Observe the
	// detached root itself: a zero-width observation must not turn into xterm's
	// two-column minimum grid or be forwarded as the terminal viewport.
	const gridSamples = monitorTerminalGridDuringTabSwitch(
		mainWindow,
		secondSessionId,
	);
	await activateDockTab(mainWindow, 'Terminal 1');
	const detachedGridSamples = await gridSamples;
	expect(
		detachedGridSamples.some(
			(sample) => sample.width === 0 && sample.cols <= 2,
		),
	).toBe(false);
	await expectHydratedViewportGrid(await activeTerminalPanel(mainWindow));

	await activateDockTab(mainWindow, 'Terminal 2');
	await expectHydratedViewportGrid(await activeTerminalPanel(mainWindow));
});
