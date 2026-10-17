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
	await claudeChip.click();
	await expect(balloon(mainWindow).locator('.mwpet-chat-title')).toHaveText('Pixel · Claude Code');

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
	await expect(balloon(mainWindow).locator('.mwpet-chat-title')).toHaveText('Pixel · Claude Code');

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
