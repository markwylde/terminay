import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('normal Desktop windows always launch the canonical server workspace', async () => {
	const main = await read('electron/main.ts');
	const createWindow = main.slice(
		main.indexOf('function createWindow('),
		main.indexOf('\nfunction selectedProfileIdForRequester'),
	);

	assert.match(createWindow, /serverUiPreload\.cjs/u);
	assert.match(createWindow, /localServerUiSession\.prepare/u);
	assert.match(createWindow, /bindServerUiWindow/u);
	assert.match(createWindow, /bindLocalServerUiDocumentEndpoint/u);
	const documentEndpoint = await readFile(
		new URL('../electron/serverUiDocumentEndpoint.ts', import.meta.url),
		'utf8',
	);
	assert.match(documentEndpoint, /server-ui-host:byte-endpoint/u);
	assert.doesNotMatch(createWindow, /VITE_DEV_SERVER_URL/u);
	assert.doesNotMatch(createWindow, /preload\.mjs/u);
	assert.doesNotMatch(createWindow, /server:connection/u);
	assert.doesNotMatch(createWindow, /ensureLocalWorkspaceSeed/u);
});

test('the Desktop renderer build contains no second full-workspace entry', async () => {
	const vite = await read('vite.config.ts');
	assert.doesNotMatch(
		vite,
		/main:\s*path\.join\(__dirname,\s*'index\.html'\)/u,
	);
	assert.match(vite, /remote:\s*path\.join\(__dirname,\s*'remote\.html'\)/u);
});

test('development watches the same generated server workspace used by releases', async () => {
	const packageJson = JSON.parse(await read('package.json'));
	const runner = await read('scripts/run-canonical-development.mjs');
	const serverUiConfig = await read('vite.server-ui.config.ts');
	const manifestBuilder = await read('scripts/build-ui-bundle-manifest.mjs');

	assert.match(packageJson.scripts.dev, /run-canonical-development\.mjs/u);
	assert.match(packageJson.scripts['build:app'], /remote\.html/u);
	assert.match(runner, /vite\.server-ui\.config\.ts/u);
	assert.match(runner, /build.*--watch/su);
	assert.match(serverUiConfig, /writeBundle\(\)/u);
	assert.match(serverUiConfig, /buildUiBundleManifest/u);
	assert.match(serverUiConfig, /manifestPublication\.then/u);
	assert.match(manifestBuilder, /rename\(temporaryManifestPath, manifestPath\)/u);
	assert.doesNotMatch(
		packageJson.scripts['build:server-ui'],
		/build-ui-bundle-manifest/u,
	);
	assert.doesNotMatch(
		packageJson.scripts.dev,
		/VITE_DEV_SERVER_URL=.*index\.html/u,
	);
});

test('the packaged graph excludes superseded preload and MCP adapters', async () => {
	const vite = await read('vite.config.ts');
	assert.doesNotMatch(vite, /electron\/preload\.ts/u);
	assert.doesNotMatch(vite, /electron\/mcpEntry\.ts/u);
	assert.match(vite, /apps\/terminay-server\/src\/mcpEntry\.ts/u);
});

test('renderer-owned workspace seeding is absent from Desktop production code', async () => {
	const main = await read('electron/main.ts');
	assert.doesNotMatch(main, /ensureLocalWorkspaceSeed/u);
	assert.doesNotMatch(main, /localWorkspaceSeedPromise/u);
});
