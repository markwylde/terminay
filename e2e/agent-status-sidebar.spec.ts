import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { expect, test } from './fixtures';
import { settledTerminalSessionId } from './support/terminal-session';
import { sendAppCommand } from './support/app';
import { openFileExplorer, selectSidebarGroup } from './support/ui';

async function getActiveSessionId(page: Page): Promise<string> {
	return await settledTerminalSessionId(page.locator('.terminal-panel:visible').first());
}

async function getActiveProjectId(page: Page): Promise<string> {
	const projectId = await page.locator('.project-tab--active').getAttribute('data-project-id');
	if (!projectId) throw new Error('Active project id is unavailable');
	return projectId;
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
	const providerSessionId = sessionsFor(page).get(terminalSessionId);
	if (!providerSessionId) throw new Error('Agent provider session is unavailable');
	const events = lifecycleEvents(record);
	if (events.length === 0) return;
	await page.evaluate(async ({ events: value, providerSessionId: providerSession, sessionId }) => {
		if (!window.terminayAgentStatusTest) throw new Error('Agent status test seam is unavailable');
		const accepted = await window.terminayAgentStatusTest.publishLifecycle({ provider: 'com.terminay.agent.codex/cli', terminalSessionId: sessionId, providerSessionId: providerSession, events: value });
		if (!accepted) throw new Error('Agent lifecycle publication was not accepted');
	}, { events, providerSessionId, sessionId: terminalSessionId });
}

const providerSessions = new WeakMap<Page, Map<string, string>>();

function sessionsFor(page: Page): Map<string, string> {
	const existing = providerSessions.get(page);
	if (existing) return existing;
	const created = new Map<string, string>();
	providerSessions.set(page, created);
	return created;
}

async function beginCodexSession(page: Page, terminalSessionId: string, providerSessionId: string): Promise<void> {
	sessionsFor(page).set(terminalSessionId, providerSessionId);
	await emitJournalRecord(page, terminalSessionId, { type: 'session_meta', payload: { id: providerSessionId } });
}

function lifecycleEvents(record: Record<string, unknown>): Array<Record<string, unknown>> {
	const payload = record.payload as Record<string, unknown> | undefined;
	if (record.type === 'session_meta') return [{ kind: 'session.started', title: 'Codex' }];
	if (record.type !== 'event_msg' || !payload || typeof payload.type !== 'string') return [];
	if (payload.type === 'task_started') return [{ kind: 'turn.started', turnId: String(payload.turn_id ?? 'turn') }];
	if (payload.type === 'user_message') return [{ kind: 'agent.metadata', promptText: String(payload.message ?? ''), ...(typeof payload.model === 'string' ? { model: { id: payload.model, displayName: payload.model } } : {}) }];
	if (payload.type === 'request_user_input') return [{ kind: 'wait.started', waitId: 'request-user-input', state: 'waiting', reason: 'request_user_input' }];
	if (payload.type === 'task_complete') return [{ kind: 'agent.done', outcome: 'success' }];
	if (payload.type === 'sub_agent_activity' && payload.kind === 'started') return [{ kind: 'subagent.started', subagentId: String(payload.agent_thread_id), title: String(payload.agent_path ?? '').split('/').filter(Boolean).at(-1) ?? String(payload.agent_thread_id) }];
	if (payload.type === 'sub_agent_activity' && payload.kind === 'completed') return [{ kind: 'subagent.done', subagentId: String(payload.agent_thread_id), outcome: 'success' }];
	return [];
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
	await selectSidebarGroup(mainWindow, 'agents');
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
	await selectSidebarGroup(mainWindow, 'agents');
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
		type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' },
	});
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
	await emitJournalRecord(mainWindow, sessionId, { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } });
	await emitJournalRecord(mainWindow, sessionId, { type: 'event_msg', payload: { type: 'user_message', message: 'Agent integration restored' } });
	await selectSidebarGroup(mainWindow, 'agents');
	await expect(mainWindow.locator('.agents-sidebar__name')).toContainText('Agent integration restored');
});

