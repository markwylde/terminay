import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { openFileExplorer } from './support/ui';

test('a real process-bound Codex wrapper publishes a root, late child, and live title update', async ({
	mainWindow,
	tempDir,
}) => {
	// This intentionally mirrors the production macOS shape: zsh launches a
	// Node CLI shim which owns a native executable named codex. The provider can
	// bind only if host foreground topology unpacks that exact one-child chain.
	await typeInVisibleTerminal(
		mainWindow,
		"node -e \"require('node:child_process').spawn('codex', [], { stdio: 'inherit' })\"\n",
	);
	await openFileExplorer(mainWindow);
	const root = mainWindow
		.locator('.agents-sidebar__tree-item')
		.filter({ hasText: 'Native Codex root prompt' });
	await expect(root).toBeVisible({ timeout: 15_000 });
	await expect(root.locator('.agents-sidebar__metadata')).toContainText(
		'Codex · gpt-e2e-codex',
	);

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
});
