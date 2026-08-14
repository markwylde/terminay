import { realpath } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';

async function activeSessionId(page: Page): Promise<string> {
	const sessionId = await page
		.locator('.terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');

	if (!sessionId) {
		throw new Error('The active terminal session id is unavailable');
	}

	return sessionId;
}

async function writeToActiveTerminal(page: Page, data: string): Promise<void> {
	await submitTerminalCommand(page, data);
}

test('keeps a high-output local terminal interactive through sidebar, root, resize, and settings updates', async ({
	appHarness,
	createWorkspace,
	electronApp,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'terminal-presentation-recovery',
		seed: { files: { 'README.md': 'terminal presentation recovery\n' } },
	});
	const expectedRoot = await realpath(workspace.rootDir);
	const panel = mainWindow.locator('.terminal-panel:visible');
	const originalSessionId = await activeSessionId(mainWindow);
	const cwdReady = `presentation-cwd-${originalSessionId}`;
	const retainedMarker = `presentation-retained-${originalSessionId}`;
	const inputMarker = `presentation-input-${originalSessionId}`;

	await writeToActiveTerminal(
		mainWindow,
		`cd ${JSON.stringify(expectedRoot)} && printf ${JSON.stringify(cwdReady)}\\n\r`,
	);
	await expect(panel).toContainText(cwdReady);
	await expect
		.poll(async () => {
			return await mainWindow.evaluate(async (sessionId) => {
				return await window.terminayTest!.getServerTerminalCwd(sessionId);
			}, originalSessionId);
		})
		.toMatchObject({ cwd: expectedRoot, source: 'observed' });

	// This writes 1.1 MiB after the terminal has started. It deliberately exceeds
	// both the old command-header replay allowance and the usual 1 MiB replay
	// window, without embedding a giant literal in the renderer-to-host test IPC.
	await writeToActiveTerminal(
		mainWindow,
		`head -c 1100000 /dev/zero | tr '\\0' x; printf '\\n%s\\n' ${JSON.stringify(retainedMarker)}\r`,
	);
	await expect(panel).toContainText(retainedMarker, { timeout: 30_000 });

	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	await panel.click();
	await mainWindow.keyboard.press(`${modifier}+O`);
	await expect(
		mainWindow.locator('.project-workspace--active .file-explorer-sidebar'),
	).toBeVisible();
	await mainWindow.keyboard.press(`${modifier}+R`);
	await expect(
		mainWindow.locator('.project-workspace--active'),
	).toHaveAttribute('data-terminay-project-root', expectedRoot);
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		originalSessionId,
	);
	await expect(panel).toContainText(retainedMarker);

	await electronApp.evaluate(({ BrowserWindow }) => {
		const window =
			BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		if (!window) throw new Error('The main BrowserWindow is unavailable');
		const bounds = window.getBounds();
		window.setBounds({
			...bounds,
			width: Math.max(720, bounds.width - 47),
			height: Math.max(520, bounds.height - 31),
		});
	});
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		originalSessionId,
	);
	await expect(panel).toContainText(retainedMarker);

	const settings = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'typography',
	});
	const fontSize = settings
		.locator('#section-typography .settings-row')
		.filter({ hasText: 'Font size' })
		.locator('input[type="number"]');
	await fontSize.fill('14');
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		originalSessionId,
	);
	await expect(panel).toContainText(retainedMarker);

	// A renderer reload destroys xterm while leaving the local server-owned PTY
	// alive. This must take the binary checkpoint path rather than relying on
	// either the old 32 KiB command header or the raw replay window.
	await mainWindow.reload();
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		originalSessionId,
		{ timeout: 30_000 },
	);
	await expect(panel).toContainText(retainedMarker, { timeout: 30_000 });

	await writeToActiveTerminal(
		mainWindow,
		`printf ${JSON.stringify(inputMarker)}\\n\r`,
	);
	await expect(panel).toContainText(inputMarker);
	await expect(
		mainWindow.getByText(
			'Terminal presentation is unavailable because a complete safe recovery boundary is no longer retained.',
		),
	).toHaveCount(0);
});
