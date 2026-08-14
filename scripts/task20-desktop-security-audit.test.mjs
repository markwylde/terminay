import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical server UI host binds validated context and sender provenance', async () => {
	const host = await read('electron/serverUiHost.ts');
	assert.match(host, /parseTerminayHostContext\(options\.context\)/u);
	assert.match(host, /bindingForEvent\(event\)\.context/u);
	assert.match(host, /senderFrame !== event\.sender\.mainFrame/u);
	assert.match(host, /senderOrigin !== binding\.expectedOrigin/u);
	assert.match(host, /parseTerminayHostActionRequest\(value, binding\.context\)/u);
	assert.match(host, /requiredTerminayHostCapability\(action\.action\)/u);
	assert.match(host, /Host capability is unavailable/u);
	assert.doesNotMatch(host, /DesktopHostBridgeRouter|validateDesktopHostAction/u);
});

test('canonical server UI windows are isolated and deny ambient browser authority', async () => {
	const host = await read('electron/serverUiHost.ts');
	for (const policy of [
		/allowRunningInsecureContent:\s*false/u,
		/contextIsolation:\s*true/u,
		/nodeIntegration:\s*false/u,
		/sandbox:\s*true/u,
		/webSecurity:\s*true/u,
		/webviewTag:\s*false/u,
		/setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/u,
		/will-attach-webview/u,
		/setPermissionCheckHandler\(\(\) => false\)/u,
		/callback\(false\)/u,
	]) assert.match(host, policy);
	assert.match(host, /denyDownloadForWindow/u);
	assert.match(host, /item\.cancel\(\)/u);
	assert.match(host, /targetSession\.off\('will-download', denyDownload\)/u);
});

test('navigation is confined to the verified origin or extracted bundle root', async () => {
	const host = await read('electron/serverUiHost.ts');
	assert.match(host, /url\.origin === expectedOrigin/u);
	assert.match(host, /path\.relative\(allowedFileRoot, candidate\)/u);
	assert.match(host, /!path\.isAbsolute\(relative\)/u);
	for (const event of ['will-frame-navigate', 'will-navigate', 'will-redirect']) {
		assert.match(host, new RegExp(`${event}[\\s\\S]{0,500}isAllowedNavigation`, 'u'));
	}
});

test('selected server sessions use opaque host-generated partitions', async () => {
	const host = await read('electron/serverUiHost.ts');
	assert.match(host, /randomBytes\(24\)\.toString\('base64url'\)/u);
	assert.match(host, /OPAQUE_PARTITION_KEY_PATTERN/u);
	assert.match(host, /createHash\('sha256'\)/u);
	assert.match(host, /persist:terminay-server-/u);
	assert.doesNotMatch(host, /profileId.*partition|serverId.*partition/u);
});

test('host protocol is exact, versioned, bounded, and rejects unknown fields', async () => {
	const protocol = await read('packages/protocol/src/host.ts');
	assert.match(protocol, /export interface TerminayHostContext/u);
	assert.match(protocol, /schemaVersion/u);
	assert.match(protocol, /bootstrapVersion/u);
	assert.match(protocol, /bundleId/u);
	assert.match(protocol, /hostBridgeVersion/u);
	assert.match(protocol, /byteEndpointVersion/u);
	assert.match(protocol, /function exactKeys\(/u);
	assert.match(protocol, /function exactOptionalKeys\(/u);
	assert.match(protocol, /parseTerminayHostActionRequest/u);
	assert.match(protocol, /requiredTerminayHostCapability/u);
});

test('narrow preload exposes only context, semantic actions, events, and bytes', async () => {
	const preload = await read('electron/serverUiPreload.ts');
	assert.match(preload, /contextBridge\.exposeInMainWorld\('terminayHost'/u);
	assert.match(preload, /getContext:/u);
	assert.match(preload, /requestAction:/u);
	assert.match(preload, /subscribeEvent:/u);
	assert.match(preload, /contextBridge\.exposeInMainWorld\('terminayBytes'/u);
	assert.doesNotMatch(preload, /ipcRenderer:\s*ipcRenderer|send:\s*ipcRenderer\.send/u);
	assert.doesNotMatch(preload, /dialog|shell\.openExternal|readFile|writeFile/u);
});

test('native dialogs remain limited to reviewed close, picker, and diagnostics surfaces', async () => {
	const [main, diagnostics] = await Promise.all([
		read('electron/main.ts'),
		read('electron/diagnostics/menu.ts'),
	]);
	const calls = [...main.matchAll(/dialog\.(show[A-Za-z]+)\(/gu)].map((match) => match[1]);
	assert.ok(calls.length > 0);
	assert.ok(calls.every((name) => name === 'showMessageBox' || name === 'showOpenDialog'));
	assert.match(main, /showOpenDialog\(window, \{ properties: action\.multiple/u);
	assert.match(main, /showMessageBox/u);
	assert.match(diagnostics, /dialog\.showMessageBox\(/u);
	assert.doesNotMatch(main, /desktop:project-edit-host:open/u);
});

test('reviewed native host actions are semantic and capability-gated', async () => {
	const main = await read('electron/main.ts');
	for (const action of [
		'clipboard.write',
		'file.choose',
		'notification.show',
		'updater.check',
		'os.open-external',
		'route.close',
		'route.focus',
		'menu.invoke',
	]) assert.match(main, new RegExp(`case '${action.replace('.', '\\.')}':`, 'u'));
	assert.match(main, /openInBrowser\(action\.url\)/u);
	assert.match(main, /normalizeExternalHttpsUrl/u);
	assert.doesNotMatch(main, /external\.open|DesktopHostBridgeRouter/u);
});

test('binding lifecycle enumerates failures and releases active authority', async () => {
	const [host, lifecycle] = await Promise.all([
		read('electron/serverUiHost.ts'),
		read('apps/terminay-desktop/src/main/documentLifecycle.ts'),
	]);
	for (const reason of [
		'failed-launch',
		'reload',
		'server-switch',
		'superseded',
		'window-close',
		'application-quit',
	]) assert.match(lifecycle, new RegExp(`'${reason}'`, 'u'));
	assert.match(host, /releaseServerUiWindowBinding\(webContentsId, 'server-switch'\)/u);
	assert.match(host, /lifecycle\.release\('window-close'\)/u);
	assert.match(host, /DesktopDocumentLifecycle/u);
	assert.match(host, /bindings\.delete\(webContentsId\)/u);
	assert.match(host, /targetSession\.off/u);
});


