import type { Locator, Page } from '@playwright/test';

/** Submit a shell command through the same visible xterm input used by a user. */
export async function submitTerminalCommand(
	page: Page,
	command: string,
	panel: Locator = page.locator('.terminal-panel:visible'),
): Promise<void> {
	const input = panel.locator('.xterm-helper-textarea');
	await input.focus();
	await page.keyboard.type(command.replace(/\r$/u, ''));
	await page.keyboard.press('Enter');
}
