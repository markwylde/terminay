import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';
import { activeTerminalPanel } from './support/terminal-session';

/**
 * Pixel end to end. The built-in Claude Code chat provider runs a fake
 * `claude` (e2e/fixtures/fake-claude-chat.mjs) that speaks the real
 * streaming-JSON protocol and reaches Terminay through the chat's own MCP
 * capability, so the agent chat service, the chat principal, the permission
 * gate and the balloon are all real.
 */

const dock = (page: Page) => page.getByTestId('pixel-dock');
const balloon = (page: Page) => page.locator('.mwpet-chat');

async function setPixel(
	appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
	page: Page,
	enabled: boolean,
) {
	const settings = await appHarness.openSettingsWindow({ page, sectionId: 'pixel' });
	const toggle = settings.getByLabel('Enable Pixel');
	if (enabled) await toggle.check();
	else await toggle.uncheck();
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
}

async function setTerminalManagement(
	appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
	page: Page,
	policy: 'allow' | 'ask',
) {
	const settings = await appHarness.openSettingsWindow({ page, sectionId: 'terminay-mcp' });
	await settings.getByLabel('Full Terminal Management').selectOption(policy);
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
}

async function ask(page: Page, text: string) {
	const input = balloon(page).locator('.mwpet-chat-input');
	await input.fill(text);
	await input.press('Enter');
}

/** The fake agent runs in the same container as the test, so ask ps directly. */
async function fakeClaudeRunning(): Promise<boolean> {
	try {
		return execSync('ps -eo args').toString().includes('fake-claude-chat.mjs');
	} catch {
		return false;
	}
}

test('Pixel is off until enabled, asks for its agent, chats, acts through MCP, asks before acting under Ask, and leaves completely when turned off', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);

	// Off by default: no dock, no pet.
	await expect(mainWindow.getByTestId('workspace-status-bar')).toBeVisible();
	await expect(dock(mainWindow)).toHaveCount(0);

	await setPixel(appHarness, mainWindow, true);
	const statusBarDock = mainWindow.locator('.workspace-status-bar .pixel-dock--status-bar');
	await expect(statusBarDock).toBeVisible();
	await expect(statusBarDock).toHaveAttribute('aria-label', 'Open Pixel');

	// First click: Pixel asks which agent to use, offering the one installed.
	// The built-in agents extension can start after the window, so the
	// question is asked again each time the balloon opens.
	const claudeChip = balloon(mainWindow).getByRole('button', { name: 'Claude Code' });
	await expect(async () => {
		if (await balloon(mainWindow).isVisible()) await statusBarDock.click();
		await statusBarDock.click();
		await expect(balloon(mainWindow)).toBeVisible();
		await expect(claudeChip).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await expect(balloon(mainWindow)).toContainText('Which agent should I use?');
	// While Pixel is out, its dock shows only a ghost of it.
	await expect(statusBarDock).toHaveAttribute('data-out', 'true');
	await claudeChip.click();
	await expect(balloon(mainWindow).locator('.mwpet-chat-status')).toContainText('Claude Code');

	// A plain reply streams in.
	await ask(mainWindow, 'hello');
	await expect(balloon(mainWindow)).toContainText('Hi from fake Claude.');

	// Under Always Allow, Pixel runs a command in a terminal through MCP.
	await ask(mainWindow, 'type echo pixel-was-here');
	await expect(balloon(mainWindow)).toContainText('Done, I ran it.');
	await expect(balloon(mainWindow)).toContainText('✓ Running `echo pixel-was-here` in');
	await expect(activeTerminalPanel(mainWindow)).toContainText('pixel-was-here');

	// Under Ask, the approval appears in the balloon and nothing runs until allowed.
	await setTerminalManagement(appHarness, mainWindow, 'ask');
	if (!(await balloon(mainWindow).isVisible())) await statusBarDock.click();
	await ask(mainWindow, 'type echo pixel-asked-first');
	const allow = balloon(mainWindow).getByRole('button', { name: 'Allow One Time' });
	await expect(allow).toBeVisible();
	await expect(balloon(mainWindow)).toContainText('Pixel (Claude Code) wants to');
	await expect(activeTerminalPanel(mainWindow)).not.toContainText('pixel-asked-first');
	await allow.click();
	await expect(balloon(mainWindow)).toContainText('→ Allowed once');
	await expect(activeTerminalPanel(mainWindow)).toContainText('pixel-asked-first');
	await expect(balloon(mainWindow).getByRole('button', { name: 'Allow One Time' })).toHaveCount(0);
	expect(await fakeClaudeRunning()).toBe(true);

	// Closing the balloon sends Pixel home, and its dock is whole again.
	await balloon(mainWindow).locator('.mwpet-chat-close').click();
	await expect(balloon(mainWindow)).toBeHidden();
	await expect(statusBarDock).not.toHaveAttribute('data-out', 'true');

	// Turning Pixel off removes it everywhere and ends its agent.
	await setPixel(appHarness, mainWindow, false);
	await expect(dock(mainWindow)).toHaveCount(0);
	await expect(mainWindow.locator('.mwpet')).toHaveCount(0);
	await expect.poll(() => fakeClaudeRunning(), { timeout: 15_000 }).toBe(false);
});

