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
	assert.match(css, /\.app-shell--macos \.project-tabbar\s*\{[^}]*padding-left:\s*86px/s);
});

test('canonical preload exposes only protocol-validated semantic host events', async () => {
	const [preload, protocol, legacyPreload] = await Promise.all([
		read('electron/serverUiPreload.ts'),
		read('packages/protocol/src/host.ts'),
		read('electron/preload.ts'),
	]);

	assert.match(preload, /const bridge: ServerUiHostBridge/);
	assert.match(preload, /subscribeEvent:/);
	assert.match(preload, /ipcRenderer\.on\('app:command', wrapper\)/);
	assert.match(preload, /parseTerminayHostEvent/);
	assert.match(protocol, /type:\s*"menu\.command"/);
	for (const command of [
		'new-terminal',
		'new-project',
		'open-settings',
		'open-macros',
		'open-recordings',
		'open-project-environments',
		'open-extensions',
	]) {
		assert.match(protocol, new RegExp(`"${command}"`));
	}
	assert.doesNotMatch(legacyPreload, /'open-settings'/);
	assert.doesNotMatch(legacyPreload, /'open-macros'/);
});

test('browser menu omits Desktop-only update, window, and DevTools commands', async () => {
	const workspace = await read('src/web/ConnectedWebRendererWorkspace.tsx');
	const browserMenu = workspace.slice(workspace.indexOf('function ConnectedBrowserMenuBar'));

	assert.doesNotMatch(browserMenu, /updater\.check|toggleDevTools|windowMenu/);
	for (const label of ['File', 'Edit', 'View', 'Help']) {
		assert.match(workspace, new RegExp(`'${label}'`));
	}
});
