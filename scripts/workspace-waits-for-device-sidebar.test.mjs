import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// A project's sidebar visibility and group are this device's preferences
// (project-sidebar-layout: "Device-scoped visibility and group preferences").
// They load with the device's settings, which can arrive after the server's
// workspace snapshot. A project presented before then is presented from the
// defaults, every sidebar closed, and a toggle made in that window is
// overwritten when the saved preference lands. The workspace instead stays
// hydrating until the preferences are known, so the first project a person can
// act on is the restored one.

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(
	join(process.cwd(), '.workspace-device-sidebar-test-'),
);

async function bundle(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { useProjectCollection } = await bundle(
	'src/workspace/useProjectCollection.ts',
	'use-project-collection.cjs',
);
const { defaultTerminalSettings } = await bundle(
	'src/terminalSettings.ts',
	'terminal-settings.cjs',
);
const { withProjectSidebarVisibility } = await bundle(
	'src/workspace/projectTabModel.ts',
	'project-tab-model.cjs',
);

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const snapshot = {
	schemaVersion: 1,
	cursor: 'cursor-1',
	revision: 1,
	serverId: 'desktop-local',
	viewOrder: ['view-default'],
	views: {
		'view-default': {
			id: 'view-default',
			name: 'Window',
			serverId: 'desktop-local',
			projectIds: ['project-1'],
		},
	},
	projects: {
		'project-1': {
			id: 'project-1',
			serverId: 'desktop-local',
			name: 'Project 1',
			root: '/home/terminay',
			rootOrigin: 'server-default',
			viewId: 'view-default',
			folderIds: [],
			panelIds: [],
			sidebar: {
				isFileExplorerOpen: false,
				isExplorerPaneCollapsed: false,
				isAgentsPaneCollapsed: false,
				isGitPaneCollapsed: false,
				isDocumentationPaneCollapsed: false,
				expandedAgentEntryIds: [],
				expandedDocumentationFolderIds: [],
				sidebarAgentsHeight: 200,
				sidebarExplorerHeight: 200,
				sidebarGitHeight: 200,
				sidebarDocumentationHeight: 200,
				sidebarPanelOrder: ['explorer', 'agents', 'documentation'],
			},
		},
	},
	folders: {},
	panels: {},
	terminalSessions: {},
};

/** This device left project-1's sidebar open. */
const savedSidebar = withProjectSidebarVisibility(
	defaultTerminalSettings.sidebar,
	'desktop-local',
	'project-1',
	true,
);

function firstPresentation(options) {
	let presented;
	function Probe() {
		const collection = useProjectCollection({
			isAdoptWindow: false,
			projectColorScope: 'desktop-local',
			sidebarVisibilityScope: 'desktop-local',
			workspaceSnapshotStore: { snapshot, subscribe: () => () => {} },
			workspaceViewId: null,
			...options,
		});
		presented = {
			activeProjectId: collection.activeProjectId,
			canAddProject: collection.canAddProject,
			isHomeSelected: collection.isHomeSelected,
			isWorkspaceHydrating: collection.isWorkspaceHydrating,
			projects: collection.projects.map((project) => ({
				id: project.id,
				isFileExplorerOpen: project.isFileExplorerOpen,
			})),
		};
		return null;
	}
	renderToStaticMarkup(React.createElement(Probe));
	return presented;
}

test('no project is presented from default sidebar settings while the saved ones load', () => {
	// The server's snapshot is known; this device's settings are not yet, so
	// the collection holds only the defaults, in which every sidebar is closed.
	const presented = firstPresentation({
		sidebarSettings: defaultTerminalSettings.sidebar,
		sidebarSettingsKnown: false,
	});
	assert.deepEqual(presented.projects, []);
	assert.equal(presented.activeProjectId, '');
	assert.equal(presented.isWorkspaceHydrating, true);
	// Hydrating is not an empty window: Home is not forced, and a project
	// cannot be created from defaults either.
	assert.equal(presented.isHomeSelected, false);
	assert.equal(presented.canAddProject, false);
});

test('once the saved settings are known, the first presentation is the restored sidebar', () => {
	const presented = firstPresentation({
		sidebarSettings: savedSidebar,
		sidebarSettingsKnown: true,
	});
	assert.equal(presented.isWorkspaceHydrating, false);
	assert.equal(presented.canAddProject, true);
	assert.deepEqual(presented.projects, [
		{ id: 'project-1', isFileExplorerOpen: true },
	]);
});

test('the main workspace tells the collection whether its settings have loaded', async () => {
	const { readFile } = await import('node:fs/promises');
	const app = await readFile('src/App.tsx', 'utf8');
	assert.match(app, /sidebarSettingsKnown:\s*!isTerminalSettingsLoading/);
});
