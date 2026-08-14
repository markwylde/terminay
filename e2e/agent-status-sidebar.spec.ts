import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { openFileExplorer } from './support/ui';

async function getActiveSessionId(page: Page): Promise<string> {
	const sessionId = await page.locator('.terminal-panel:visible').first().getAttribute('data-terminay-terminal-session-id');
	if (!sessionId) throw new Error('Active terminal session id is unavailable');
	return sessionId;
}

async function createTerminalAndGetActiveSessionId(page: Page): Promise<string> {
	const previousSessionId = await getActiveSessionId(page);
	await sendAppCommand(page, 'new-terminal');
	let createdSessionId = previousSessionId;
	await expect.poll(async () => {
		createdSessionId = await getActiveSessionId(page);
		return createdSessionId;
	}, {
		message: 'the newly-created canonical terminal should become active',
	}).not.toBe(previousSessionId);
	return createdSessionId;
}

async function emitJournalRecord(page: Page, terminalSessionId: string, record: Record<string, unknown>): Promise<void> {
	await page.evaluate(async ({ value, sessionId }) => {
		if (!window.terminayAgentStatusTest) throw new Error('Agent status test seam is unavailable');
		const accepted = await window.terminayAgentStatusTest.emitJournalRecord({ provider: 'codex', terminalSessionId: sessionId, record: value });
		if (!accepted) throw new Error('Agent journal record was not accepted');
	}, { value: record, sessionId: terminalSessionId });
}

async function beginCodexSession(page: Page, terminalSessionId: string, providerSessionId: string): Promise<void> {
	await emitJournalRecord(page, terminalSessionId, {
		type: 'session_meta',
		payload: { id: providerSessionId, cli_version: '0.2.0', originator: 'codex-tui', source: 'cli' },
	});
}

test('Codex rollout state projects to the terminal indicator and Agents sidebar', async ({ mainWindow }) => {
	const terminalSessionId = await createTerminalAndGetActiveSessionId(mainWindow);
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

test('a completed agent resumes working while a second running agent appears', async ({
	mainWindow,
}) => {
	const firstTerminalSessionId = await getActiveSessionId(mainWindow);
	await beginCodexSession(mainWindow, firstTerminalSessionId, 'codex-e2e-resumed-root');
	await emitJournalRecord(mainWindow, firstTerminalSessionId, {
		type: 'event_msg',
		payload: { type: 'user_message', message: 'Web disconnect bug' },
	});
	await emitJournalRecord(mainWindow, firstTerminalSessionId, {
		type: 'event_msg',
		payload: { type: 'task_complete', turn_id: 'turn-1' },
	});
	await openFileExplorer(mainWindow);
	const firstAgent = mainWindow
		.locator('.agents-sidebar__tree-item')
		.filter({ hasText: 'Web disconnect bug' });
	await expect(
		firstAgent.locator('.agent-status-indicator[data-agent-state="done"]'),
	).toBeVisible();
	await emitJournalRecord(mainWindow, firstTerminalSessionId, {
		type: 'event_msg',
		payload: { type: 'task_started', turn_id: 'turn-2' },
	});
	await expect(
		firstAgent.locator('.agent-status-indicator[data-agent-state="working"]'),
	).toBeVisible();

	const secondTerminalSessionId = await createTerminalAndGetActiveSessionId(mainWindow);
	await beginCodexSession(
		mainWindow,
		secondTerminalSessionId,
		'codex-e2e-concurrent-root',
	);
	await emitJournalRecord(mainWindow, secondTerminalSessionId, {
		type: 'event_msg',
		payload: { type: 'user_message', message: 'Agents not updating' },
	});

	const secondAgent = mainWindow
		.locator('.agents-sidebar__tree-item')
		.filter({ hasText: 'Agents not updating' });
	await expect(
		firstAgent.locator('.agent-status-indicator[data-agent-state="working"]'),
	).toBeVisible();
	await expect(
		secondAgent.locator('.agent-status-indicator[data-agent-state="working"]'),
	).toBeVisible();
});

test('agent integration setting disables and restores journal-backed status', async ({ appHarness, mainWindow }) => {
	const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'agent-integration' });
	const toggle = settingsWindow.getByLabel('Agent status and sidebar').locator('input[type="checkbox"]');
	await expect(toggle).toBeChecked();
	await toggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(toggle).not.toBeChecked();
	await settingsWindow.close();
	await openFileExplorer(mainWindow);
	await expect(mainWindow.getByRole('button', { name: /^Agents/ })).toHaveCount(0);

	const restoredWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'agent-integration' });
	const restoredToggle = restoredWindow.getByLabel('Agent status and sidebar').locator('input[type="checkbox"]');
	await restoredToggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(restoredToggle).toBeChecked();
	await restoredWindow.close();
	const sessionId = await getActiveSessionId(mainWindow);
	await beginCodexSession(mainWindow, sessionId, 'codex-restored');
	await emitJournalRecord(mainWindow, sessionId, { type: 'event_msg', payload: { type: 'user_message', message: 'Agent integration restored' } });
	await openFileExplorer(mainWindow);
	await expect(mainWindow.locator('.agents-sidebar__name')).toContainText('Agent integration restored');
});
