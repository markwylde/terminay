import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const authoritySource = await readFile(
	new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
	'utf8',
);

test('terminal presentation and lifecycle are no longer application IPC', () => {
	for (const prefix of [
		'desktop:terminal-presentation-host:',
		'desktop:terminal-lifecycle-host:',
		'terminal:update-remote-metadata',
	]) {
		assert.doesNotMatch(
			source,
			new RegExp(prefix),
			`${prefix} has no Electron application handler`,
		);
	}
});

test('terminal stream/read/write application IPC stays removed after server-client adoption', () => {
	for (const channel of [
		'terminal:get-cwd',
		'terminal:get-buffer',
		'terminal:write',
		'terminal:resize',
		'terminal:kill',
	]) {
		assert.doesNotMatch(
			source,
			new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*'${channel}'`),
			`${channel} has no Electron application handler`,
		);
	}
});

test('terminal presentation metadata is server-owned rather than renderer IPC', () => {
	assert.doesNotMatch(source, /terminal:update-remote-metadata/u);
	assert.doesNotMatch(source, /desktop:terminal-presentation-host/u);
});

test('embedded renderer MessagePort receives explicit management permissions', () => {
	const accept = authoritySource.match(
		/acceptRendererPort\([\s\S]*?\n\t\}\n\n\tasync create/u,
	)?.[0];
	assert.ok(accept, 'renderer port authority exists');
	for (const permission of [
		'environments:read',
		'environments:manage',
		'workspace:write',
		'extensions:read',
		'extensions:manage',
	]) {
		assert.match(accept, new RegExp(`['"]${permission}['"]`), permission);
	}
});
