import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canonicalizeWorkspaceState,
	createInitialWorkspace,
	WorkspaceStore,
} from '../dist/index.js';

test('file panel presentation round-trips across canonicalize, move, and reconnect snapshots', () => {
	const store = new WorkspaceStore(createInitialWorkspace('server-a'));
	const viewId = store.state.viewOrder[0];
	assert.equal(
		store.apply({
			commandId: 'project',
			expectedRevision: 0,
			command: {
				type: 'project.create',
				projectId: 'project-a',
				viewId,
				root: '/tmp/a',
				name: 'A',
			},
		}).ok,
		true,
	);
	assert.equal(
		store.apply({
			commandId: 'panel',
			expectedRevision: 1,
			command: {
				type: 'panel.create',
				panel: {
					id: 'file-1',
					projectId: 'project-a',
					type: 'file',
					path: 'docs/guide.mdx',
					createdAt: 1,
					presentation: 'documentation',
				},
			},
		}).ok,
		true,
	);
	const canonical = canonicalizeWorkspaceState(store.state);
	assert.equal(canonical.panels['file-1'].type, 'file');
	assert.equal(canonical.panels['file-1'].presentation, 'documentation');
	assert.equal(
		store.apply({
			commandId: 'update',
			expectedRevision: 2,
			command: {
				type: 'panel.update',
				panelId: 'file-1',
				patch: { presentation: 'file-viewer' },
			},
		}).ok,
		true,
	);
	assert.equal(
		canonicalizeWorkspaceState(store.state).panels['file-1'].presentation,
		'file-viewer',
	);
});
