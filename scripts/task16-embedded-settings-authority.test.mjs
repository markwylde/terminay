import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [main, authority, renderer] = await Promise.all([
	readFile('electron/main.ts', 'utf8'),
	readFile('electron/serverTerminalAuthority.ts', 'utf8'),
	readFile('src/rendererRuntime.tsx', 'utf8'),
]);

test('embedded settings use a durable atomic server repository', () => {
	assert.match(main, /new ServerSettingsRepository\(\{/u);
	assert.match(main, /server-settings\.v1\.json/u);
	assert.match(main, /writeFile\(temporary[\s\S]*flag: 'wx'[\s\S]*rename\(temporary, embeddedServerSettingsPath\)/u);
	assert.match(main, /settings: embeddedServerSettings/u);
	assert.match(
		main,
		/function attachAuxiliaryServerConnection\(window: BrowserWindow\)[\s\S]*window\.webContents\.postMessage\(\s*'server:connection'/u,
	);
	assert.match(main, /attachAuxiliaryServerConnection\(createdSettingsWindow\)/u);
	assert.match(authority, /\{ settings: options\.settings \}/u);
});

test('Desktop injects the authenticated server client into the complete Settings editor', () => {
	assert.match(renderer, /createServerTerminalSettingsClient/u);
	assert.match(renderer, /<ServerSettingsRoute[\s\S]*settingsClient=\{serverSettingsClient\}/u);
	assert.doesNotMatch(renderer, /<SettingsWindow\b/u);
});