test('two live Desktop profiles keep Agents panes isolated', async ({
	mainWindow,
	appHarness,
}) => {
	const isolatedTempDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-e2e-agents-isolated-'));
	const isolatedUserDataDir = path.join(isolatedTempDir, 'user-data');
	const isolatedApp = await electron.launch({
		args: ['.'],
		env: {
			...process.env,
			CI: '1',
			ELECTRON_ENABLE_LOGGING: '1',
			TEMP: isolatedTempDir,
			TERMINAY_E2E_TEMP_DIR: isolatedTempDir,
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: isolatedUserDataDir,
			TMP: isolatedTempDir,
			TMPDIR: isolatedTempDir,
		},
	});
	try {
		const isolatedWindow = await isolatedApp.firstWindow();
		await appHarness.prepareWindow(isolatedWindow);
		// Each new profile intentionally hydrates the same canonical initial
		// workspace identities. The profiles' server/process authorities differ,
		// but their visible project and terminal labels and their opaque ids match.
		const firstProjectId = await getActiveProjectId(mainWindow);
		const secondProjectId = await getActiveProjectId(isolatedWindow);
		const firstSessionId = await getActiveSessionId(mainWindow);
		const secondSessionId = await getActiveSessionId(isolatedWindow);
		expect(firstProjectId).toBe('default');
		expect(secondProjectId).toBe(firstProjectId);
		expect(firstSessionId).toBe('default');
		expect(secondSessionId).toBe(firstSessionId);
		const providerSessionId = 'codex-identical-provider-session';
		await beginCodexSession(mainWindow, firstSessionId, providerSessionId);
		await emitJournalRecord(mainWindow, firstSessionId, {
			type: 'event_msg',
			payload: { type: 'task_started', turn_id: 'turn-1' },
		});
		await emitJournalRecord(mainWindow, firstSessionId, {
			type: 'event_msg',
			payload: { type: 'user_message', message: 'Profile A agent' },
		});
		await emitJournalRecord(mainWindow, firstSessionId, {
			type: 'event_msg',
			payload: {
				type: 'sub_agent_activity',
				agent_thread_id: 'profile-a-child',
				agent_path: '/root/profile-a-child',
				kind: 'started',
			},
		});
		await beginCodexSession(isolatedWindow, secondSessionId, providerSessionId);
		await emitJournalRecord(isolatedWindow, secondSessionId, {
			type: 'event_msg',
			payload: { type: 'task_started', turn_id: 'turn-1' },
		});
		await emitJournalRecord(isolatedWindow, secondSessionId, {
			type: 'event_msg',
			payload: { type: 'user_message', message: 'Profile B agent' },
		});
		await emitJournalRecord(isolatedWindow, secondSessionId, {
			type: 'event_msg',
			payload: {
				type: 'sub_agent_activity',
				agent_thread_id: 'profile-b-child',
				agent_path: '/root/profile-b-child',
				kind: 'started',
			},
		});
		await selectSidebarGroup(mainWindow, 'agents');
		await selectSidebarGroup(isolatedWindow, 'agents');
		await expect(mainWindow.locator('.agents-sidebar__name')).toContainText('Profile A agent');
		await expect(mainWindow.locator('.agents-sidebar__name')).not.toContainText('Profile B agent');
		await expect(isolatedWindow.locator('.agents-sidebar__name')).toContainText('Profile B agent');
		await expect(isolatedWindow.locator('.agents-sidebar__name')).not.toContainText('Profile A agent');
		await mainWindow.getByRole('button', { name: 'Expand 1 subagent for Profile A agent' }).click();
		await isolatedWindow.getByRole('button', { name: 'Expand 1 subagent for Profile B agent' }).click();
		await expect(mainWindow.getByRole('button', { name: 'Focus profile-a-child terminal' })).toBeVisible();
		await expect(mainWindow.getByRole('button', { name: 'Focus profile-b-child terminal' })).toHaveCount(0);
		await expect(isolatedWindow.getByRole('button', { name: 'Focus profile-b-child terminal' })).toBeVisible();
		await expect(isolatedWindow.getByRole('button', { name: 'Focus profile-a-child terminal' })).toHaveCount(0);
	} finally {
		await isolatedApp.close();
		await rm(isolatedTempDir, { recursive: true, force: true });
	}
});
