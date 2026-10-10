import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
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
	// Let the launch settle, so what is counted is the titles' own cost.
	await runShellCommand(mainWindow, "printf '\\033]2;ready\\007'");
	await expect(title).toHaveText('ready');
	await mainWindow.waitForTimeout(1_500);

	// A terminal that prints is active, and its activity renders its
	// workspace whatever it prints. So the same loop is run first printing
	// text that is not a title, and what the titles add is measured against
	// that.
	const frames = 40;
	await recordDiagnostics(mainWindow);
	await runShellCommand(
		mainWindow,
		`for i in $(seq 1 ${frames}); do printf 'tick %s\\n' "$i"; sleep 0.25; done; printf '\\033]2;printed\\007'`,
	);
	await expect(title).toHaveText('printed', { timeout: 30_000 });
	await mainWindow.waitForTimeout(1_000);
	const rendersForOutputAlone = await countDiagnostics(
		mainWindow,
		'workspace-render',
	);

	// What an agent CLI does for as long as it works: a new title, again and
	// again. Forty of them, a quarter of a second apart.
	await recordDiagnostics(mainWindow);
	await runShellCommand(
		mainWindow,
		`for i in $(seq 1 ${frames}); do printf '\\033]2;working %s\\007' "$i"; sleep 0.25; done`,
	);
	await expect(title).toHaveText(`working ${frames}`, { timeout: 30_000 });

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
	await mainWindow.waitForTimeout(1_500);
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
	await mainWindow.waitForTimeout(500);

	expect(
		await countDiagnostics(mainWindow, 'explorer'),
		'the explorer is not loaded again for a rename',
	).toBe(0);
	expect(
		await countDiagnostics(mainWindow, 'git'),
		'Git is not measured for a rename',
	).toBe(0);
});
