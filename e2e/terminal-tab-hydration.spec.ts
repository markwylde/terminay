import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createTerminal } from './support/terminal-session';
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

type GridSample = { cols: number; width: number };

/**
 * Sample a terminal's grid on every frame from now until it is stopped, so
 * the observation spans the whole tab switch however long the switch takes.
 */
async function startTerminalGridMonitor(
	page: Page,
	sessionId: string,
): Promise<void> {
	await page.evaluate((targetSessionId) => {
		const root = document.querySelector<HTMLElement>(
			`.terminal-panel[data-terminay-terminal-session-id="${CSS.escape(targetSessionId)}"] .terminal-panel-root`,
		);
		if (!root) throw new Error('The terminal root to monitor is unavailable.');
		const monitor = {
			samples: [] as Array<{ cols: number; width: number }>,
			stopped: false,
		};
		(window as unknown as { __gridMonitor?: typeof monitor }).__gridMonitor =
			monitor;
		const sample = () => {
			if (monitor.stopped) return;
			monitor.samples.push({
				cols: Number(root.dataset.terminalCols ?? 0),
				width: root.clientWidth,
			});
			requestAnimationFrame(sample);
		};
		sample();
	}, sessionId);
}

/** Keep sampling for a number of drawn frames after the switch, then stop. */
async function stopTerminalGridMonitor(
	page: Page,
	framesAfter: number,
): Promise<GridSample[]> {
	return await page.evaluate(async (frames) => {
		for (let frame = 0; frame < frames; frame += 1)
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const monitor = (
			window as unknown as {
				__gridMonitor?: { samples: GridSample[]; stopped: boolean };
			}
		).__gridMonitor;
		if (!monitor) throw new Error('The terminal grid monitor is not running.');
		monitor.stopped = true;
		return monitor.samples;
	}, framesAfter);
}

test('switching a tabbed terminal never claims its detached zero-width grid', async ({
	mainWindow,
}) => {
	// Reading the presented session id straight after the command returns the
	// terminal being replaced, whose root Dockview then detaches — leaving the
	// monitor below with nothing to observe.
	const secondSessionId = await createTerminal(mainWindow);
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(2);

	await expectHydratedViewportGrid(await activeTerminalPanel(mainWindow));

	// Dockview detaches inactive content while retaining its xterm. Observe the
	// detached root itself: a zero-width observation must not turn into xterm's
	// two-column minimum grid or be forwarded as the terminal viewport.
	// The monitor runs from before the switch until thirty frames after it, so
	// what it saw covers the switch however long the runner took over it.
	await startTerminalGridMonitor(mainWindow, secondSessionId);
	await activateDockTab(mainWindow, 'Terminal 1');
	const detachedGridSamples = await stopTerminalGridMonitor(mainWindow, 30);
	expect(
		detachedGridSamples.some((sample) => sample.width === 0),
		'the monitor saw the root detached',
	).toBe(true);
	expect(
		detachedGridSamples.some(
			(sample) => sample.width === 0 && sample.cols <= 2,
		),
	).toBe(false);
	await expectHydratedViewportGrid(await activeTerminalPanel(mainWindow));

	await activateDockTab(mainWindow, 'Terminal 2');
	await expectHydratedViewportGrid(await activeTerminalPanel(mainWindow));
});
