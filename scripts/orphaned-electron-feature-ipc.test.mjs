import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const preload = await readFile(
	new URL('../electron/serverUiPreload.ts', import.meta.url),
	'utf8',
);

const removedChannels = [
	'desktop:file-explorer-host:get-home-path',
	'desktop:recording-service-host:',
	'desktop:terminal-lifecycle-host:',
	'desktop:terminal-presentation-host:',
	'fs:calculate-folder-size',
	'fs:cancel-folder-size',
	'fs:delete',
	'fs:list-directory',
	'fs:mkdir',
	'fs:rename',
	'fs:search-files',
	'fs:unwatch-directory',
	'fs:watch-directory',
	'macros:get',
	'macros:reset',
	'macros:update',
	'settings:get-terminal',
	'settings:reset-terminal',
	'settings:update-terminal',
];

test('canonical Desktop has zero renderer feature IPC registrations', () => {
	for (const channel of removedChannels) {
		assert.doesNotMatch(
			main,
			new RegExp(channel),
			`${channel} is absent from Electron main`,
		);
		assert.doesNotMatch(
			preload,
			new RegExp(channel),
			`${channel} is absent from canonical preload`,
		);
	}
});

test('dead feature host helpers are deleted with their channels', () => {
	for (const helper of [
		'FileExplorerWatchService',
		'broadcastMacros',
		'broadcastTerminalSettings',
		'broadcastTerminalRecordingState',
		'readDirectoryEntries',
		'readRecordingServiceRequest',
		'readTerminalRecordingStartMetadata',
		'resolveTerminalProcessCwd',
		'runFolderSizeJob',
		'searchFiles',
		'writeMacros',
	]) {
		assert.doesNotMatch(
			main,
			new RegExp(`\\b${helper}\\b`),
			`${helper} is deleted`,
		);
	}
});

test('canonical server authority remains the renderer operation boundary', () => {
	assert.match(main, /bindServerUiWindow/u);
	assert.match(main, /serverTerminalAuthority/u);
	assert.match(main, /recordings: serverRecordingAdapter/u);
	assert.match(preload, /contextBridge\.exposeInMainWorld\('terminayHost'/u);
});
