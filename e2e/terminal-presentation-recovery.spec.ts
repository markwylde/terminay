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

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function syntheticCodexResizeRedrawCommand(): string {
	// Sampling `codex resume` over a PTY (without retaining its text) showed
	// that one resize causes about 89 KiB of styled output across roughly 1,125
	// CR/LF-terminated rows. Codex is therefore not merely causing xterm to
	// reflow its local history: the process itself redraws its inline UI after
	// SIGWINCH. The test sends ten viewport changes, reproducing ten times this
	// output without requiring Codex or a user's saved session in CI.
	const source = `
const initialRows = 1150;
const resizeRows = initialRows;
const draw = (rows, phase) => {
  const chunks = ["\\x1b[?25l\\x1b[H"];
  for (let index = 0; index < rows; index += 1) {
    chunks.push(
      "\\x1b[2K\\r\\x1b[38;5;245m• \\x1b[1;38;5;39mCodex \\x1b[0;38;5;250mresize redraw " +
        phase + " row " + String(index).padStart(5, "0") +
        " \\x1b[38;5;110m────────────────────\\x1b[0m\\r\\n",
    );
  }
  chunks.push("\\x1b[?25h\\x1b[0m" +
    (phase === "initial"
      ? "synthetic-codex-ready"
      : "synthetic-codex-resize-redraw-complete") + "\\r\\n");
  process.stdout.write(chunks.join(""));
};
process.on("SIGWINCH", () => draw(resizeRows, "resize"));
draw(initialRows, "initial");
setInterval(() => {}, 1_000);
`;
	return `node -e ${shellQuote(source)}`;
}

test('keeps 500 long terminal rows mounted through a real window resize', async ({
	electronApp,
	mainWindow,
}) => {
	test.setTimeout(30_000);
	const panel = mainWindow.locator('.terminal-panel:visible');
	const sessionId = await activeSessionId(mainWindow);
	const historyComplete = `resize-history-complete-${sessionId}`;
	const inputComplete = `resize-input-complete-${sessionId}`;

	// Five hundred 1 KiB rows fill the normal 5,000-line xterm scrollback after
	// wrapping. Changing the window width consequently exercises the expensive
	// retained-buffer reflow that can look like a terminal replay.
	await writeToActiveTerminal(
		mainWindow,
		`row=$(head -c 1024 /dev/zero | tr '\\0' x); i=0; while [ "$i" -lt 500 ]; do printf '%04d %s\\n' "$i" "$row"; i=$((i + 1)); done; printf '%s\\n' ${JSON.stringify(historyComplete)}\r`,
	);
	await expect(panel).toContainText(historyComplete, { timeout: 20_000 });

	const terminalRoot = panel.locator('.terminal-panel-root');
	const initialColumns = await terminalRoot.getAttribute('data-terminal-cols');
	if (initialColumns === null) {
		throw new Error(
			'The mounted terminal did not publish its initial columns.',
		);
	}

	await electronApp.evaluate(({ BrowserWindow }) => {
		const window =
			BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		if (!window) throw new Error('The main BrowserWindow is unavailable');
		const bounds = window.getBounds();
		window.setBounds({
			...bounds,
			width: Math.max(640, bounds.width - 280),
		});
	});

	await expect(terminalRoot).not.toHaveAttribute(
		'data-terminal-cols',
		initialColumns,
	);
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		sessionId,
	);
	await expect(panel.getByText('Loading terminal…')).toHaveCount(0);

	await writeToActiveTerminal(
		mainWindow,
		`printf '%s\\n' ${JSON.stringify(inputComplete)}\r`,
	);
	await expect(panel).toContainText(inputComplete);
});

test('coalesces a Codex-style redraw storm from a window drag', async ({
	electronApp,
	mainWindow,
}) => {
	test.setTimeout(60_000);
	const panel = mainWindow.locator('.terminal-panel:visible');
	const terminalRoot = panel.locator('.terminal-panel-root');

	await writeToActiveTerminal(
		mainWindow,
		`${syntheticCodexResizeRedrawCommand()}\r`,
	);
	await expect(panel).toContainText('synthetic-codex-ready', {
		timeout: 30_000,
	});
	// Leave the initial inline history on screen long enough to inspect before
	// the resize, matching the manual Codex reproduction.
	await mainWindow.waitForTimeout(5_000);
	await mainWindow.evaluate(() => {
		const target = window as Window & {
			__terminayResizeTriggeredRecovery?: boolean;
			__terminayResizeRecoveryObserver?: MutationObserver;
		};
		target.__terminayResizeTriggeredRecovery = false;
		target.__terminayResizeRecoveryObserver?.disconnect();
		target.__terminayResizeRecoveryObserver = new MutationObserver(() => {
			if (document.querySelector('.terminal-panel-loading')) {
				target.__terminayResizeTriggeredRecovery = true;
			}
		});
		target.__terminayResizeRecoveryObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	});

	const initialColumns = await terminalRoot.getAttribute('data-terminal-cols');
	if (initialColumns === null) {
		throw new Error(
			'The mounted terminal did not publish its initial columns.',
		);
	}
	await electronApp.evaluate(async ({ BrowserWindow }) => {
		const window =
			BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		if (!window) throw new Error('The main BrowserWindow is unavailable');
		const bounds = window.getBounds();
		const targetWidth = Math.max(640, bounds.width - 280);
		for (let step = 1; step <= 10; step += 1) {
			window.setBounds({
				...bounds,
				width: Math.round(
					bounds.width + ((targetWidth - bounds.width) * step) / 10,
				),
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	});

	await expect(terminalRoot).not.toHaveAttribute(
		'data-terminal-cols',
		initialColumns,
	);
	await expect(panel).toContainText('synthetic-codex-resize-redraw-complete', {
		timeout: 30_000,
	});
	await expect(panel.getByText('Loading terminal…')).toHaveCount(0);
	await expect
		.poll(() =>
			mainWindow.evaluate(
				() =>
					(
						window as Window & {
							__terminayResizeTriggeredRecovery?: boolean;
						}
					).__terminayResizeTriggeredRecovery ?? false,
			),
		)
		.toBe(false);
	await mainWindow.waitForTimeout(2_000);
});

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
	await writeToActiveTerminal(mainWindow, 'pwd\r');
	await expect(panel).toContainText(expectedRoot);

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
