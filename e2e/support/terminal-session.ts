import { expect, type Locator, type Page } from '@playwright/test';
import { sendAppCommand } from './app';

const sessionIdAttribute = 'data-terminay-terminal-session-id';
const activePanelSelector =
	'.project-workspace--active .terminal-panel:visible';

/** The terminal panel the active workspace currently presents. */
export function activeTerminalPanel(page: Page): Locator {
	return page.locator(activePanelSelector).first();
}

/** The panel bound to one terminal session, whether or not it is presented. */
export function terminalPanelForSession(
	page: Page,
	sessionId: string,
): Locator {
	return page.locator(`.terminal-panel[${sessionIdAttribute}="${sessionId}"]`);
}

/**
 * A terminal panel's session id, once the workspace has settled on a panel.
 *
 * A single read is not enough. Dockview swaps the presented panel a turn after
 * the workspace accepts a terminal change, so a read taken inside that window
 * returns the *outgoing* terminal — and Dockview then detaches that panel, so a
 * locator built from the id matches nothing by the time the test uses it.
 * Requiring two consecutive reads to agree hands back an id the workspace has
 * actually settled on.
 */
export async function settledTerminalSessionId(
	panel: Locator,
): Promise<string> {
	let settled: string | undefined;
	let previous: string | null = null;

	await expect
		.poll(async () => {
			const current = await panel.getAttribute(sessionIdAttribute);
			settled = current !== null && current === previous ? current : undefined;
			previous = current;
			return settled !== undefined;
		})
		.toBe(true);

	if (settled === undefined)
		throw new Error('A terminal session id never settled');
	return settled;
}

export async function activeTerminalSessionId(page: Page): Promise<string> {
	return await settledTerminalSessionId(activeTerminalPanel(page));
}

/**
 * Wait until the presented terminal is one other than `previousSessionId`.
 *
 * Creating or switching a terminal is only observable once the workspace stops
 * presenting the terminal it was on; asserting the new tab exists says nothing
 * about which panel is live.
 */
export async function activeTerminalSessionIdOtherThan(
	page: Page,
	previousSessionId: string,
): Promise<string> {
	let settled: string | undefined;

	await expect
		.poll(async () => {
			const current =
				await activeTerminalPanel(page).getAttribute(sessionIdAttribute);
			settled =
				current !== null && current !== previousSessionId ? current : undefined;
			return settled !== undefined;
		})
		.toBe(true);

	if (settled === undefined)
		throw new Error('A replacement terminal session was never presented');
	return settled;
}

/**
 * Open a terminal and wait for the workspace to present it.
 *
 * `sendAppCommand` resolves when the host accepts the action, not when the new
 * panel is live, so a test that writes straight after it races the swap and can
 * drive the terminal it just left.
 */
export async function createTerminal(page: Page): Promise<string> {
	const previousSessionId = await activeTerminalSessionId(page);
	await sendAppCommand(page, 'new-terminal');
	return await activeTerminalSessionIdOtherThan(page, previousSessionId);
}
