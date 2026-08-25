import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';
import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { openFileExplorer } from './support/ui';

test('a real process-bound Codex wrapper retries its delayed rollout, then publishes a root, late child, and live title update', async ({
	mainWindow,
	appHarness,
	tempDir,
}) => {
	// A separately launched development instance must not inherit this
	// instance's terminal observation or agent projection. Use a distinct
	// profile before starting Codex, then re-check it after the root appears.
	const isolatedTempDir = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-e2e-isolated-'),
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
		await openFileExplorer(isolatedWindow);
		await expect(
			isolatedWindow.locator('.agents-sidebar__tree-item'),
		).toHaveCount(0);

		// This intentionally mirrors the production macOS shape: zsh launches a
		// Node CLI shim which later owns a native executable named codex. The first
		// foreground snapshot has no descendant, so it must return not-bound and
		// retry before the exact one-child chain can bind.
		await typeInVisibleTerminal(
			mainWindow,
			"node -e \"setTimeout(() => require('node:child_process').spawn('codex', [], { stdio: 'inherit' }), 350); setInterval(() => {}, 1000)\"\n",
		);
		await openFileExplorer(mainWindow);
		const root = mainWindow
			.locator('.agents-sidebar__tree-item')
			.filter({ hasText: 'Native Codex root prompt' });
		await expect(root).toBeVisible({ timeout: 15_000 });
		await expect(root.locator('.agents-sidebar__metadata')).toContainText(
			'Codex · gpt-e2e-codex',
		);
		await expect(
			isolatedWindow.locator('.agents-sidebar__tree-item'),
		).toHaveCount(0);

		const home = path.join(tempDir, 'native-codex-home');
		const sessionDirectory = path.join(home, 'sessions', '2026', '08', '24');
		await mkdir(sessionDirectory, { recursive: true });
		await writeFile(
			path.join(sessionDirectory, 'rollout-e2e-child.jsonl'),
			`${JSON.stringify({
				type: 'session_meta',
				payload: {
					id: 'e2e-native-child',
					originator: 'codex-tui',
					source: {
						subagent: { thread_spawn: { parent_thread_id: 'e2e-native-root' } },
					},
					agent_nickname: 'Native child',
				},
			})}\n`,
		);
		await expect(
			mainWindow.getByRole('button', {
				name: 'Expand 1 subagent for Native Codex root prompt',
			}),
		).toBeVisible({ timeout: 15_000 });

		await writeFile(
			path.join(home, 'session_index.jsonl'),
			`${JSON.stringify({ id: 'e2e-native-root', thread_name: 'Renamed native Codex session' })}\n`,
		);
		await expect(mainWindow.locator('.agents-sidebar__name')).toContainText(
			'Renamed native Codex session',
			{ timeout: 15_000 },
		);
	} finally {
		await isolatedApp.close();
		await rm(isolatedTempDir, { recursive: true, force: true });
	}
});