test('a second window shows the same Pixel conversation and can answer its approval', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await setPixel(appHarness, mainWindow, true);
	const mainDock = mainWindow.locator('.workspace-status-bar .pixel-dock--status-bar');
	await expect(mainDock).toBeVisible();
	const claudeChip = balloon(mainWindow).getByRole('button', { name: 'Claude Code' });
	await expect(async () => {
		if (await balloon(mainWindow).isVisible()) await mainDock.click();
		await mainDock.click();
		await expect(claudeChip).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await claudeChip.click();
	await expect(balloon(mainWindow).locator('.mwpet-chat-status')).toContainText('Claude Code');

	// Pop a second project out into its own window; the main window keeps
	// the first. Both windows are clients of the same server.
	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	const second = await appHarness.openChildWindow(async () => {
		await appHarness.sendAppCommand('popout-active');
	});
	const secondDock = second.getByTestId('pixel-dock');
	await expect(secondDock).toBeVisible();

	// A question asked in one window is answered in both.
	await ask(mainWindow, 'hello');
	await expect(balloon(mainWindow)).toContainText('Hi from fake Claude.');
	await secondDock.click();
	await expect(balloon(second)).toContainText('Hi from fake Claude.');

	// An approval asked for in the main window is answered from the second.
	await setTerminalManagement(appHarness, mainWindow, 'ask');
	if (!(await balloon(mainWindow).isVisible())) await mainDock.click();
	await ask(mainWindow, 'type echo answered-elsewhere');
	const allowHere = balloon(second).getByRole('button', { name: 'Allow One Time' });
	await expect(allowHere).toBeVisible();
	await allowHere.click();
	await expect(balloon(mainWindow)).toContainText('→ Allowed once');
	await expect(balloon(mainWindow).getByRole('button', { name: 'Allow One Time' })).toHaveCount(0);
	await expect(balloon(second)).toContainText('Done, I ran it.');
});

test('asked for three more terminals in a 2x2 grid, Pixel opens them in the project on screen, places them, and reports only what it can see', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await setPixel(appHarness, mainWindow, true);
	const statusBarDock = mainWindow.locator('.workspace-status-bar .pixel-dock--status-bar');
	await expect(statusBarDock).toBeVisible();
	const claudeChip = balloon(mainWindow).getByRole('button', { name: 'Claude Code' });
	await expect(async () => {
		if (await balloon(mainWindow).isVisible()) await statusBarDock.click();
		await statusBarDock.click();
		await expect(claudeChip).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await claudeChip.click();
	await expect(balloon(mainWindow).locator('.mwpet-chat-status')).toContainText('Claude Code');

	const workspace = mainWindow.locator('.project-workspace--active');
	await expect(workspace.locator('.terminal-tab-content')).toHaveCount(1);
	await ask(mainWindow, 'can you open three more and place all the terminals in a 2x2 grid');

	// Pixel's report comes from the layout it read back, not from its plan.
	await expect(balloon(mainWindow)).toContainText('Opened 3, placed 3. Your window shows a 2x2 grid.', { timeout: 30_000 });
	await expect(balloon(mainWindow)).toContainText('✓ Looking at the layout');
	await expect(balloon(mainWindow)).toContainText('✓ Opening a terminal beside');
	// And it is on screen, in the project the user is looking at.
	await expect(workspace.locator('.terminal-tab-content')).toHaveCount(4);
	await expect(workspace.locator('.dv-groupview')).toHaveCount(4);
	const boxes = await workspace.locator('.terminal-panel:visible').evaluateAll((panels) =>
		panels.map((panel) => {
			const box = panel.getBoundingClientRect();
			return [Math.round(box.x), Math.round(box.y)];
		}),
	);
	expect(new Set(boxes.map(([x]) => x)).size).toBe(2);
	expect(new Set(boxes.map(([, y]) => y)).size).toBe(2);
});

test('a terminal Pixel opens in the automation space is listed in Tabs and opens from there', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await setPixel(appHarness, mainWindow, true);
	const statusBarDock = mainWindow.locator('.workspace-status-bar .pixel-dock--status-bar');
	await expect(statusBarDock).toBeVisible();
	const claudeChip = balloon(mainWindow).getByRole('button', { name: 'Claude Code' });
	await expect(async () => {
		if (await balloon(mainWindow).isVisible()) await statusBarDock.click();
		await statusBarDock.click();
		await expect(claudeChip).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await claudeChip.click();
	await expect(balloon(mainWindow).locator('.mwpet-chat-status')).toContainText('Claude Code');

	await ask(mainWindow, 'open a background terminal');
	await expect(balloon(mainWindow)).toContainText('Opened it in Automations.');
	// Not a tab of the project in front...
	await expect(mainWindow.locator('.project-workspace--active .terminal-tab-content')).toHaveCount(1);
	// ...but never out of sight: Tabs lists it under Automations.
	await statusBarDock.click();
	await mainWindow.locator('[data-terminay-home-control]:visible').first().click();
	await mainWindow.locator('[data-terminay-home-section-tab="tabs"]').click();
	const space = mainWindow.locator('[data-terminay-dashboard-project="system:automations"]').first();
	await expect(space).toBeVisible();
	const row = mainWindow.locator('[data-terminay-dashboard] [data-terminay-dashboard-panel]', { hasText: 'Background job' });
	await expect(row).toHaveCount(1);
	await row.click();
	await expect(mainWindow.locator('[data-terminay-automation-terminal-page]')).toBeVisible();
});

test('on a phone Pixel docks in the header in place of the connection glyph', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	await setPixel(appHarness, mainWindow, true);
	const nativeWindow = await electronApp.browserWindow(mainWindow);
	await nativeWindow.evaluate((window) => {
		window.setBounds({ x: 40, y: 40, width: 390, height: 740 });
	});
	const row = mainWindow.locator('[data-compact-chrome="true"]');
	const headerDock = row.locator('.pixel-dock--header');
	await expect(headerDock).toBeVisible();
	await expect(dock(mainWindow)).toHaveCount(1);
	await expect(row.locator('[data-compact-connection="true"]')).toHaveCount(0);
	await expect(mainWindow.locator('.pixel-dock--corner')).toHaveCount(0);

	await headerDock.click();
	await expect(balloon(mainWindow)).toBeVisible();

	// Off again, the glyph comes back to the trailing edge.
	await setPixel(appHarness, mainWindow, false);
	await expect(dock(mainWindow)).toHaveCount(0);
	await expect(row.locator('[data-compact-connection="true"]')).toBeVisible();
});
