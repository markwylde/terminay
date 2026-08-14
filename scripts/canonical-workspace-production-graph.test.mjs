import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
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
	assert.match(
		packageJson.scripts.dev,
		/^npm run build:app &&/u,
		'development must start from the same current Electron main, narrow preload, and server bundle artifacts as a release build',
	);
	assert.match(packageJson.scripts['build:app'], /remote\.html/u);
	assert.match(runner, /vite\.server-ui\.config\.ts/u);
	assert.match(runner, /build.*--watch/su);
	assert.match(serverUiConfig, /writeBundle\(\)/u);
	assert.match(serverUiConfig, /buildUiBundleManifest/u);
	assert.match(serverUiConfig, /manifestPublication\.then/u);
	assert.match(
		manifestBuilder,
		/rename\(temporaryManifestPath, manifestPath\)/u,
	);
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
	assert.match(vite, /apps\/terminay-server\/src\/desktopMcpEntry\.ts/u);
	const desktopMcpEntry = await read('apps/terminay-server/src/desktopMcpEntry.ts');
	assert.match(desktopMcpEntry, /runServerMcpStdio/u);
	assert.doesNotMatch(desktopMcpEntry, /assertStandaloneReleaseIntegrity/u);
	for (const path of [
		'index.html',
		'src/main.tsx',
		'src/rendererApp.tsx',
		'src/rendererRuntime.tsx',
		'electron/preload.ts',
		'electron/mcpEntry.ts',
	]) {
		await assert.rejects(access(new URL(`../${path}`, import.meta.url)));
	}
});

test('direct and WebRTC remote connections both launch the canonical server bundle', async () => {
	const main = await read('electron/main.ts');
	const server = await read('apps/terminay-server/src/localUiServer.ts');
	const remoteService = await read('electron/remote/service.ts');
	const presentation = main.slice(
		main.indexOf('async function presentCanonicalAuxiliaryRoute('),
		main.indexOf('\nasync function openEmbeddedWorkspaceWithRecovery'),
	);
	const httpLaunch = main.slice(
		main.indexOf('async function prepareCanonicalHttpRemoteLaunch('),
		main.indexOf('\nfunction bindServerUiWindow'),
	);
	assert.doesNotMatch(main, /function connectRemoteByteTransport/u);
	assert.doesNotMatch(main, /postMessage\(\s*'server:connection'/u);
	assert.match(presentation, /createDesktopReconnectTransport/u);
	assert.match(presentation, /prepareCanonicalHttpRemoteLaunch/u);
	assert.match(presentation, /createDesktopBootstrappedWebRtcConnection/u);
	assert.match(presentation, /remoteServerUiBundleHost\.prepareRemote/u);
	assert.match(presentation, /serverUiLaunch:\s*launch/u);
	assert.match(
		presentation,
		/serverUiTransport:\s*(?:connected|webRtc)\.transport/u,
	);
	assert.match(httpLaunch, /new URL\('\/host-bootstrap\.json', origin\)/u);
	assert.match(httpLaunch, /bootstrap\.manifestPath !== '\/manifest\.json'/u);
	assert.match(httpLaunch, /bootstrap\.streamPath !== '\/protocol\/stream'/u);
	assert.match(httpLaunch, /remoteServerUiBundleHost\.prepareRemote/u);
	assert.match(server, /\/host-bootstrap\.json/u);
	assert.match(
		main,
		/rendererDistDir:\s*SERVER_UI_DIST/u,
		'direct-browser and WebRTC exposure must serve the same generated UI root as Local Desktop',
	);
	assert.match(remoteService, /entry === 'server\.html'/u);
	assert.match(remoteService, /entryPath: `\/remote-app\/\$\{bundleId\}\/server\.html`/u);
	assert.match(remoteService, /pathname === '\/' \? '\/server\.html'/u);
	assert.doesNotMatch(remoteService, /entry === 'remote\.html'/u);
	assert.doesNotMatch(remoteService, /\/remote-app\/\$\{bundleId\}\/remote\.html/u);
});

test('renderer-owned workspace seeding is absent from Desktop production code', async () => {
	const main = await read('electron/main.ts');
	assert.match(
		main,
		/let serverTerminalAuthority: ServerTerminalAuthority \| null = null;/u,
		'pre-authority shell discovery must observe an explicit unpublished state',
	);
	assert.doesNotMatch(main, /ensureLocalWorkspaceSeed/u);
	assert.doesNotMatch(main, /localWorkspaceSeedPromise/u);
	assert.match(main, /workspace\.v3\.json/u);
	assert.match(main, /openCanonicalWorkspace/u);
	assert.match(main, /workspaceRepository:\s*embeddedWorkspace/u);
	const runtime = main.slice(
		main.indexOf('async function prepareEmbeddedRuntime()'),
		main.indexOf('\nasync function presentCanonicalAuxiliaryRoute('),
	);
	assert.match(runtime, /createWindow\(\{ deferCanonicalLaunch: true \}\)/u);
	assert.match(
		runtime,
		/openEmbeddedWorkspaceWithRecovery\(embeddedStartupWindow\)/u,
	);
	const initialize = runtime.indexOf('() => authority.initializeWorkspace()');
	const publish = runtime.indexOf('serverTerminalAuthority = authority');
	assert.ok(initialize >= 0 && initialize < publish);
	const readiness = main.slice(
		main.indexOf('async function completeDesktopStartup'),
	);
	const awaitRuntime = readiness.indexOf('await embeddedRuntimeReady');
	const ready = readiness.indexOf("event: 'local-server.ready'");
	const launch = readiness.indexOf(
		'await launchDeferredCanonicalWindow(embeddedStartupWindow)',
	);
	assert.ok(awaitRuntime >= 0 && awaitRuntime < ready && ready < launch);
});
