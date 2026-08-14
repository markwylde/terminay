import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	TASK19_FEATURE_MATRIX,
	TASK19_SURFACES,
} from './task19-compatibility-matrix.mjs';

const TASK16 = 'specs/tasks_completed/16-shared-responsive-server-ui.md';
const TASK19 = 'specs/tasks_completed/19-migration-and-compatibility-cleanup.md';

const REQUIRED_COMPLETE_TASK16_ITEMS = Object.freeze([
	'Make the production Electron and web hosts render the same extracted',
]);

const REQUIRED_COMPLETE_TASK19_ITEMS = Object.freeze([
	'Remove terminal/server-frame compatibility bootstrap from normal',
]);

function checklistItemIsComplete(source, prefix) {
	return source
		.split(/\r?\n/u)
		.some((line) => line.trimStart().startsWith('- [x] ') && line.includes(prefix));
}

test('production hosts use the shared selected-server bundle and complete parity contract', async () => {
	const [
		task16,
		task19,
		desktopMain,
		desktopRuntime,
		sharedWorkspace,
		webComposition,
		webEntry,
	] = await Promise.all([
		readFile(TASK16, 'utf8'),
		readFile(TASK19, 'utf8'),
		readFile('electron/main.ts', 'utf8'),
		readFile('src/rendererRuntime.tsx', 'utf8'),
		readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
		readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
		readFile('src/web/main.tsx', 'utf8'),
	]);

	const desktopUsesSharedWorkspace =
		desktopRuntime.includes('<ConnectedRendererWorkspace') &&
		desktopRuntime.includes('terminalClientContext={terminalClientContext}');
	const sharedWorkspaceUsesRealApp =
		sharedWorkspace.includes("import App from '../App'") &&
		sharedWorkspace.includes('<App');
	const webUsesSharedWorkspace =
		webEntry.includes('import { ConnectedWebRendererWorkspace }') &&
		webEntry.includes('<ConnectedWebRendererWorkspace') &&
		!webEntry.includes('ServerWorkspaceSurface') &&
		webComposition.includes('import { ConnectedRendererWorkspace }') &&
		webComposition.includes('<ConnectedRendererWorkspace');

	assert.equal(
		desktopUsesSharedWorkspace &&
			sharedWorkspaceUsesRealApp &&
			webUsesSharedWorkspace,
		true,
		'Electron and authenticated web must both mount the exact ConnectedRendererWorkspace -> App production tree',
	);
	assert.match(desktopMain, /remoteServerUiBundleHost\.prepareRemote\(\{/u);
	assert.match(desktopMain, /serverUiPreload\.js/u);
	assert.match(desktopMain, /server-ui-host:byte-endpoint/u);
	assert.match(desktopMain, /if \(VITE_DEV_SERVER_URL\)/u);
	assert.doesNotMatch(desktopMain, /renderer remains the compatibility surface/u);

	for (const item of REQUIRED_COMPLETE_TASK16_ITEMS) {
		assert.equal(
			checklistItemIsComplete(task16, item),
			true,
			`Task 16 parity item is not complete: ${item}`,
		);
	}
	for (const item of REQUIRED_COMPLETE_TASK19_ITEMS) {
		assert.equal(
			checklistItemIsComplete(task19, item),
			true,
			`Task 19 parity/cleanup item is not complete: ${item}`,
		);
	}

	for (const feature of TASK19_FEATURE_MATRIX) {
		for (const surface of ['wide-web', 'mobile-web']) {
			assert.equal(
				feature.status[surface],
				'contract',
				`${feature.id}/${surface} must be backed by production component-tree parity`,
			);
		}
	}
	assert.deepEqual(TASK19_SURFACES, [
		'local-desktop',
		'remote-desktop',
		'wide-web',
		'mobile-web',
	]);
});
