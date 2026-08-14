import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('development and packaged journeys assert the same canonical identity and UI surfaces', async () => {
	const [development, packaged] = await Promise.all([
		read('e2e/canonical-runtime-convergence.spec.ts'),
		read('scripts/packaged-desktop-startup-smoke.test.mjs'),
	]);
	for (const token of [
		'bundleId',
		'profileId',
		'projectId',
		'revision',
		'serverId',
		'sessionId',
		'windowId',
		'file-explorer-sidebar',
		"'File', 'Edit', 'View', 'Help'",
	]) {
		assert.ok(development.includes(token), `development journey is missing ${token}`);
		assert.ok(packaged.includes(token), `packaged journey is missing ${token}`);
	}
	assert.doesNotMatch(development, /ensureLocalWorkspaceSeed/u);
	assert.doesNotMatch(packaged, /ensureLocalWorkspaceSeed/u);
	assert.doesNotMatch(
		packaged,
		/getByLabel\(['"](?:Create project|Create terminal)/u,
	);
});

test('canonical journey suite owns clean, populated, multi-window, and remote coverage', async () => {
	const [freshAndPopulated, multiWindow, remote] = await Promise.all([
		read('e2e/canonical-runtime-convergence.spec.ts'),
		read('e2e/project-tabs.spec.ts'),
		read('e2e/desktop-remote-shared-shell.spec.ts'),
	]);
	assert.match(freshAndPopulated, /clean canonical development launch/u);
	assert.match(freshAndPopulated, /populated canonical workspace reloads/u);
	assert.match(multiWindow, /new window preserves its canonical project and terminal/u);
	assert.match(multiWindow, /workspace-revision/u);
	assert.match(remote, /authenticated remote Desktop renders the project-scoped shared shell locally/u);
	assert.match(remote, /remote-desktop-rendered-proof/u);
});
