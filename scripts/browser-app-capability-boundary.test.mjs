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
		/<ConnectedWebRendererWorkspace[\s\S]*connectionRoute=\{connectionRoute[\s\S]*onBack=\{onBack\}[\s\S]*terminalClientContext=\{connection\.context\}/u,
	);
	assert.doesNotMatch(webEntry, /<ConnectedWebRendererWorkspace[\s\S]*client=/u);
	assert.match(
		webWorkspace,
		/<ConnectedRendererWorkspace[\s\S]*host=\{Object\.freeze\(\{[\s\S]*terminalClientContext=\{terminalClientContext\}/u,
	);
	assert.match(
		webWorkspace,
		/const applicationClient = terminalClientContext\.applicationClient[\s\S]*applicationClient === undefined[\s\S]*requires its canonical application client/u,
	);
	assert.match(
		webWorkspace,
		/createBrowserMacroSettingsCapability\(applicationClient\)/u,
	);
	assert.match(
		sharedWorkspace,
		/<App[\s\S]*quickPushClient=\{host\.quickPushClient\}[\s\S]*terminalClientContext=\{terminalClientContext\}/u,
	);
	assert.match(
		remoteEntry,
		/bridge\.getChannel!\(name, authenticated\.ticket\)/u,
	);
	assert.doesNotMatch(remoteEntry, /ticket\s*:\s*['"`]|getChannel!\(name\)/u);
});

test('browser composition omits native host authority instead of fabricating preload globals', () => {
	for (const [path, source] of [
		['src/web/main.tsx', webEntry],
		['src/web/ConnectedWebRendererWorkspace.tsx', webWorkspace],
		['src/web/browserRendererHostAdapters.ts', browserAdapters],
	]) {
		assert.doesNotMatch(source, /window\.terminay(?:[A-Z]\w*)?\s*=/u, path);
		assert.doesNotMatch(source, /Object\.defineProperty\(\s*window\s*,\s*['"]terminay/u, path);
	}
	assert.match(
		webWorkspace,
		/host=\{Object\.freeze\(\{\s*auxiliaryRoutes,\s*onDisconnect: onBack,\s*onOpenConnectionManager: \(\) =>\s*setIsConnectionManagerOpen\(true\),?\s*\}\)\}/u,
	);
	assert.doesNotMatch(
		webWorkspace,
		/quickPushClient|nativeWindows|clipboard|osIntegration/u,
	);
});

test('browser-only adapters fail closed for unavailable secret operations', () => {
	for (const operation of [
		'getDecryptedSecret',
		'saveSecret',
		'deleteSecret',
	]) {
		assert.match(
			browserAdapters,
			new RegExp(
				`async ${operation}\\(\\) \\{[\\s\\S]*?throw new Error\\('Browser secret storage is unavailable'\\)`,
				'u',
			),
		);
	}
	assert.doesNotMatch(browserAdapters, /window\.terminay|electron|ipcRenderer/u);
});
