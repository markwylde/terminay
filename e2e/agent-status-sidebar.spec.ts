import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { openFileExplorer } from './support/ui';

async function getActiveSessionId(page: Page): Promise<string> {
	const sessionId = await page.locator('.terminal-panel:visible').first().getAttribute('data-terminay-terminal-session-id');
	if (!sessionId) throw new Error('Active terminal session id is unavailable');
	return sessionId;
}

async function emitJournalRecord(page: Page, terminalSessionId: string, record: Record<string, unknown>): Promise<void> {
	await page.evaluate(async ({ value, sessionId }) => {
		if (!window.terminayTest) throw new Error('Terminay test API is unavailable');
		await window.terminayTest.emitAgentJournalRecord({ provider: 'codex', terminalSessionId: sessionId, record: value });
	}, { value: record, sessionId: terminalSessionId });
}

async function beginCodexSession(page: Page, terminalSessionId: string, providerSessionId: string): Promise<void> {
	await emitJournalRecord(page, terminalSessionId, {
		type: 'session_meta',
		payload: { id: providerSessionId, cli_version: '0.2.0', originator: 'codex-tui', source: 'cli' },
	});
}

async function destroySettingsWindow(electronApp: ElectronApplication): Promise<void> {
	await electronApp.evaluate(({ BrowserWindow }) => {
		const settingsWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && new URL(window.webContents.getURL()).searchParams.get('view') === 'settings');
		if (!settingsWindow) throw new Error('Settings window is unavailable');
		settingsWindow.destroy();
	});
}

test('Codex rollout state projects to the terminal indicator and Agents sidebar', async ({ mainWindow }) => {
	await sendAppCommand(mainWindow, 'new-terminal');
	const terminalSessionId = await getActiveSessionId(mainWindow);
	const agentTab = mainWindow.locator('.terminal-tab-content').filter({ hasText: 'Terminal 2' });
	await mainWindow.locator('.terminal-tab-content').filter({ hasText: 'Terminal 1' }).click();
	await beginCodexSession(mainWindow, terminalSessionId, 'codex-e2e-root');
	await emitJournalRecord(mainWindow, terminalSessionId, {
		type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' },
	});
	await emitJournalRecord(mainWindow, terminalSessionId, {
		type: 'event_msg', payload: { type: 'user_message', message: 'Implement the stable agent status flow', model: 'gpt-test-codex' },
	});
	await expect(agentTab.locator('.agent-status-indicator[data-agent-state="working"]')).toBeVisible();
	await openFileExplorer(mainWindow);
	await expect(mainWindow.locator('.agents-sidebar__name')).toContainText('Implement the stable agent status flow');
	await expect(mainWindow.locator('.agents-sidebar__metadata')).toContainText('Terminal 2 · Codex · gpt-test-codex');

	await emitJournalRecord(mainWindow, terminalSessionId, {
		type: 'event_msg', payload: { type: 'sub_agent_activity', agent_thread_id: 'reviewer-child', agent_path: '/root/reviewer', kind: 'started' },
	});
	const disclosure = mainWindow.getByRole('button', { name: 'Expand 1 subagent for Implement the stable agent status flow' });
	await disclosure.click();
	await expect(mainWindow.getByRole('button', { name: 'Focus reviewer terminal' })).toBeVisible();

	await emitJournalRecord(mainWindow, terminalSessionId, {
		type: 'event_msg', payload: { type: 'request_user_input' },
	});
	await expect(agentTab.locator('.agent-status-indicator[data-agent-state="waiting"]')).toBeVisible();
	await emitJournalRecord(mainWindow, terminalSessionId, {
		type: 'event_msg', payload: { type: 'task_complete' },
	});
	await emitJournalRecord(mainWindow, terminalSessionId, {
		type: 'event_msg', payload: { type: 'sub_agent_activity', agent_thread_id: 'reviewer-child', agent_path: '/root/reviewer', kind: 'completed' },
	});
	await expect(agentTab.locator('.agent-status-indicator[data-agent-state="done"]')).toBeVisible();
});

test('agent integration setting disables and restores journal-backed status', async ({ appHarness, electronApp, mainWindow }) => {
	const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'agent-integration' });
	const toggle = settingsWindow.getByLabel('Agent status and sidebar').locator('input[type="checkbox"]');
	await expect(toggle).toBeChecked();
	await toggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(toggle).not.toBeChecked();
	await destroySettingsWindow(electronApp);
	await openFileExplorer(mainWindow);
	await expect(mainWindow.getByRole('button', { name: /^Agents/ })).toHaveCount(0);

	const restoredWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'agent-integration' });
	const restoredToggle = restoredWindow.getByLabel('Agent status and sidebar').locator('input[type="checkbox"]');
	await restoredToggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(restoredToggle).toBeChecked();
	await destroySettingsWindow(electronApp);
	const sessionId = await getActiveSessionId(mainWindow);
	await beginCodexSession(mainWindow, sessionId, 'codex-restored');
	await emitJournalRecord(mainWindow, sessionId, { type: 'event_msg', payload: { type: 'user_message', message: 'Agent integration restored' } });
	await openFileExplorer(mainWindow);
	await expect(mainWindow.locator('.agents-sidebar__name')).toContainText('Agent integration restored');
});
