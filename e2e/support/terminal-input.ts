import { expect, type Page } from '@playwright/test';

/** Drive terminal input through the same focused xterm control a user uses. */
export async function typeInVisibleTerminal(
	page: Page,
	data: string,
	sessionId?: string,
): Promise<void> {
	const sessionSelector = sessionId
		? `[data-terminay-terminal-session-id="${sessionId}"]`
		: '.project-workspace--active .terminal-panel:visible';
	const panel = page.locator(`${sessionSelector}:visible`).first();
	await expect(panel).toBeVisible();
	// Keys typed while the terminal is still attaching are held and delivered
	// once it holds the presentation, but a terminal that another attachment
	// controls refuses them: it is a read-only observer, and its control bar
	// says so. Which of the two this panel is is known once it has hydrated,
	// so begin only when it has and it is the interactive presentation.
	await expect(panel.locator('.terminal-panel-loading')).toHaveCount(0);
	await expect(panel.locator('.terminal-presentation-control')).toHaveCount(0);
	const input = panel.locator('.xterm-helper-textarea');
	await input.focus();
	await expect(input).toBeFocused();

	const command = data.replace(/[\r\n]+$/u, '');
	// xterm receives terminal bytes from keyboard events.  `insertText` only
	// dispatches a DOM text-input event, which can leave punctuation-heavy shell
	// commands half-rendered but never delivered to the PTY. Pace synthetic
	// keystrokes so xterm's event handler and the asynchronous server-input queue
	// observe each byte before the next one (and, crucially, before Enter).
	if (command.length > 0) await input.pressSequentially(command, { delay: 2 });
	if (command.length !== data.length) await input.press('Enter');
}

/** Run a command at the shell prompt of the terminal on screen. */
export async function runShellCommand(
	page: Page,
	command: string,
	sessionId?: string,
): Promise<void> {
	await typeInVisibleTerminal(page, `${command}\n`, sessionId);
}
