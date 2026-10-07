import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { withGeneralFolders } from './support/workspaceFolders.mjs'

const outputDirectory = await mkdtemp(
	join(process.cwd(), 'scripts', '.server-workspace-reconciliation-'),
);
await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/shared/serverWorkspaceReconciliation.ts'],
	format: 'esm',
	outdir: outputDirectory,
	platform: 'node',
});
const { parseServerWorkspaceSnapshot, reconcileServerWorkspaceSelection } =
	await import(
		pathToFileURL(join(outputDirectory, 'serverWorkspaceReconciliation.js'))
			.href
	);

test.after(async () => {
	await rm(outputDirectory, { recursive: true, force: true });
});

function snapshot({
	revision = 2,
	projectIds = ['project-a'],
	panelIds = ['panel-a'],
	activePanelId = 'panel-a',
	activeProjectId = projectIds[0],
} = {}) {
	const sidebar = () => ({
		fileExplorerWidth: 280, isFileExplorerOpen: false, isExplorerPaneCollapsed: false,
		isAgentsPaneCollapsed: false, isGitPaneCollapsed: false, isDocumentationPaneCollapsed: true,
		expandedAgentEntryIds: [], expandedDocumentationFolderIds: [], sidebarAgentsHeight: 200,
		sidebarExplorerHeight: 320, sidebarGitHeight: 240, sidebarDocumentationHeight: 220,
		sidebarPanelOrder: ['explorer', 'agents', 'git', 'documentation'],
	});
	return withGeneralFolders({
		schemaVersion: 6,
		serverId: 'server-a',
		revision,
		cursor: String(revision),
		viewOrder: ['view-a'],
		views: {
			'view-a': {
				id: 'view-a',
				serverId: 'server-a',
				name: 'Workspace',
				projectIds,
				activeProjectId,
			},
		},
		projects: Object.fromEntries(
			projectIds.map((id) => [
				id,
				{
					id,
					serverId: 'server-a',
					viewId: 'view-a',
					name: id,
					root: `/workspace/${id}`,
					rootOrigin: 'explicit',
					sidebar: sidebar(),
					panelIds: id === 'project-a' ? panelIds : [],
					...(id === 'project-a' && activePanelId !== undefined
						? { activePanelId }
						: {}),
				},
			]),
		),
		panels: Object.fromEntries(
			panelIds.map((id) => [
				id,
				{
					id,
					projectId: 'project-a',
					type: 'terminal',
					sessionId: `session-${id}`,
				},
			]),
		),
		terminalSessions: Object.fromEntries(
			panelIds.map((id) => [
				`session-${id}`,
				{
					id: `session-${id}`,
					serverId: 'server-a',
					projectId: 'project-a',
					status: 'running',
				},
			]),
		),
	});
}

test('reconciles a closed selection to the active server panel', () => {
	const state = parseServerWorkspaceSnapshot(
		snapshot({ panelIds: ['panel-b'], activePanelId: 'panel-b' }),
		'server-a',
	);
	assert.deepEqual(
		reconcileServerWorkspaceSelection(state, {
			viewId: 'view-a',
			projectId: 'project-a',
			panelId: 'panel-a',
		}),
		{ viewId: 'view-a', projectId: 'project-a', panelId: 'panel-b' },
	);
});

test('keeps a still-valid local project and panel when snapshot active ids change', () => {
	const state = parseServerWorkspaceSnapshot(
		snapshot({
			projectIds: ['project-a', 'project-b'],
			panelIds: ['panel-a', 'panel-b'],
			activeProjectId: 'project-b',
			activePanelId: 'panel-b',
		}),
		'server-a',
	);
	assert.deepEqual(
		reconcileServerWorkspaceSelection(state, {
			viewId: 'view-a',
			projectId: 'project-a',
			panelId: 'panel-a',
		}),
		{ viewId: 'view-a', projectId: 'project-a', panelId: 'panel-a' },
	);
});

