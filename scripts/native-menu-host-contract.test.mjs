import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical workspace selects menu and window chrome from negotiated capabilities', async () => {
	const [workspace, composition, app, css] = await Promise.all([
		read('src/web/ConnectedWebRendererWorkspace.tsx'),
		read('src/shared/ConnectedRendererWorkspace.tsx'),
		read('src/App.tsx'),
		read('src/App.css'),
	]);

	assert.match(workspace, /hostContext\?\.capabilities\.nativeMenus/);
	assert.match(workspace, /hasNativeMenus \? null : \(/);
	assert.match(workspace, /hostContext\?\.capabilities\.nativeWindows/);
	assert.match(composition, /hostPresentation=\{host\.presentation\}/);
	assert.match(app, /hostPresentation\?\.nativeWindowControls/);
	assert.match(
		css,
		/\.app-shell--macos \.project-tabbar\s*\{[^}]*padding-left:\s*86px/s,
	);
});

test('canonical preload exposes only protocol-validated semantic host events', async () => {
	const [preload, protocol] = await Promise.all([
		read('electron/serverUiPreload.ts'),
		read('packages/protocol/src/host.ts'),
	]);

	assert.match(preload, /const bridge: ServerUiHostBridge/);
	assert.match(preload, /subscribeEvent:/);
	assert.match(preload, /const eventListeners = new Set/);
	assert.match(preload, /const latestEvents = new Map/);
	assert.match(
		preload,
		/ipcRenderer\.on\('server-ui-host:event', hostEventWrapper\)/,
	);
	assert.match(preload, /eventListeners\.add\(listener\)/);
	assert.match(preload, /eventListeners\.delete\(listener\)/);
	assert.match(preload, /const isReplayableHostEvent/u);
	assert.match(preload, /event\.event\.type === 'terminal\.zoom'/u);
	assert.match(preload, /event\.event\.type === 'workspace\.drag-state'/u);
	assert.match(preload, /event\.event\.type === 'device\.settings\.changed'/u);
	assert.match(preload, /if \(isReplayableHostEvent\(parsed\)\)/u);
	assert.doesNotMatch(
		preload,
		/latestEvents\.set\(parsed\.event\.type, parsed\);\n\s*for/u,
	);
	assert.match(
		preload,
		/for \(const event of latestEvents\.values\(\)\) deliverEvent\(listener, event\)/,
	);
	assert.match(preload, /parseTerminayHostEvent/);
	assert.match(protocol, /type:\s*'menu\.command'/);
	assert.match(protocol, /type:\s*'terminal\.zoom'/);
	for (const command of [
		'new-terminal',
		'new-project',
		'open-settings',
		'open-macros',
		'open-recordings',
		'open-project-environments',
		'open-extensions',
		'open-remote-control',
	]) {
		assert.match(protocol, new RegExp(`'${command}'`));
	}
});

test('auxiliary routes remain inside the capability-governed workspace shell', async () => {
	const workspace = await read('src/web/ConnectedWebRendererWorkspace.tsx');
	const shellStart = workspace.indexOf(
		'<div className="connected-web-renderer-workspace">',
	);
	const shell = workspace.slice(
		shellStart,
		workspace.indexOf('\n\t);', shellStart),
	);

	assert.ok(shellStart >= 0);
	assert.match(shell, /hasNativeMenus \? null : \(/);
	assert.match(shell, /ConnectedBrowserAuxiliaryDialog/);
	assert.doesNotMatch(shell, /connected-web-connection-backdrop/);
	assert.doesNotMatch(shell, /browser-host-titlebar/);
});

test('browser menu omits Desktop-only update, window, and DevTools commands', async () => {
	const workspace = await read('src/web/ConnectedWebRendererWorkspace.tsx');
	const browserMenu = workspace.slice(
		workspace.indexOf('function ConnectedBrowserMenuBar'),
	);

	assert.doesNotMatch(browserMenu, /updater\.check|toggleDevTools|windowMenu/);
	for (const label of ['File', 'Edit', 'View', 'Help']) {
		assert.match(workspace, new RegExp(`'${label}'`));
	}
});

test('Switch connections is gated on a manager return path, not Desktop host context', async () => {
	const workspace = await read('src/web/ConnectedWebRendererWorkspace.tsx');
	assert.match(workspace, /canLeaveManagerSession/u);
	assert.doesNotMatch(workspace, /onSwitchConnections:\s*onBack/u);
});
