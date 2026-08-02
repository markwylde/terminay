import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const connectionMenu = await readFile(
	new URL('../src/workspace/RemoteAccessConnectionMenu.tsx', import.meta.url),
	'utf8',
);
const remoteConnectionForm = await readFile(
	new URL('../src/workspace/useRemoteConnectionForm.ts', import.meta.url),
	'utf8',
);
const preload = await readFile(
	new URL('../electron/preload.ts', import.meta.url),
	'utf8',
);
const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const transport = await readFile(
	new URL('../src/shared/remoteStreamTransport.ts', import.meta.url),
	'utf8',
);

test('Desktop header uses the current-server connection menu', () => {
	assert.match(connectionMenu, /aria-label="Connection menu"/);
	assert.match(app, /currentServerLabel/);
	assert.match(connectionMenu, /Connections/);
	assert.match(connectionMenu, /ConnectionSwitcherEntry/);
	assert.match(connectionMenu, /role="menuitemradio"/);
	assert.match(connectionMenu, /onSelectConnection/);
	assert.match(app, /normalizeConnectionSwitcherEntries/);
	assert.match(app, /window\.terminayHost[\s\S]*\.getContext\(\)/u);
	assert.match(app, /window\.terminayConnectionHost\.list\(\)/u);
	assert.match(app, /window\.terminayConnectionHost\?\.select/u);
	assert.match(app, /describeConnectionHostError/u);
	assert.match(
		app,
		/setConnectionSwitcherError\(describeConnectionHostError\(cause\)\)/u,
	);
	assert.match(app, /setIsRemoteMenuOpen\(true\)/u);
	assert.match(
		app,
		/requestAction\(\{\s*type: 'connection\.select',\s*profileId: id,\s*\}\)/u,
	);
	assert.match(connectionMenu, /role="alert"/u);
	assert.match(connectionMenu, /Connection Error/u);
	assert.match(connectionMenu, /Current Server/);
	assert.match(connectionMenu, /Connected/);
	assert.match(connectionMenu, /Manage connections…/);
	assert.match(app, /openRemoteConnection/);
	assert.match(connectionMenu, /Expose At/);
	assert.match(connectionMenu, /Expose this server…/);
	assert.doesNotMatch(connectionMenu, /title="Open remote access menu"/);
	assert.doesNotMatch(connectionMenu, /aria-label="Remote access menu"/);
	assert.doesNotMatch(connectionMenu, /: 'Start Server'/);
});

test('standalone connection action reaches a real HTTP client session through the narrow connection-host bridge', () => {
	assert.match(
		remoteConnectionForm,
		/window\.terminayConnectionHost\.open\([\s\S]*url\.trim\(\),[\s\S]*pairingPin \|\| undefined/u,
	);
	assert.doesNotMatch(app, /window\.terminay\.openRemoteConnection\(/u);
	assert.match(preload, /exposeInMainWorld\(\s*'terminayConnectionHost'/u);
	assert.match(preload, /desktop:connection-host:open/u);
	assert.match(preload, /desktop:connection-host:list/u);
	assert.match(preload, /desktop:connection-host:rename/u);
	assert.match(preload, /desktop:connection-host:forget/u);
	assert.match(preload, /desktop:connection-host:revoke/u);
	assert.match(main, /Local profile is immutable/u);
	assert.match(preload, /desktop:connection-host:select/u);
	assert.match(preload, /DESKTOP_CONNECTION_HOST_BRIDGE_VERSION = 1/u);
	assert.match(main, /ipcMain\.handle\(\s*'desktop:connection-host:open'/u);
	assert.match(main, /ipcMain\.handle\('desktop:connection-host:list'/u);
	assert.match(main, /ipcMain\.handle\(\s*'desktop:connection-host:select'/u);
	assert.match(main, /activeRemoteByteConnectionsByWebContents/u);
	assert.match(main, /pendingRemoteConnectionWindowsByProfile/u);
	assert.match(main, /getRemoteConnectionWindow\(request\.profileId\)/u);
	assert.match(
		main,
		/createWindow\(\{ initialServerConnection: 'deferred' \}\)/u,
	);
	assert.match(main, /targetWindow\.webContents/u);
	assert.match(main, /request\.version !== 1/u);
	assert.match(
		main,
		/Object\.keys\(request\)\.length !== 2 &&\s+Object\.keys\(request\)\.length !== 3/u,
	);
	assert.match(
		main,
		/return connectRemoteServer\(\s*event,\s*request\.url,\s*request\.pairingPin as string \| undefined,\s*\)/u,
	);
	assert.match(main, /normalizeRemoteConnectionUrl/);
	// A standalone protocol URL may also carry a fragment credential; the framed stream
	// transport, not fragment shape, is authoritative for this flow.
	assert.doesNotMatch(main, /isRemoteAccessPairingUrl\(pairingUrl\)/u);
	assert.match(main, /establishDesktopDevicePairing/u);
	assert.match(main, /enrollDesktopReconnectCredential/u);
	assert.match(main, /DesktopDeviceCredentialStore/u);
	assert.match(main, /async function connectRemoteServer/);
	assert.match(main, /createRemoteStreamTransport\(\s*pairingUrl/u);
	assert.match(main, /sender\.postMessage\(\s*'server:connection'/u);
	assert.match(
		main,
		/connectRemoteByteTransport\(\s*event\.sender,\s*remoteTransport,\s*new URL\(bootstrap\.origin\)\.host,\s*bootstrap\.origin,\s*profile,\s*\)/u,
	);
	assert.match(main, /\{\s*serverId:\s*scopeId,\s*label\s*\}/u);
	assert.match(preload, /readonly label\?: string/u);
	assert.match(preload, /message\.label/u);
	assert.match(app, /terminalClientContext\?\.connectionLabel/u);
	assert.match(main, /envelope\.type === 'server_hello'/);
	assert.match(main, /void Promise\.race\(\[\s*handshake/u);
	assert.match(main, /deadlock the Connect\n\s*\/\/ modal/u);
	assert.doesNotMatch(main, /remoteWindow\.loadURL/);
	assert.match(transport, /pairingToken/);
	assert.match(transport, /endpoint\.search = ''/);
	assert.match(transport, /endpoint\.hash = ''/);
	assert.doesNotMatch(preload, /openRemoteConnection:/u);
	assert.doesNotMatch(main, /app:open-remote-connection/u);
});

test('managing an unrelated remote profile does not replace the Local protocol connection', () => {
	const forgetHandler = main.slice(
		main.indexOf("'desktop:connection-host:forget'"),
		main.indexOf("'desktop:connection-host:revoke'"),
	);
	const revokeHandler = main.slice(
		main.indexOf("'desktop:connection-host:revoke'"),
		main.indexOf('/**\n * Native file reveal'),
	);

	assert.match(forgetHandler, /closeRemoteConnectionsForProfile/u);
	assert.match(revokeHandler, /closeRemoteConnectionsForProfile/u);
	assert.doesNotMatch(forgetHandler, /postLocalServerConnection/u);
	assert.doesNotMatch(revokeHandler, /postLocalServerConnection/u);
});

test('Desktop protocol-created terminals use the current configured shell resolver', () => {
	assert.match(
		main,
		/resolveDefaultShell:\s*\(\)\s*=>\s*resolvePtyShellOptions\(readTerminalSettings\(\)\)/u,
	);
	assert.match(
		main,
		/function resolvePtyShellOptions\(settings: TerminalSettings\)/u,
	);
});
