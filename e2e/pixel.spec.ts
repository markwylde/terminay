import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
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

async function fakeClaudeRunning(electronApp: ElectronApplication): Promise<boolean> {
	return electronApp.evaluate(async () => {
		const { execSync } = await import('node:child_process');
		try {
			return execSync('ps -eo args').toString().includes('fake-claude-chat.mjs');
		} catch {
			return false;
		}
	});
}

test('Pixel is off until enabled, asks for its agent, chats, acts through MCP, asks before acting under Ask, and leaves completely when turned off', async ({
	appHarness,
	electronApp,
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
	await statusBarDock.click();
	await expect(balloon(mainWindow)).toBeVisible();
	await expect(balloon(mainWindow)).toContainText('Which agent should I use?');
	const claudeChip = balloon(mainWindow).getByRole('button', { name: 'Claude Code' });
	await expect(claudeChip).toBeVisible();
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
	expect(await fakeClaudeRunning(electronApp)).toBe(true);

	// Turning Pixel off removes it everywhere and ends its agent.
	await setPixel(appHarness, mainWindow, false);
	await expect(dock(mainWindow)).toHaveCount(0);
	await expect(mainWindow.locator('.mwpet')).toHaveCount(0);
	await expect.poll(() => fakeClaudeRunning(electronApp), { timeout: 15_000 }).toBe(false);
});
