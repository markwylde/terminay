import type { Locator, Page } from '@playwright/test';
import { typeInTerminal } from './terminal-input';

/** Submit a shell command through the same visible xterm input used by a user. */
export async function submitTerminalCommand(
	page: Page,
	command: string,
	panel: Locator = page.locator('.terminal-panel:visible'),
): Promise<void> {
	await typeInTerminal(`${command.replace(/[\r\n]+$/u, '')}\n`, panel);
}
