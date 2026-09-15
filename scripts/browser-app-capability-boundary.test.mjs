import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
	webEntry,
	webWorkspace,
	sharedWorkspace,
	browserAdapters,
	remoteEntry,
] = await Promise.all([
	readFile('src/web/main.tsx', 'utf8'),
	readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	readFile('src/shared/ConnectedRendererWorkspace.tsx', 'utf8'),
	readFile('src/web/browserRendererHostAdapters.ts', 'utf8'),
	readFile('src/remote/main.tsx', 'utf8'),
]);

test('browser mounts the real App with the exact authenticated client context', () => {
	assert.match(
		webEntry,
		/<ConnectedWebRendererWorkspace[\s\S]*connectionRoute=\{connectionRoute[\s\S]*hostContext=\{desktopContext\}[\s\S]*terminalClientContext=\{terminalClientContext\}/u,
	);
	assert.doesNotMatch(webEntry, /<ConnectedWebRendererWorkspace[\s\S]*client=/u);
	assert.match(
		webWorkspace,
		/<ConnectedRendererWorkspace[\s\S]*host=\{Object\.freeze\(\{[\s\S]*terminalClientContext=\{terminalClientContext\}/u,
	);
	assert.match(
		webWorkspace,
		// Per-server surfaces take the client of the connection they are showing,
		// falling back to the workspace's own; either way it is a real
		// authenticated client, never a fabricated one.
		/const applicationClient =\s*selectedServer\.connection\?\.context\?\.applicationClient \?\?\s*terminalClientContext\.applicationClient[\s\S]*applicationClient === undefined[\s\S]*requires its canonical application client/u,
	);
	assert.match(
		webWorkspace,
		/createBrowserMacroSettingsClient\(applicationClient\)/u,
	);
	assert.match(
		sharedWorkspace,
		/<App[\s\S]*terminalClientContext=\{terminalClientContext\}/u,
	);
	assert.doesNotMatch(sharedWorkspace, /quickPushClient/u);
	assert.match(remoteEntry, /mountSessionWorkspace\(root\)/u);
	assert.doesNotMatch(remoteEntry, /authenticateDevice|loadBrowserDeviceIdentity|ticket\s*:\s*['"`]|getChannel|RTCDataChannel/u);
});

test('browser composition omits native host authority instead of fabricating preload globals', () => {
	for (const [path, source] of [
		['src/web/ConnectedWebRendererWorkspace.tsx', webWorkspace],
		['src/web/browserRendererHostAdapters.ts', browserAdapters],
	]) {
		assert.doesNotMatch(source, /window\.terminay(?:[A-Z]\w*)?\s*=/u, path);
		assert.doesNotMatch(source, /Object\.defineProperty\(\s*window\s*,\s*['"]terminay/u, path);
	}
	assert.match(
		webWorkspace,
		/host=\{Object\.freeze\(\{[\s\S]*auxiliaryRoutes,[\s\S]*onDisconnect: onBack,[\s\S]*onOpenConnectionManager: \(\) =>[\s\S]*auxiliaryRoutes\.openRemoteControl\(\),?[\s\S]*\}\)\}/u,
	);
});

test('browser-only adapters fail closed for unavailable secret operations', () => {
	for (const operation of [
		'getDecryptedSecret',
		'saveSecret',
		'deleteSecret',
	]) {
		assert.match(browserAdapters, new RegExp(
			`async ${operation}\\(\\) \\{[\\s\\S]*?throw new MacroSettingsUnavailableError\\(`,
			'u',
		));
	}
	assert.doesNotMatch(browserAdapters, /window\.terminay|electron|ipcRenderer/u);
});

test('the compact application menu crosses the host boundary as a capability', async () => {
	const sharedApp = await readFile('src/App.tsx', 'utf8');

	// The host supplies the control; the shared workspace only draws whatever it
	// is handed, so no browser-only command reaches the tree every host renders.
	assert.match(
		sharedWorkspace,
		/renderCompactApplicationMenu\?: \(\) => ReactNode;/u,
	);
	assert.match(
		webWorkspace,
		/renderCompactApplicationMenu: \(\) => \([\s\S]*?variant="compact"/u,
	);
	// A host with native menus supplies nothing at all.
	assert.match(webWorkspace, /\.\.\.\(hasNativeMenus\s*\?\s*\{\}/u);

	assert.match(
		sharedApp,
		/applicationMenu=\{hostPresentation\?\.renderCompactApplicationMenu\?\.\(\)\}/u,
	);
	// The browser's own menu vocabulary stays in the browser composition.
	for (const command of ['Disconnect', 'Remote Control', 'Recordings']) {
		assert.ok(
			webWorkspace.includes(command),
			`${command} belongs to the browser composition`,
		);
		assert.ok(
			!sharedApp.includes(`label: '${command}'`),
			`${command} must not move into the shared workspace`,
		);
	}
});

test('the compact menu keeps every wide-menu command and its capability gating', () => {
	// One control, still four named menus built from one definition — there is
	// no second item list that could drift from the menu bar's.
	assert.equal(webWorkspace.match(/const menuItems = useMemo</gu).length, 1);
	assert.match(
		webWorkspace,
		/variant === 'compact'[\s\S]*?menuOrder\.map\(\(menuId\) => \([\s\S]*?menuLabels\[menuId\][\s\S]*?menuItems\[menuId\]\.map/u,
	);
});
