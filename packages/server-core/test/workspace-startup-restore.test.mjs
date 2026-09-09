import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
	createInitialWorkspace,
	WorkspaceStore,
} from '../dist/workspace.js';
import { restoreWorkspaceOnStartup } from '../dist/workspaceStartup.js';

/**
 * Restart recovery, exercised with no host in the picture at all. That is the
 * point of the module: a terminal panel names a process owned by the server
 * process that created it, and which host was running is not part of what makes
 * it stale.
 */

function seededWorkspace(options = {}) {
	const workspace = new WorkspaceStore(createInitialWorkspace('restore-test'));
	const viewId = workspace.state.viewOrder[0];
	const apply = (commandId, command) => {
		const result = workspace.apply({ commandId, command });
		assert.equal(
			result.ok,
			true,
			result.ok ? undefined : result.conflict.message,
		);
	};
	apply('project', {
		type: 'project.create',
		projectId: 'default',
		viewId,
		root: tmpdir(),
		name: 'Project',
	});
	apply('terminal-1', {
		type: 'terminal.createPanel',
		projectId: 'default',
		sessionId: 'stale-1',
		panelId: 'stale-panel-1',
		title: 'Terminal 1',
		cwd: tmpdir(),
		createdAt: 1,
	});
	apply('terminal-2', {
		type: 'terminal.createPanel',
		projectId: 'default',
		sessionId: 'stale-2',
		panelId: 'stale-panel-2',
		title: 'Terminal 2',
		cwd: tmpdir(),
		createdAt: 2,
	});
	apply('file', {
		type: 'panel.create',
		panel: {
			id: 'default-file',
			projectId: 'default',
			type: 'file',
			path: 'README.md',
			createdAt: 3,
		},
	});
	if (options.secondProject === true) {
		apply('other-project', {
			type: 'project.create',
			projectId: 'other',
			viewId,
			root: tmpdir(),
			name: 'Other',
		});
		apply('other-terminal', {
			type: 'terminal.createPanel',
			projectId: 'other',
			sessionId: 'stale-3',
			panelId: 'stale-panel-3',
			title: 'Terminal 1',
			cwd: tmpdir(),
			createdAt: 4,
		});
	}
	return workspace;
}

/**
 * What first-run initialization commits: one project and the one terminal panel
 * it names, whose session does not exist yet.
 */
function freshWorkspace() {
	const workspace = new WorkspaceStore(createInitialWorkspace('restore-test'));
	const viewId = workspace.state.viewOrder[0];
	const apply = (commandId, command) => {
		const result = workspace.apply({ commandId, command });
		assert.equal(
			result.ok,
			true,
			result.ok ? undefined : result.conflict.message,
		);
	};
	apply('project', {
		type: 'project.create',
		projectId: 'default',
		viewId,
		root: tmpdir(),
		name: 'Project',
	});
	apply('terminal', {
		type: 'terminal.createPanel',
		projectId: 'default',
		sessionId: 'seeded-default',
		panelId: 'seeded-default-panel',
		title: 'Terminal 1',
		cwd: tmpdir(),
		createdAt: 1,
	});
	return workspace;
}

/** Records what the host was asked to create, and creates the panel for it. */
function recordingCreator(workspace) {
	const requests = [];
	let created = 0;
	return {
		requests,
		createTerminal: async (request) => {
			requests.push(request);
			created += 1;
			// A first-run seed is asked for a session the workspace has already
			// committed a panel for, so only a replacement seed creates one.
			if (request.sessionId !== undefined)
				return { sessionId: request.sessionId };
			const sessionId = `fresh-${created}`;
			const result = workspace.apply({
				commandId: `seed-${created}`,
				command: {
					type: 'terminal.createPanel',
					projectId: request.projectId,
					sessionId,
					panelId: `fresh-panel-${created}`,
					title: `Terminal ${created}`,
					cwd: request.cwd,
					createdAt: 100 + created,
				},
			});
			assert.equal(
				result.ok,
				true,
				result.ok ? undefined : result.conflict.message,
			);
			return { sessionId };
		},
	};
}

