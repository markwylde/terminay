import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openCanonicalWorkspace } from '../dist/workspaceHydration.js';
import { FileWorkspaceStateBackend } from '../dist/workspaceRepository.js';
import { restoreWorkspaceOnStartup } from '../dist/workspaceStartup.js';

/**
 * A restart, as it actually happens: the workspace is persisted to a file, the
 * process ends, and a new one opens the same file. What made the defect
 * invisible in unit tests is that nothing was wrong with the state — it was
 * faithfully restored, including terminals nothing was running any more.
 */

async function withDataRoot(run) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-restart-'));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** One server generation: open the persisted workspace, restore, seed, commit. */
async function startGeneration(root, sessionIds) {
	const backend = new FileWorkspaceStateBackend(join(root, 'workspace.v4.json'));
	const repository = await openCanonicalWorkspace({
		backend,
		serverId: 'restart-server',
		defaultProjectRoot: root,
	});
	const workspace = repository.workspace;
	let created = 0;
	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: repository.wasCreated,
		// A new process owns no sessions from the previous one, which is the
		// whole of what makes the persisted panels stale.
		liveSessionCount: () => 0,
		hasSession: (sessionId) => sessionIds.has(sessionId),
		createTerminal: async (request) => {
			created += 1;
			const sessionId = request.sessionId ?? `gen-session-${created}`;
			sessionIds.add(sessionId);
			if (request.sessionId === undefined) {
				const result = workspace.apply({
					commandId: `seed-${sessionId}`,
					command: {
						type: 'terminal.createPanel',
						projectId: request.projectId,
						sessionId,
						panelId: `gen-panel-${sessionId}`,
						title: 'Terminal 1',
						cwd: request.cwd,
						createdAt: Date.now(),
					},
				});
				assert.equal(
					result.ok,
					true,
					result.ok ? undefined : result.conflict.message,
				);
			}
			return { sessionId };
		},
	});
	await backend.commit(workspace.state);
	return workspace.state;
}

test('a restarted server publishes no terminal whose process is gone', async () => {
	await withDataRoot(async (root) => {
		const firstSessions = new Set();
		const first = await startGeneration(root, firstSessions);
		const firstPanels = Object.values(first.panels).filter(
			(panel) => panel.type === 'terminal',
		);
		assert.equal(firstPanels.length, 1, 'a first run seeds one terminal');

		// The process ends. Its sessions end with it; the file does not.
		const persisted = JSON.parse(
			await readFile(join(root, 'workspace.v4.json'), 'utf8'),
		);
		assert.equal(
			Object.values(persisted.panels).filter(
				(panel) => panel.type === 'terminal',
			).length,
			1,
			'the panel is persisted, which is why it came back',
		);

		const secondSessions = new Set();
		const second = await startGeneration(root, secondSessions);

		// Every terminal panel names a session this generation owns. Before the
		// restore was server-owned, the standalone server published the previous
		// generation's panels here and seeded nothing.
		const secondPanels = Object.values(second.panels).filter(
			(panel) => panel.type === 'terminal',
		);
		assert.equal(secondPanels.length, 1);
		for (const panel of secondPanels)
			assert.ok(
				secondSessions.has(panel.sessionId),
				`panel ${panel.id} names a session this server does not own`,
			);
		for (const sessionId of Object.keys(second.terminalSessions))
			assert.ok(
				secondSessions.has(sessionId),
				`session ${sessionId} outlived the process that owned it`,
			);
		assert.equal(
			[...firstSessions].some((sessionId) => secondSessions.has(sessionId)),
			false,
			'no session survives the restart',
		);
	});
});

test('projects and non-terminal panels survive the restart', async () => {
	await withDataRoot(async (root) => {
		await startGeneration(root, new Set());

		const backend = new FileWorkspaceStateBackend(
			join(root, 'workspace.v4.json'),
		);
		const repository = await openCanonicalWorkspace({
			backend,
			serverId: 'restart-server',
			defaultProjectRoot: root,
		});
		const workspace = repository.workspace;
		const projectId = Object.keys(workspace.state.projects)[0];
		const result = workspace.apply({
			commandId: 'add-file-panel',
			command: {
				type: 'panel.create',
				panel: {
					id: 'notes',
					projectId,
					type: 'file',
					path: 'NOTES.md',
					createdAt: 1,
				},
			},
		});
		assert.equal(
			result.ok,
			true,
			result.ok ? undefined : result.conflict.message,
		);
		await backend.commit(workspace.state);

		const restored = await startGeneration(root, new Set());
		// A file panel describes no process, so a restart has no reason to touch
		// it — the reaping is scoped to what the previous process owned.
		assert.equal(restored.panels.notes?.type, 'file');
		assert.notEqual(restored.projects[projectId], undefined);
	});
});