test('accepts a history-expired full delta and rejects stale or crossed ownership state', () => {
	const known = parseServerWorkspaceSnapshot(
		snapshot({ revision: 2 }),
		'server-a',
	);
	assert.equal(
		parseServerWorkspaceSnapshot(snapshot({ revision: 3 }), 'server-a', known)
			.revision,
		3,
	);
	assert.throws(
		() =>
			parseServerWorkspaceSnapshot(
				snapshot({ revision: 1 }),
				'server-a',
				known,
			),
		/stale/u,
	);
	const broken = snapshot();
	broken.panels['panel-a'].projectId = 'project-missing';
	assert.throws(
		() => parseServerWorkspaceSnapshot(broken, 'server-a'),
		/invalid workspace panel/u,
	);
});

test('project and panel identity survives project switches and detach-reattach snapshots', () => {
	const workspace = (revision, activeProjectId, projectPanels) => {
		const sidebar = () => ({
			fileExplorerWidth: 280, isFileExplorerOpen: false, isExplorerPaneCollapsed: false,
			isAgentsPaneCollapsed: false, isGitPaneCollapsed: false, isDocumentationPaneCollapsed: true,
			expandedAgentEntryIds: [], expandedDocumentationFolderIds: [], sidebarAgentsHeight: 200,
			sidebarExplorerHeight: 320, sidebarGitHeight: 240, sidebarDocumentationHeight: 220,
			sidebarPanelOrder: ['explorer', 'agents', 'git', 'documentation'],
		});
		const projectIds = Object.keys(projectPanels);
		const panels = Object.fromEntries(
			projectIds.flatMap((projectId) =>
				projectPanels[projectId].map((panelId) => [
					panelId,
					{
						id: panelId,
						projectId,
						type: 'terminal',
						sessionId: `session-${panelId}`,
					},
				]),
			),
		);
		const terminalSessions = Object.fromEntries(
			Object.values(panels).map((panel) => [
				panel.sessionId,
				{
					id: panel.sessionId,
					serverId: 'server-a',
					projectId: panel.projectId,
					status: 'running',
				},
			]),
		);
		return withGeneralFolders({
			schemaVersion: 6,
			serverId: 'server-a',
			revision,
			cursor: String(revision),
			viewOrder: ['view-a'],
			views: {
				'view-a': {
					id: 'view-a',
					serverId: 'server-a',
					name: 'Workspace',
					projectIds,
					activeProjectId,
				},
			},
			projects: Object.fromEntries(
				projectIds.map((projectId) => [
					projectId,
					{
						id: projectId,
						serverId: 'server-a',
						viewId: 'view-a',
						name: projectId,
						root: `/workspace/${projectId}`,
						rootOrigin: 'explicit',
						sidebar: sidebar(),
						panelIds: projectPanels[projectId],
						...(projectPanels[projectId][0] === undefined
							? {}
							: { activePanelId: projectPanels[projectId][0] }),
					},
				]),
			),
			panels,
			terminalSessions,
		});
	};

	const initial = parseServerWorkspaceSnapshot(
		workspace(1, 'project-a', {
			'project-a': ['panel-a'],
			'project-b': ['panel-b'],
		}),
		'server-a',
	);
	assert.deepEqual(
		reconcileServerWorkspaceSelection(initial, {
			viewId: null,
			projectId: null,
			panelId: null,
		}),
		{ viewId: 'view-a', projectId: 'project-a', panelId: 'panel-a' },
	);

	const switched = parseServerWorkspaceSnapshot(
		workspace(2, 'project-b', {
			'project-a': ['panel-a'],
			'project-b': ['panel-b'],
		}),
		'server-a',
		initial,
	);
	const projectBSelection = reconcileServerWorkspaceSelection(switched, {
		viewId: 'view-a',
		projectId: 'project-b',
		panelId: 'panel-b',
	});
	assert.deepEqual(projectBSelection, {
		viewId: 'view-a',
		projectId: 'project-b',
		panelId: 'panel-b',
	});
	assert.equal(
		switched.panels[projectBSelection.panelId].sessionId,
		'session-panel-b',
	);

	const detached = parseServerWorkspaceSnapshot(
		workspace(3, 'project-b', { 'project-a': ['panel-a'], 'project-b': [] }),
		'server-a',
		switched,
	);
	assert.deepEqual(
		reconcileServerWorkspaceSelection(detached, projectBSelection),
		{ viewId: 'view-a', projectId: 'project-b', panelId: null },
	);

	const reattached = parseServerWorkspaceSnapshot(
		workspace(4, 'project-b', {
			'project-a': ['panel-a'],
			'project-b': ['panel-b'],
		}),
		'server-a',
		detached,
	);
	const restored = reconcileServerWorkspaceSelection(reattached, {
		viewId: 'view-a',
		projectId: 'project-b',
		panelId: null,
	});
	assert.deepEqual(restored, projectBSelection);
	assert.deepEqual(reattached.terminalSessions['session-panel-b'], {
		id: 'session-panel-b',
		serverId: 'server-a',
		projectId: 'project-b',
		status: 'running',
	});
});

