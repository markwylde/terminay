import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';

/**
 * Workspace windows through MCP (mcp-app-control, ADR-0072). Pixel holds
 * workspace reach; the fake `claude` (e2e/fixtures/fake-claude-chat.mjs)
 * calls the real window tools on Pixel's own capability, so the server
 * commits each change and the window Pixel was asked from presents it.
 */

const balloon = (page: Page) => page.locator('.mwpet-chat');

async function openPixel(
	appHarness: {
		openSettingsWindow: (options: {
			page: Page;
			sectionId: string;
		}) => Promise<Page>;
	},
	page: Page,
): Promise<void> {
	const settings = await appHarness.openSettingsWindow({
		page,
		sectionId: 'pixel',
	});
	await settings.getByLabel('Enable Pixel').check();
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
	const dock = page.locator('.workspace-status-bar .pixel-dock--status-bar');
	await expect(dock).toBeVisible();
	const claudeChip = balloon(page).getByRole('button', { name: 'Claude Code' });
	await expect(async () => {
		if (await balloon(page).isVisible()) await dock.click();
		await dock.click();
		await expect(claudeChip).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await claudeChip.click();
	await expect(balloon(page).locator('.mwpet-chat-status')).toContainText(
		'Claude Code',
	);
}

async function ask(page: Page, text: string): Promise<void> {
	const input = balloon(page).locator('.mwpet-chat-input');
	await input.fill(text);
	await input.press('Enter');
}

/** Every open workspace window other than the main one. */
function otherWorkspaceWindows(
	electronApp: ElectronApplication,
	mainWindow: Page,
): Page[] {
	return electronApp
		.windows()
		.filter(
			(page) =>
				page !== mainWindow &&
				!page.isClosed() &&
				!page.url().startsWith('about:blank') &&
				!page.url().startsWith('data:') &&
				new URL(page.url()).searchParams.get('view') !== null,
		);
}

test('Pixel opens a workspace window holding a project, then moves the project back and closes the window', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	test.setTimeout(150_000);
	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	const projectId = await mainWindow
		.locator('.project-workspace--active')
		.first()
		.getAttribute('data-terminay-project-id');
	const sessionId = await mainWindow
		.locator('.project-workspace--active .terminal-panel')
		.first()
		.getAttribute('data-terminay-terminal-session-id');
	expect(projectId).not.toBeNull();
	expect(sessionId).not.toBeNull();

	await openPixel(appHarness, mainWindow);
	await ask(mainWindow, 'pop this project out');
	await expect(balloon(mainWindow)).toContainText('Opened a window for', {
		timeout: 30_000,
	});
	await expect(balloon(mainWindow)).toContainText('✓ Opening a window');

	// Desktop presents it as a native window, holding the project and its
	// running terminal; the main window keeps the other project.
	let popout: Page | undefined;
	await expect
		.poll(
			async () => {
				popout = otherWorkspaceWindows(electronApp, mainWindow)[0];
				return popout === undefined
					? 0
					: await popout
							.locator(`.project-tab[data-project-id="${projectId}"]`)
							.count();
			},
			{ timeout: 30_000 },
		)
		.toBe(1);
	if (popout === undefined) throw new Error('Expected the presented window');
	await expect(
		popout.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		),
	).toBeVisible({ timeout: 20_000 });
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await expect(
		mainWindow.locator(`.project-tab[data-project-id="${projectId}"]`),
	).toHaveCount(0);

	// Back again: the project returns with its terminal, and the window,
	// deleted on the server, closes.
	await ask(mainWindow, 'bring it back');
	await expect(balloon(mainWindow)).toContainText(
		'Moved it back and closed the window.',
		{ timeout: 30_000 },
	);
	await expect(
		mainWindow.locator(`.project-tab[data-project-id="${projectId}"]`),
	).toHaveCount(1);
	await expect
		.poll(() => popout?.isClosed() ?? true, { timeout: 20_000 })
		.toBe(true);
	await expect
		.poll(() => otherWorkspaceWindows(electronApp, mainWindow).length)
		.toBe(0);
	await mainWindow
		.locator(`.project-tab[data-project-id="${projectId}"]`)
		.click();
	await expect(
		mainWindow.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		),
	).toBeVisible({ timeout: 20_000 });
});
