import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

test('Electron retains the selected remote profile independently of its document transport', () => {
	assert.match(
		main,
		/const remoteProfileBindingsByWebContents = new Map<number, string>\(\)/u,
	);
	assert.match(
		main,
		/remoteProfileBindingsByWebContents\.set\(sender\.id, profile\.id\)/u,
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
	assert.match(createWindow, /localServerUiSession\.prepare\(windowWebContentsId\)/u);
	assert.match(createWindow, /server-ui-host:byte-endpoint/u);
	assert.doesNotMatch(
		createWindow,
		/VITE_DEV_SERVER_URL|ensureLocalWorkspaceSeed|sendServerConnection/u,
	);
});

test('reload reconnect uses the remembered OS-protected credential path', () => {
	const reconnect = main.slice(
		main.indexOf('async function reconnectRememberedRemoteProfile'),
		main.indexOf('function openMacrosWindow'),
	);
	assert.match(reconnect, /createDesktopReconnectTransport/u);
	assert.match(reconnect, /createDesktopDeviceCredentialStore\(\)/u);
	assert.match(reconnect, /createDesktopBootstrappedWebRtcConnection/u);
	assert.match(reconnect, /openCanonicalRemoteServerWindow/u);
	assert.match(reconnect, /connectRemoteByteTransport/u);
	assert.doesNotMatch(reconnect, /postLocalServerConnection|ensureLocalWorkspaceSeed/u);
});
