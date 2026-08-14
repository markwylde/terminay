import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [main, globals, transfer, actions] = await Promise.all([
	readFile('electron/main.ts', 'utf8'),
	readFile('src/vite-env.d.ts', 'utf8'),
	readFile('src/workspace/useProjectTabTransfer.ts', 'utf8'),
	readFile('src/host/nativeActions.ts', 'utf8'),
]);

test('workspace transfer uses logical server view identities only', () => {
	assert.match(main, /case 'workspace\.drag\.start'/u);
	assert.match(main, /case 'workspace\.drag\.end'/u);
	assert.match(main, /workspaceViewByWebContents\.get/u);
	assert.match(transfer, /workspaceSnapshotStore\.moveProject/u);
	assert.match(actions, /logicalViewId: `workspace:\$\{viewId\}`/u);
	assert.doesNotMatch(
		transfer,
		/targetWindowId|webContentsId|AdoptedProjectPayload/u,
	);
});

test('obsolete renderer payload, geometry, and transfer IPC authorities are absent', () => {
	for (const obsolete of [
		'desktop:workspace-transfer-host',
		'desktop:project-tab-host',
		'app:adopt-project',
		'app:project-drag-hover',
		'app:project-tab-torn-off',
		'pendingAdoptedProjects',
		'tabBarRectsByWebContents',
	])
		assert.doesNotMatch(main, new RegExp(obsolete, 'u'));
	assert.doesNotMatch(
		globals,
		/terminayProjectTabHost|terminayWorkspaceTransferHost/u,
	);
});

test('native drag hit testing derives bounded native window geometry', () => {
	assert.match(main, /window\.getContentBounds\(\)/u);
	assert.match(
		main,
		/height: Math\.min\(PROJECT_TAB_BAR_HEIGHT, content\.height\)/u,
	);
	assert.doesNotMatch(main, /publish-bar-rect/u);
});
