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
	const input = panel.locator('.xterm-helper-textarea');
	await input.focus();

	const command = data.replace(/[\r\n]+$/u, '');
	// xterm receives terminal bytes from keyboard events.  `insertText` only
	// dispatches a DOM text-input event, which can leave punctuation-heavy shell
	// commands half-rendered but never delivered to the PTY.
	if (command.length > 0) await input.pressSequentially(command);
	if (command.length !== data.length) await input.press('Enter');
}