function terminalPanels(workspace, projectId) {
	const project = workspace.state.projects[projectId];
	return project.panelIds.filter(
		(panelId) => workspace.state.panels[panelId]?.type === 'terminal',
	);
}

test('a restart drops every stale terminal panel and seeds one per project', async () => {
	const workspace = seededWorkspace({ secondProject: true });
	const creator = recordingCreator(workspace);

	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: false,
		liveSessionCount: () => 0,
		hasSession: () => false,
		createTerminal: creator.createTerminal,
	});

	// The panels naming the previous process's terminals are gone, and no
	// session record survives to be reopened against nothing.
	for (const panelId of ['stale-panel-1', 'stale-panel-2', 'stale-panel-3'])
		assert.equal(workspace.state.panels[panelId], undefined);
	assert.deepEqual(Object.keys(workspace.state.terminalSessions).sort(), [
		'fresh-1',
		'fresh-2',
	]);

	// One replacement each, not the two tabs the default project used to have.
	assert.equal(terminalPanels(workspace, 'default').length, 1);
	assert.equal(terminalPanels(workspace, 'other').length, 1);

	// Non-terminal panels describe no process and are kept.
	assert.equal(workspace.state.panels['default-file']?.type, 'file');
});

test('a project whose root could not be bound gets no replacement', async () => {
	const workspace = seededWorkspace();
	const creator = recordingCreator(workspace);

	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: false,
		liveSessionCount: () => 0,
		hasSession: () => false,
		unavailableProjectIds: new Set(['default']),
		createTerminal: creator.createTerminal,
	});

	// A missing root is a project condition to repair, so the project keeps its
	// identity and simply has no terminal until it is.
	assert.deepEqual(creator.requests, []);
	assert.equal(terminalPanels(workspace, 'default').length, 0);
	assert.notEqual(workspace.state.projects.default, undefined);
});

test('a server that already holds sessions reaps nothing', async () => {
	const workspace = seededWorkspace();
	const creator = recordingCreator(workspace);

	// Not a restart: something asked a live server to start twice, and its
	// terminals are the ones on screen.
	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: false,
		liveSessionCount: () => 2,
		hasSession: () => true,
		createTerminal: creator.createTerminal,
	});

	assert.notEqual(workspace.state.panels['stale-panel-1'], undefined);
	assert.notEqual(workspace.state.panels['stale-panel-2'], undefined);
	assert.deepEqual(creator.requests, []);
});

test('a first run seeds the terminal the new workspace already names', async () => {
	const workspace = freshWorkspace();
	const creator = recordingCreator(workspace);

	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: true,
		liveSessionCount: () => 0,
		hasSession: () => false,
		createTerminal: creator.createTerminal,
	});

	// The panel is already committed; only its session is missing, so the seed
	// honours the session id the workspace named rather than inventing one.
	assert.equal(creator.requests.length, 1);
	assert.equal(creator.requests[0].sessionId, 'seeded-default');
	assert.equal(creator.requests[0].projectRootOrigin, 'server-default');
	assert.notEqual(workspace.state.panels['seeded-default-panel'], undefined);
});

test('a first run whose session already exists seeds nothing', async () => {
	const workspace = freshWorkspace();
	const creator = recordingCreator(workspace);

	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: true,
		liveSessionCount: () => 1,
		hasSession: () => true,
		createTerminal: creator.createTerminal,
	});

	assert.deepEqual(creator.requests, []);
});

test('the active project is seeded before its siblings', async () => {
	const workspace = seededWorkspace({ secondProject: true });
	const viewId = workspace.state.viewOrder[0];
	const result = workspace.apply({
		commandId: 'select-other',
		command: { type: 'view.selectProject', viewId, projectId: 'other' },
	});
	assert.equal(result.ok, true, result.ok ? undefined : result.conflict.message);
	const creator = recordingCreator(workspace);

	await restoreWorkspaceOnStartup({
		workspace,
		firstRun: false,
		liveSessionCount: () => 0,
		hasSession: () => false,
		createTerminal: creator.createTerminal,
	});

	// The first tab a client shows should be ready before the ones behind it.
	assert.equal(creator.requests[0]?.projectId, 'other');
});
