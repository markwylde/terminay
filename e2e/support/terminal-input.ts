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
	// A newly created tab is visible as soon as workspace reconciliation adds its
	// panel, but its xterm attachment and presentation lease still hydrate
	// asynchronously.  Sending keys beneath the loading surface drops them at
	// the client boundary, which makes command-driven tests race the real UI.
	// Wait for the same ready state that a user sees before interacting.
	await expect(panel.locator('.terminal-panel-loading')).toHaveCount(0);
	// The loading surface is removed after the initial stream has rendered, but
	// the presentation lease can still settle in the following renderer turn.
	// A read-only lease discards queued xterm input by design, so do not begin a
	// synthetic command until this panel is the interactive presentation.
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

const SHELL_ECHO_TIMEOUT_MS = 3_000;
const SHELL_COMMAND_ATTEMPTS = 3;

/**
 * Run a command at the shell prompt of the terminal on screen, and only once
 * the shell has echoed all of it.
 *
 * A terminal whose attachment is being renewed discards the keystrokes it is
 * sent in that moment, so a command typed straight after the window regains
 * the terminal can reach the shell with characters missing and run as some
 * other command. The prompt line is checked before Enter, and a line that is
 * not the command is cleared and typed again.
 */
export async function runShellCommand(
	page: Page,
	command: string,
	sessionId?: string,
): Promise<void> {
	const sessionSelector = sessionId
		? `[data-terminay-terminal-session-id="${sessionId}"]`
		: '.project-workspace--active .terminal-panel:visible';
	const panel = page.locator(`${sessionSelector}:visible`).first();
	const input = panel.locator('.xterm-helper-textarea');
	const wanted = command.replace(/\s+/gu, '');
	// A long command wraps over several rows, which carry no separator.
	const echoed = async (): Promise<boolean> =>
		(
			await panel.locator('.xterm-rows > div').allTextContents()
		)
			.join('')
			.replace(/\s+/gu, '')
			.endsWith(wanted);
	for (let attempt = 1; ; attempt += 1) {
		await typeInVisibleTerminal(page, command, sessionId);
		const arrived = await expect
			.poll(echoed, { timeout: SHELL_ECHO_TIMEOUT_MS })
			.toBe(true)
			.then(
				() => true,
				() => false,
			);
		if (arrived) break;
		if (attempt === SHELL_COMMAND_ATTEMPTS)
			throw new Error(
				`The shell did not echo the command after ${attempt} attempts: ${command}`,
			);
		// Readline: discard the line as typed and start it again.
		await input.press('Control+u');
	}
	await input.press('Enter');
}
