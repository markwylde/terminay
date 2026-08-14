import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const supersededPaths = [
	'electron/preload.ts',
	'index.html',
	'src/main.tsx',
	'src/rendererApp.tsx',
	'src/rendererRuntime.tsx',
	'electron/remote/legacyTerminalProtocol.ts',
	'packages/server-core/src/migration/recovery.ts',
];

test('superseded renderer architecture and adapter recovery inventory stay absent', async () => {
	for (const path of supersededPaths) {
		await assert.rejects(
			access(path),
			(error) => error?.code === 'ENOENT',
			`${path} must not return as a compatibility or recovery path`,
		);
	}

	const production = await Promise.all([
		readFile('electron/main.ts', 'utf8'),
		readFile('vite.config.ts', 'utf8'),
		readFile('packages/server-core/src/migration/index.ts', 'utf8'),
	]);
	for (const source of production) {
		assert.doesNotMatch(
			source,
			/rendererPreload|terminalOnlyRemote|recordingPreload|fileViewerPreload|retain-until-parity/u,
		);
	}
});

test('retained compatibility is persisted-data migration, deployed wire parsing, or fail-closed policy', async () => {
	const [webMigration, recording, workspace, settings, runtime, remoteProtocol] =
		await Promise.all([
			readFile('apps/terminay-web/src/legacyMigration.ts', 'utf8'),
			readFile('electron/recording/service.ts', 'utf8'),
			readFile('packages/server-core/src/workspace.ts', 'utf8'),
			readFile('packages/server-core/src/settings/normalize.ts', 'utf8'),
			readFile('apps/terminay-server/src/remote/secureWeriftRuntime.ts', 'utf8'),
			readFile('electron/remote/deployedTerminalProtocol.ts', 'utf8'),
		]);
	assert.match(webMigration, /consumeLegacyManagerMigration/u);
	assert.match(webMigration, /removeItem/u);
	assert.match(recording, /legacyCastPath/u);
	assert.match(workspace, /legacyProjects/u);
	assert.match(settings, /migrateLegacyShellSettings/u);
	assert.match(runtime, /legacyNodeDataChannelFallback:\s*false/u);
	assert.doesNotMatch(runtime, /legacyNodeDataChannelFallback:\s*true/u);
	assert.match(remoteProtocol, /parseRemoteClientMessage/u);
	assert.doesNotMatch(remoteProtocol, /BrowserWindow|ipcRenderer|WebContents|preload/u);
});
