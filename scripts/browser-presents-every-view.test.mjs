import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(
	join(process.cwd(), '.browser-every-view-test-'),
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

test.after(() => rm(testDirectory, { force: true, recursive: true }));

const project = (id, viewId) => ({
	id,
	serverId: 'pop-os',
	name: id,
	root: '/home/terminay',
	rootOrigin: 'server-default',
	viewId,
	folderIds: [],
	panelIds: [],
	sidebar: {
		fileExplorerWidth: 280,
		isFileExplorerOpen: true,
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
});

/** A server on which Desktop holds two windows besides the default view: each
 * window is a view, and each view holds one project. */
const snapshot = {
	schemaVersion: 1,
	cursor: 'cursor-1',
	revision: 1,
	serverId: 'pop-os',
	viewOrder: ['view-default', 'view-window-a', 'view-window-b'],
	views: {
		'view-default': {
			id: 'view-default',
			name: 'Window',
			serverId: 'pop-os',
			projectIds: ['project-1'],
		},
		'view-window-a': {
			id: 'view-window-a',
			name: 'Window',
			serverId: 'pop-os',
			projectIds: ['project-2'],
		},
		'view-window-b': {
			id: 'view-window-b',
			name: 'Window',
			serverId: 'pop-os',
			projectIds: ['project-3'],
		},
	},
	projects: {
		'project-1': project('project-1', 'view-default'),
		'project-2': project('project-2', 'view-window-a'),
		'project-3': project('project-3', 'view-window-b'),
	},
	folders: {},
	panels: {},
	terminalSessions: {},
};

function presentedProjectIds(options) {
	let presented = [];
	function Probe() {
		presented = useProjectCollection({
			isAdoptWindow: false,
			projectColorScope: 'pop-os',
			sidebarVisibilityScope: 'pop-os',
			sidebarSettings: defaultTerminalSettings.sidebar,
			workspaceSnapshotStore: { snapshot, subscribe: () => () => {} },
			...options,
		}).projects.map((entry) => entry.id);
		return null;
	}
	renderToStaticMarkup(React.createElement(Probe));
	return presented;
}

test('a Desktop window presents the projects of its own view', () => {
	assert.deepEqual(presentedProjectIds({ workspaceViewId: 'view-window-a' }), [
		'project-2',
	]);
});

// A browser has one window. Desktop can spread a server's projects over
// several native windows, each a view; a browser holds them all in one strip.
test('a browser presents the projects of every view of its server', () => {
	assert.deepEqual(
		presentedProjectIds({ workspaceViewId: null, presentsEveryView: true }),
		['project-1', 'project-2', 'project-3'],
	);
});
