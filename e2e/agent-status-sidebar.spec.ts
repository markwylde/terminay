import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';
import { settledTerminalSessionId } from './support/terminal-session';
import { openFileExplorer, selectSidebarGroup } from './support/ui';

async function getActiveSessionId(page: Page): Promise<string> {
	return await settledTerminalSessionId(
		page.locator('.terminal-panel:visible').first(),
	);
}

async function getActiveProjectId(page: Page): Promise<string> {
	const projectId = await page
		.locator('.project-tab--active')
		.getAttribute('data-project-id');
	if (!projectId) throw new Error('Active project id is unavailable');
	return projectId;
}

async function createTerminalAndGetActiveSessionId(
	page: Page,
): Promise<string> {
	const previousSessionId = await getActiveSessionId(page);
	await sendAppCommand(page, 'new-terminal');
	let createdSessionId = previousSessionId;
	await expect
		.poll(
			async () => {
				createdSessionId = await getActiveSessionId(page);
				return createdSessionId;
			},
			{
				message: 'the newly-created canonical terminal should become active',
			},
		)
		.not.toBe(previousSessionId);
	return createdSessionId;
}

type Snapshot = Record<string, unknown>;

/** Publish session snapshots through the server's session-source bridge. */
async function publish(page: Page, upserts: Snapshot[]): Promise<void> {
	const accepted = await page.evaluate(async (value) => {
		if (!window.terminayAgentStatusTest)
			throw new Error('Agent status test seam is unavailable');
		return await window.terminayAgentStatusTest.publishSessions({
			sourceId: 'com.terminay.e2e/agents',
			harnesses: [{ id: 'codex', displayName: 'Codex' }],
			publication: { upserts: value },
		});
	}, upserts);
	if (!accepted) throw new Error('Agent session publication was not accepted');
}

/**
 * A live session owned by a terminal's own PTY process, so the host binds it
 * to that terminal from the real process tree.
 */
async function sessionIn(
	page: Page,
	terminalSessionId: string,
	fields: Snapshot,
): Promise<Snapshot> {
	const pid = await page.evaluate(async (id) => {
		if (!window.terminayAgentStatusTest)
			throw new Error('Agent status test seam is unavailable');
		return await window.terminayAgentStatusTest.terminalShellPid(id);
	}, terminalSessionId);
	if (pid === null) throw new Error('Terminal shell pid is unavailable');
	return { harness: 'codex', pid, cwd: '/tmp', ...fields };
}

test('session status projects to the terminal indicator and Agents sidebar', async ({
	mainWindow,
}) => {
	const terminalSessionId =
		await createTerminalAndGetActiveSessionId(mainWindow);
	const agentTab = mainWindow
		.locator('.terminal-tab-content')
		.filter({ hasText: 'Terminal 2' });
	await mainWindow
		.locator('.terminal-tab-content')
		.filter({ hasText: 'Terminal 1' })
		.click();
	const root = await sessionIn(mainWindow, terminalSessionId, {
		id: 'codex-e2e-root',
		title: 'Implement the stable agent status flow',
		model: 'gpt-test-codex',
		status: 'running',
	});
	await publish(mainWindow, [root]);
	await expect(
		agentTab.locator('.agent-status-indicator[data-agent-state="working"]'),
	).toBeVisible();
	await selectSidebarGroup(mainWindow, 'agents');
	await expect(mainWindow.locator('.agents-sidebar__name')).toContainText(
		'Implement the stable agent status flow',
	);
	await expect(mainWindow.locator('.agents-sidebar__metadata')).toContainText(
		'Terminal 2 · Codex · gpt-test-codex',
	);

	const reviewer = {
		id: 'reviewer-child',
		type: 'reviewer',
		title: 'reviewer',
		status: 'running',
	};
	await publish(mainWindow, [{ ...root, subagents: [reviewer] }]);
	const disclosure = mainWindow.getByRole('button', {
		name: 'Expand 1 subagent for Implement the stable agent status flow',
	});
	await disclosure.click();
	await expect(
		mainWindow.getByRole('button', { name: 'Focus reviewer terminal' }),
	).toBeVisible();

	await publish(mainWindow, [
		{ ...root, status: 'waiting', subagents: [reviewer] },
	]);
	await expect(
		agentTab.locator('.agent-status-indicator[data-agent-state="waiting"]'),
	).toBeVisible();
	await publish(mainWindow, [
		{
			...root,
			status: 'idle',
			lastTurn: 'completed',
			lastTurnEndedAt: Date.now(),
			subagents: [{ ...reviewer, status: 'completed' }],
		},
	]);
	await expect(
		agentTab.locator('.agent-status-indicator[data-agent-state="done"]'),
	).toBeVisible();
});

