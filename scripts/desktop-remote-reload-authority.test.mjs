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

test('a new document reconnects its bound remote profile and cannot fall through to Local', () => {
	const finishLoad = main.slice(
		main.indexOf("window.webContents.on('did-start-loading'"),
		main.indexOf('// A torn-off window boots in "adopt" mode'),
	);
	assert.match(finishLoad, /remoteProfileBindingsByWebContents\.get/u);
	assert.match(finishLoad, /reconnectRememberedRemoteProfile/u);
	assert.match(finishLoad, /if \(isPendingRemoteConnectionWindow\(window\)\) return/u);
	assert.ok(
		finishLoad.indexOf('reconnectRememberedRemoteProfile') <
			finishLoad.indexOf('ensureLocalWorkspaceSeed'),
		'remote authority restoration must precede Local connection creation',
	);
	assert.match(
		finishLoad,
		/window\.webContents\.on\('did-finish-load', sendServerConnection\)/u,
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
