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

const [shortcuts, protocol, desktopMain, appShell] = await Promise.all([
	readFile('src/keyboardShortcuts.ts', 'utf8'),
	readFile('packages/protocol/src/host.ts', 'utf8'),
	readFile('electron/main.ts', 'utf8'),
	readFile('src/App.tsx', 'utf8'),
]);

const menuCommandsBlock = () => {
	const start = protocol.indexOf('TERMINAY_HOST_MENU_COMMANDS = [');
	return protocol.slice(start, protocol.indexOf('] as const;', start));
};

test('editing the tab and the project are commands, not gestures alone', () => {
	for (const command of ['edit-active-tab', 'edit-active-project']) {
		// In the protocol's command vocabulary, so every host can send it.
		assert.match(menuCommandsBlock(), new RegExp(`'${command}'`, 'u'));
		// Described, so the Command Bar finds it by more than its id.
		assert.match(
			shortcuts,
			new RegExp(
				`command: '${command}',\\n\\s*title: '[^']+',\\n\\s*description: '[^']+',\\n\\s*keywords: '[^']+',`,
				'u',
			),
		);
		// Rebindable like every other command, and shipped bound to nothing: a
		// default would claim a key the user never offered.
		assert.match(shortcuts, new RegExp(`'${command}': '',`, 'u'));
	}
});

test('every declared command is rebindable and every binding is declared', () => {
	const declared = [...menuCommandsBlock().matchAll(/'([a-z-]+)'/gu)].map(
		(match) => match[1],
	);
	const defaults = [
		...shortcuts
			.slice(shortcuts.indexOf('defaultKeyboardShortcuts'))
			.matchAll(/^\s*'([a-z-]+)':/gmu),
	].map((match) => match[1]);
	assert.deepEqual([...defaults].sort(), [...declared].sort());
});

test('the browser menu carries every Desktop command it has the capability for', () => {
	// The in-page menu is the browser's whole application menu, so a command the
	// native menu offers and the browser can perform must appear in it. Desktop
	// splits these across its Terminal and View menus; the browser has no
	// Terminal menu, so View is where they land.
	const desktopCommands = new Set(
		[
			...desktopMain.matchAll(/sendCommandToFocusedWindow\('([a-z-]+)'\)/gu),
		].map((match) => match[1]),
	);
	const browserCommands = new Set([
		...[...webWorkspace.matchAll(/dispatchCommand\('([a-z-]+)'\)/gu)].map(
			(match) => match[1],
		),
		// The older entries synthesise the command's accelerator instead.
		'new-terminal',
		'new-project',
		'show-dashboard',
		'set-project-root-folder-to-working-directory',
		'toggle-file-explorer-sidebar',
	]);
	// Native-only on the browser, or reachable in the in-page menu by its own
	// route rather than as a command.
	const nativeOnlyOrRouted = new Set([
		'clear-terminal',
		'close-active',
		'open-extensions',
		'open-macros',
		'open-performance-log',
		'open-recordings',
		'open-remote-control',
		'open-settings',
		'popout-active',
		'save-active',
		'split-horizontal',
		'split-vertical',
		'start-dictation',
	]);
	const missing = [...desktopCommands].filter(
		(command) =>
			!browserCommands.has(command) && !nativeOnlyOrRouted.has(command),
	);
	assert.deepEqual(
		missing,
		[],
		`the browser menu is missing: ${missing.join(', ')}`,
	);
});

test('a command with no default binding is named, not keystroke-synthesised', () => {
	// dispatchShortcut fabricates a keydown, which only reaches a command that is
	// bound. An unbound command named that way would silently do nothing.
	for (const command of [
		'open-command-bar',
		'edit-active-tab',
		'edit-active-project',
	]) {
		assert.match(
			webWorkspace,
			new RegExp(`dispatchCommand\\('${command}'\\)`, 'u'),
		);
	}
	assert.match(
		webWorkspace,
		/new CustomEvent\('terminay-app-command', \{ detail: \{ command \} \}\)/u,
	);
	// And the shell answers it through the same dispatch the native menu takes.
	assert.match(
		appShell,
		/addEventListener\('terminay-app-command', onHostCommand\)/u,
	);
	assert.match(appShell, /void executeCommandOnActiveProject\(command\);/u);
});
