import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const presentation = main.slice(
	main.indexOf('async function presentCanonicalAuxiliaryRoute('),
	main.indexOf('\nasync function openEmbeddedWorkspaceWithRecovery'),
);

test('Electron retains the selected remote profile independently of its document transport', () => {
	assert.match(
		main,
		/const remoteProfileBindingsByWebContents = new Map<number, string>\(\)/u,
	);
	assert.match(
		presentation,
		/remoteProfileBindingsByWebContents\.set\([\s\S]*?(?:workspaceWindow|auxiliaryWindow)\.webContents\.id,[\s\S]*?profile\.id,[\s\S]*?\)/u,
	);
	assert.match(
		main,
		/remoteProfileBindingsByWebContents\.delete\(windowWebContentsId\)/u,
	);
});

test('normal workspace windows always load the canonical selected-server bundle', () => {
	const createWindow = main.slice(
		main.indexOf('function createWindow('),
		main.indexOf('function selectedProfileIdForRequester'),
	);
	assert.match(createWindow, /serverUiPreload\.cjs/u);
	assert.match(
		createWindow,
		/localServerUiSession\.prepare\(windowWebContentsId\)/u,
	);
	assert.doesNotMatch(
		createWindow,
		/VITE_DEV_SERVER_URL|ensureLocalWorkspaceSeed|sendServerConnection/u,
	);
});

test('reload reconnect uses the remembered OS-protected credential path', () => {
	assert.match(presentation, /createDesktopReconnectTransport/u);
	assert.match(presentation, /createDesktopDeviceCredentialStore\(\)/u);
	assert.match(presentation, /prepareCanonicalHttpRemoteLaunch/u);
	assert.match(presentation, /createDesktopBootstrappedWebRtcConnection/u);
	assert.match(presentation, /remoteServerUiBundleHost\.prepareRemote/u);
	assert.match(presentation, /serverUiLaunch:\s*launch/u);
	assert.match(
		presentation,
		/serverUiTransport:\s*(?:connected|webRtc)\.transport/u,
	);
	assert.doesNotMatch(presentation, /connectRemoteByteTransport/u);
	assert.doesNotMatch(
		presentation,
		/postLocalServerConnection|ensureLocalWorkspaceSeed/u,
	);
});
