import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { typeInVisibleTerminal } from './support/terminal-input';
import { selectSidebarGroup } from './support/ui';

/**
 * The defect this covers: the privileged host admits one observation context
 * per context id, and the id it issued was built from a registry nonce and the
 * terminal's own incarnation counter, discarding the terminal identity. That
 * counter is per terminal and starts at one, so every terminal's first agent
 * CLI minted the same id. The first terminal was admitted; every one after it
 * was refused with "agent terminal context is already admitted" and fell back
 * to plain terminal activity, leaving its row missing from the Agents pane.
 *
 * It is provider-independent — it was reproduced on one host for Claude Code
 * and for Grok within twenty minutes of each other — so it is asserted here
 * through the one provider that has a stub CLI able to run unattended, rather
 * than only behind a real-CLI credential gate.
 *
 * Nothing caught it because every conformance test, every real-CLI test and
 * every other Electron spec drives exactly one terminal.
 */

const firstSession = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01';
const secondSession = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02';

async function startGrok(
	page: Parameters<typeof selectSidebarGroup>[0],
	sessionId: string,
): Promise<void> {
	await typeInVisibleTerminal(page, `GROK_E2E_SESSION=${sessionId} grok\n`);
	await expect
		.poll(
			async () =>
				await page
					.locator(
						'.project-workspace--active .terminal-panel:visible .xterm-rows',
					)
					.textContent(),
			{ timeout: 20_000 },
		)
		.toMatch(/Grok e2e ready/u);
}

test('two terminals running one provider each hold their own row in the Agents pane', async ({
	mainWindow,
}) => {
	test.setTimeout(120_000);
	const rows = mainWindow.locator(
		'.project-workspace--active .agents-sidebar__tree-item',
	);

	await startGrok(mainWindow, firstSession);
	await selectSidebarGroup(mainWindow, 'agents');
	await expect(rows).toHaveCount(1, { timeout: 20_000 });

	await sendAppCommand(mainWindow, 'new-terminal');
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(2);
	await startGrok(mainWindow, secondSession);

	// The whole defect: this was 1, because the second terminal's admission was
	// refused for colliding with the first terminal's context id.
	await expect(rows).toHaveCount(2, { timeout: 20_000 });

	// Each row is its own session: work in the second terminal must not move
	// the first terminal's state.
	await typeInVisibleTerminal(mainWindow, 'hello\n');
	await expect(
		mainWindow.locator(
			'.project-workspace--active .agents-sidebar__row[data-agent-state="working"]',
		),
	).toHaveCount(1, { timeout: 20_000 });
	await expect(
		mainWindow.locator(
			'.project-workspace--active .agents-sidebar__row[data-agent-state="done"]',
		),
	).toHaveCount(1, { timeout: 20_000 });
	await expect(rows).toHaveCount(2);

	// Quitting one leaves the other bound.
	await typeInVisibleTerminal(mainWindow, 'quit\n');
	await expect(rows).toHaveCount(1, { timeout: 20_000 });
});