test('a snapshot is accepted only with valid folders', () => {
	const valid = snapshot();
	const parsed = parseServerWorkspaceSnapshot(valid, 'server-a');
	const project = parsed.projects['project-a'];
	assert.equal(parsed.folders[project.folderIds[0]].kind, 'general');
	assert.equal(parsed.panels['panel-a'].folderId, project.folderIds[0]);

	const broken = (mutate) => {
		const candidate = structuredClone(snapshot());
		mutate(candidate, candidate.projects['project-a'].folderIds[0]);
		return () => parseServerWorkspaceSnapshot(candidate, 'server-a');
	};
	// The schema before folders is not readable by this client.
	assert.throws(broken((state) => { state.schemaVersion = 5; }), /incompatible workspace snapshot/);
	assert.throws(broken((state) => { delete state.folders; }), /incompatible workspace snapshot/);
	assert.throws(broken((state, general) => { state.folders[general].kind = 'plain'; }), /invalid workspace folder references/);
	assert.throws(broken((state) => { state.projects['project-a'].folderIds = []; }), /invalid workspace folder references/);
	assert.throws(broken((state, general) => { state.folders[general].projectId = 'project-b'; }), /folder/);
	assert.throws(broken((state, general) => { state.folders[general].kind = 'linked'; }), /folder/);
	assert.throws(broken((state, general) => { state.folders[general].panelIds = []; }), /invalid workspace (folder|panel)/);
	assert.throws(broken((state) => { state.panels['panel-a'].folderId = 'folder-missing'; }), /folder|panel/);
	assert.throws(broken((state, general) => { state.folders[general].captureOffer = { panelId: 'panel-missing' }; }), /invalid workspace folder/);
});

test('a linked folder carries its worktree and the panels it holds', () => {
	const state = structuredClone(snapshot({ panelIds: ['panel-a', 'panel-b'] }));
	const project = state.projects['project-a'];
	const general = project.folderIds[0];
	state.folders['folder-wt'] = { id: 'folder-wt', projectId: 'project-a', name: 'feature', kind: 'linked', worktree: { repositoryId: 'repo', path: '/workspace/feature' }, panelIds: ['panel-b'], activePanelId: 'panel-b', createdByPanelId: 'panel-a', captureOffer: { panelId: 'panel-a' } };
	project.folderIds = [general, 'folder-wt'];
	state.folders[general].panelIds = ['panel-a'];
	state.folders[general].activePanelId = 'panel-a';
	state.panels['panel-b'].folderId = 'folder-wt';
	const parsed = parseServerWorkspaceSnapshot(state, 'server-a');
	assert.deepEqual(parsed.folders['folder-wt'].worktree, { repositoryId: 'repo', path: '/workspace/feature' });
	assert.deepEqual(parsed.projects['project-a'].panelIds, ['panel-a', 'panel-b']);
});
