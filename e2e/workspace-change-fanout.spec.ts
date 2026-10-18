import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	afterRendererTasks,
	nextAnimationFrame,
} from './support/renderer-clock';
import { runShellCommand } from './support/terminal-input';
import { openTerminalEditWindow, submitEditWindow } from './support/ui';

/**
 * What a change costs the window that shows it (ADR-0058, ADR-0059).
 *
 * A program that rewrites its title is not changing the workspace, so the
 * workspace projection must not be published for it, no project workspace
 * should be rendered for each title, the file explorer must not be loaded
 * again, and Git must not be measured. A rename is a workspace change, and
 * it still must not reload the explorer or measure Git.
 */

function activeTabTitle(page: Page) {
	return page.locator(
		'.project-workspace--active .terminal-tab-content--active .terminal-tab-title',
	);
}

/** A frame drawn, and the effects and tasks queued around it run. */
async function settleRenderer(page: Page): Promise<void> {
	await afterRendererTasks(page);
	await nextAnimationFrame(page);
	await afterRendererTasks(page);
}

/** Start recording the renderer's own diagnostics from now. */
async function recordDiagnostics(page: Page): Promise<void> {
	await page.evaluate(() => {
		const sink = globalThis as unknown as {
			__terminayRendererDiagnostic?: unknown;
			__terminayFanoutLog?: string[];
		};
		sink.__terminayFanoutLog = [];
		sink.__terminayRendererDiagnostic = (diagnostic: { phase?: string }) => {
			if ((sink.__terminayFanoutLog?.length ?? 0) < 20_000)
				sink.__terminayFanoutLog?.push(diagnostic.phase ?? 'unknown');
		};
	});
}

/** How many recorded diagnostics a predicate matches. */
async function countDiagnostics(
	page: Page,
	kind: 'explorer' | 'git' | 'projection' | 'workspace-render',
): Promise<number> {
	return page.evaluate((wanted) => {
		const log =
			(globalThis as unknown as { __terminayFanoutLog?: string[] })
				.__terminayFanoutLog ?? [];
		const matches: Record<typeof wanted, (phase: string) => boolean> = {
			explorer: (phase) => phase === 'explorer.root-load',
			git: (phase) => phase === 'git.fresh-measure',
			projection: (phase) => phase === 'workspace.listeners.publish',
			'workspace-render': (phase) =>
				phase.startsWith('project-workspace:') && phase.endsWith('.render'),
		};
		return log.filter(matches[wanted]).length;
	}, kind);
}

test('an animating title publishes no workspace change, loads no explorer, and measures no Git', async ({
	mainWindow,
}) => {
	const title = activeTabTitle(mainWindow);
	await expect(title).toHaveText('Terminal 1');
	await runShellCommand(mainWindow, "printf '\\033]2;ready\\007'");
	await expect(title).toHaveText('ready');

	// Each loop below prints one frame and then waits for Enter, and the test
	// presses Enter only once that frame is on screen. Frames arrive one at a
	// time however fast or slow the machine is, as an agent's do, and nothing
	// here waits on a clock. Echo is off, so Enter itself prints nothing.
	const frames = 40;
	const input = mainWindow
		.locator(
			'.project-workspace--active .terminal-panel:visible .xterm-helper-textarea',
		)
		.first();
	const rows = mainWindow
		.locator('.project-workspace--active .terminal-panel:visible .xterm-rows')
		.first();

	// A terminal that prints is active, and its activity renders its
	// workspace whatever it prints. So the same loop is run first printing
	// text that is not a title, and what the titles add is measured against
	// that.
	await recordDiagnostics(mainWindow);
	await runShellCommand(
		mainWindow,
		`stty -echo; for i in $(seq 1 ${frames}); do printf 'tick %03d\\n' "$i"; read -r _; done; stty echo; printf '\\033]2;printed\\007'`,
	);
	for (let frame = 1; frame <= frames; frame += 1) {
		await expect(rows).toContainText(`tick ${String(frame).padStart(3, '0')}`);
		await input.press('Enter');
	}
	// The title follows the last line in the same stream, so once it shows,
	// everything the loop printed has been rendered.
	await expect(title).toHaveText('printed');
	const rendersForOutputAlone = await countDiagnostics(
		mainWindow,
		'workspace-render',
	);

	// What an agent CLI does for as long as it works: a new title, again and
	// again, forty of them.
	await recordDiagnostics(mainWindow);
	await runShellCommand(
		mainWindow,
		`stty -echo; for i in $(seq 1 ${frames}); do printf '\\033]2;working %s\\007' "$i"; read -r _; done; stty echo`,
	);
	for (let frame = 1; frame <= frames; frame += 1) {
		await expect(title).toHaveText(`working ${frame}`);
		await input.press('Enter');
	}

	expect(
		await countDiagnostics(mainWindow, 'projection'),
		'the workspace projection is not published for a title',
	).toBe(0);
	expect(
		await countDiagnostics(mainWindow, 'explorer'),
		'the explorer is not loaded again for a title',
	).toBe(0);
	expect(
		await countDiagnostics(mainWindow, 'git'),
		'Git is not measured for a title',
	).toBe(0);
	// Forty titles must not render the workspace forty more times than forty
	// lines of output did.
	expect(
		await countDiagnostics(mainWindow, 'workspace-render'),
		`a project workspace is not rendered once per title (output alone rendered it ${rendersForOutputAlone} times)`,
	).toBeLessThan(rendersForOutputAlone + frames / 2);
});

test('renaming a terminal does not load the explorer again or measure Git', async ({
	mainWindow,
}) => {
	const title = activeTabTitle(mainWindow);
	await expect(title).toHaveText('Terminal 1');
	// The project has finished starting, and what its explorer did on being
	// shown it has done: it loads and measures from effects of the render
	// that settles the project, and those have run once a frame is drawn and
	// the tasks queued behind it have run.
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await settleRenderer(mainWindow);
	await recordDiagnostics(mainWindow);

	const editWindow = await openTerminalEditWindow(mainWindow);
	await editWindow
		.getByRole('textbox', { name: 'Name', exact: true })
		.fill('api');
	await submitEditWindow(editWindow);
	await expect(title).toHaveText('api');
	// The rename is a workspace change, and reaches this window as one.
	await expect
		.poll(() => countDiagnostics(mainWindow, 'projection'))
		.toBeGreaterThan(0);
	// A load or a measure the rename set off would be started from the render
	// that applied it, whose effects have run by now.
	await settleRenderer(mainWindow);

	expect(
		await countDiagnostics(mainWindow, 'explorer'),
		'the explorer is not loaded again for a rename',
	).toBe(0);
	expect(
		await countDiagnostics(mainWindow, 'git'),
		'Git is not measured for a rename',
	).toBe(0);
});
