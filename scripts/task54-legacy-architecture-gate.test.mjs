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

test('the PWA and protocol expose one current connection-manager authority', async () => {
	await assert.rejects(access('apps/terminay-web/src/legacyMigration.ts'), (error) => error?.code === 'ENOENT');
	await assert.rejects(access('packages/server-core/src/migration/manager.ts'), (error) => error?.code === 'ENOENT');
	const [webManager, origins] = await Promise.all([
		readFile('apps/terminay-web/src/index.ts', 'utf8'),
		readFile('packages/protocol/src/managerOrigins.ts', 'utf8'),
	]);
	assert.match(webManager, /PwaConnectionManager/u);
	assert.match(origins, /TERMINAY_MANAGER_ORIGIN/u);
	for (const source of [webManager, origins]) {
		assert.doesNotMatch(source, /web\.terminay\.com|legacy|migration|reconnect grant|proof key/iu);
	}
});
