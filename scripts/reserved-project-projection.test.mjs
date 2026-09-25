import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// The automation terminal space (ADR-0030) is a reserved project kind. It
// reaches capable clients in the workspace projection, and every project list
// derived from that projection must leave it out.

const outputDirectory = await mkdtemp(
	join(process.cwd(), 'scripts', '.reserved-project-projection-'),
);
await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/shared/serverWorkspaceReconciliation.ts'],
	format: 'esm',
	outdir: outputDirectory,
	platform: 'node',
	logLevel: 'silent',
});
const {
	isReservedWorkspaceProject,
	parseServerWorkspaceSnapshot,
	presentableViewProjects,
	reconcileServerWorkspaceSelection,
} = await import(
	pathToFileURL(join(outputDirectory, 'serverWorkspaceReconciliation.js')).href
);

test.after(async () => {
	await rm(outputDirectory, { recursive: true, force: true });
});

const SPACE = 'system:automations';

function sidebar() {
	return {
		fileExplorerWidth: 280, isFileExplorerOpen: false, isExplorerPaneCollapsed: false,
		isAgentsPaneCollapsed: false, isGitPaneCollapsed: false, isDocumentationPaneCollapsed: true,
		expandedAgentEntryIds: [], expandedDocumentationFolderIds: [], sidebarAgentsHeight: 200,
		sidebarExplorerHeight: 320, sidebarGitHeight: 240, sidebarDocumentationHeight: 220,
		sidebarPanelOrder: ['explorer', 'agents', 'git', 'documentation'],
	};
}

function project(id, extra = {}) {
	return {
		id, serverId: 'server-a', viewId: 'view-a', name: id, root: `/w/${id}`,
		rootOrigin: 'explicit', sidebar: sidebar(), panelIds: [], ...extra,
	};
}

function snapshotWithSpace({ listSpace = false } = {}) {
	return {
		schemaVersion: 5,
		serverId: 'server-a',
		revision: 4,
		cursor: '4',
		viewOrder: ['view-a'],
		views: {
			'view-a': {
				id: 'view-a', serverId: 'server-a', name: 'Workspace',
				projectIds: listSpace ? ['project-a', SPACE, 'project-b'] : ['project-a', 'project-b'],
				activeProjectId: 'project-a',
			},
		},
		projects: {
			'project-a': project('project-a'),
			'project-b': project('project-b'),
			[SPACE]: project(SPACE, {
				kind: 'automations', name: 'Automations', rootOrigin: 'server-default',
				panelIds: ['panel-auto'], activePanelId: 'panel-auto',
			}),
		},
		panels: {
			'panel-auto': { id: 'panel-auto', projectId: SPACE, type: 'terminal', sessionId: 'session-auto' },
		},
		terminalSessions: {
			'session-auto': { id: 'session-auto', serverId: 'server-a', projectId: SPACE, status: 'running' },
		},
	};
}

test('a capable client accepts the automation space and keeps its kind, panels, and terminals', () => {
	const state = parseServerWorkspaceSnapshot(snapshotWithSpace(), 'server-a');
	assert.equal(state.projects[SPACE].kind, 'automations');
	assert.equal(state.panels['panel-auto'].projectId, SPACE);
	assert.equal(state.terminalSessions['session-auto'].projectId, SPACE);
	assert.equal(isReservedWorkspaceProject(state.projects[SPACE]), true);
	assert.equal(isReservedWorkspaceProject(state.projects['project-a']), false);
});

test('the presentable project list excludes every reserved kind, in view order', () => {
	const state = parseServerWorkspaceSnapshot(snapshotWithSpace(), 'server-a');
	const view = state.views['view-a'];
	assert.deepEqual(presentableViewProjects(state, view).map((p) => p.id), ['project-a', 'project-b']);
	assert.deepEqual(presentableViewProjects(state, undefined), []);
	// Even a view that (wrongly) listed a reserved project yields only user projects.
	const listed = snapshotWithSpace({ listSpace: true });
	assert.deepEqual(
		presentableViewProjects(listed, listed.views['view-a']).map((p) => p.id),
		['project-a', 'project-b'],
	);
});

test('a projection that lists the reserved project as a view project is rejected', () => {
	assert.throws(
		() => parseServerWorkspaceSnapshot(snapshotWithSpace({ listSpace: true }), 'server-a'),
		/invalid workspace panel references/,
	);
});

test('selection reconciliation never selects the automation space', () => {
	const state = parseServerWorkspaceSnapshot(snapshotWithSpace(), 'server-a');
	assert.deepEqual(
		reconcileServerWorkspaceSelection(state, { viewId: 'view-a', projectId: SPACE, panelId: 'panel-auto' }),
		{ viewId: 'view-a', projectId: 'project-a', panelId: null },
	);
	const onlySpace = snapshotWithSpace();
	onlySpace.views['view-a'].projectIds = [];
	delete onlySpace.views['view-a'].activeProjectId;
	delete onlySpace.projects['project-a'];
	delete onlySpace.projects['project-b'];
	assert.deepEqual(
		reconcileServerWorkspaceSelection(parseServerWorkspaceSnapshot(onlySpace, 'server-a'), {
			viewId: 'view-a', projectId: SPACE, panelId: 'panel-auto',
		}),
		{ viewId: 'view-a', projectId: null, panelId: null },
	);
});

test('the project collection and view selection derive projects only through the reserved-kind filter', async () => {
	// useProjectCollection is the project choke point: the tab bar, switcher,
	// inventory, and Tabs section all read the `projects` it produces.
	const collection = await readFile('src/workspace/useProjectCollection.ts', 'utf8');
	assert.match(collection, /presentableViewProjects\(initialServerSnapshot, initialServerView\)/);
	assert.match(collection, /presentableViewProjects\(snapshot, view\)/);
	assert.doesNotMatch(collection, /projectIds\s*\.map\(\s*\(projectId\) => [a-zA-Z?.]*projects\[projectId\]/);
	const selection = await readFile('src/shared/useWorkspaceSelectionController.ts', 'utf8');
	assert.match(selection, /presentableViewProjects\(snapshot, view\)/);
});