test('a completed agent resumes working while a second running agent appears', async ({
	mainWindow,
}) => {
	const firstTerminalSessionId = await getActiveSessionId(mainWindow);
	const first = await sessionIn(mainWindow, firstTerminalSessionId, {
		id: 'codex-e2e-resumed-root',
		title: 'Web disconnect bug',
		status: 'running',
	});
	await publish(mainWindow, [first]);
	await publish(mainWindow, [
		{
			...first,
			status: 'idle',
			lastTurn: 'completed',
			lastTurnEndedAt: Date.now(),
		},
	]);
	await selectSidebarGroup(mainWindow, 'agents');
	const firstAgent = mainWindow
		.locator('.agents-sidebar__tree-item')
		.filter({ hasText: 'Web disconnect bug' });
	await expect(
		firstAgent.locator('.agent-status-indicator[data-agent-state="done"]'),
	).toBeVisible();
	await publish(mainWindow, [{ ...first, status: 'running' }]);
	await expect(
		firstAgent.locator('.agent-status-indicator[data-agent-state="working"]'),
	).toBeVisible();

	const secondTerminalSessionId =
		await createTerminalAndGetActiveSessionId(mainWindow);
	await publish(mainWindow, [
		await sessionIn(mainWindow, secondTerminalSessionId, {
			id: 'codex-e2e-concurrent-root',
			title: 'Agents not updating',
			status: 'running',
		}),
	]);

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

test('agent integration setting disables and restores session status', async ({
	appHarness,
	mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'agent-integration',
	});
	const toggle = settingsWindow
		.getByLabel('Agent status and sidebar')
		.locator('input[type="checkbox"]');
	await expect(toggle).toBeChecked();
	await toggle.evaluate((element) => (element as HTMLInputElement).click());
	await expect(toggle).not.toBeChecked();
	await settingsWindow.close();
	await openFileExplorer(mainWindow);
	await expect(mainWindow.getByRole('button', { name: /^Agents/ })).toHaveCount(
		0,
	);

	const restoredWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'agent-integration',
	});
	const restoredToggle = restoredWindow
		.getByLabel('Agent status and sidebar')
		.locator('input[type="checkbox"]');
	await restoredToggle.evaluate((element) =>
		(element as HTMLInputElement).click(),
	);
	await expect(restoredToggle).toBeChecked();
	await restoredWindow.close();
	const sessionId = await getActiveSessionId(mainWindow);
	await publish(mainWindow, [
		await sessionIn(mainWindow, sessionId, {
			id: 'codex-restored',
			title: 'Agent integration restored',
			status: 'running',
		}),
	]);
	await selectSidebarGroup(mainWindow, 'agents');
	await expect(mainWindow.locator('.agents-sidebar__name')).toContainText(
		'Agent integration restored',
	);
});

test('two live Desktop profiles keep Agents panes isolated', async ({
	mainWindow,
	appHarness,
}) => {
	const isolatedTempDir = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-e2e-agents-isolated-'),
	);
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
		const sessionId = 'codex-identical-provider-session';
		await publish(mainWindow, [
			await sessionIn(mainWindow, firstSessionId, {
				id: sessionId,
				title: 'Profile A agent',
				status: 'running',
				subagents: [
					{
						id: 'profile-a-child',
						type: 'profile-a-child',
						title: 'profile-a-child',
						status: 'running',
					},
				],
			}),
		]);
		await publish(isolatedWindow, [
			await sessionIn(isolatedWindow, secondSessionId, {
				id: sessionId,
				title: 'Profile B agent',
				status: 'running',
				subagents: [
					{
						id: 'profile-b-child',
						type: 'profile-b-child',
						title: 'profile-b-child',
						status: 'running',
					},
				],
			}),
		]);
		await selectSidebarGroup(mainWindow, 'agents');
		await selectSidebarGroup(isolatedWindow, 'agents');
		await expect(mainWindow.locator('.agents-sidebar__name')).toContainText(
			'Profile A agent',
		);
		await expect(mainWindow.locator('.agents-sidebar__name')).not.toContainText(
			'Profile B agent',
		);
		await expect(isolatedWindow.locator('.agents-sidebar__name')).toContainText(
			'Profile B agent',
		);
		await expect(
			isolatedWindow.locator('.agents-sidebar__name'),
		).not.toContainText('Profile A agent');
		await mainWindow
			.getByRole('button', { name: 'Expand 1 subagent for Profile A agent' })
			.click();
		await isolatedWindow
			.getByRole('button', { name: 'Expand 1 subagent for Profile B agent' })
			.click();
		await expect(
			mainWindow.getByRole('button', {
				name: 'Focus profile-a-child terminal',
			}),
		).toBeVisible();
		await expect(
			mainWindow.getByRole('button', {
				name: 'Focus profile-b-child terminal',
			}),
		).toHaveCount(0);
		await expect(
			isolatedWindow.getByRole('button', {
				name: 'Focus profile-b-child terminal',
			}),
		).toBeVisible();
		await expect(
			isolatedWindow.getByRole('button', {
				name: 'Focus profile-a-child terminal',
			}),
		).toHaveCount(0);
	} finally {
		await isolatedApp.close();
		await rm(isolatedTempDir, { recursive: true, force: true });
	}
});
