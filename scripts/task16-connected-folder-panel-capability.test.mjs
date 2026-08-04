import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const folderPanel = await readFile(
	new URL('../src/components/folder-viewer/FolderPanel.tsx', import.meta.url),
	'utf8',
);

test('connected FolderPanel does not require disconnected compatibility', () => {
	assert.doesNotMatch(folderPanel, /useDisconnectedFolderCompatibility\(\)/);
	assert.match(
		folderPanel,
		/const disconnectedFileCompatibility =\s*useOptionalDisconnectedFileCompatibility\(\)/,
	);
	assert.match(
		folderPanel,
		/if \(terminalClientContext\?\.fileViewerClient !== undefined\)\s*return undefined;/,
	);
	assert.match(
		folderPanel,
		/terminalClientContext\?\.fileViewerClient \?\? desktopFileViewerClient/,
	);
});

test('disconnected FolderPanel still fails closed without its provider', () => {
	assert.match(
		folderPanel,
		/return disconnectedFileCompatibility\?\.folderPanel\.createClient\(\)/,
	);
	assert.match(
		folderPanel,
		/throw new Error\('The file viewer client is unavailable\.'\)/,
	);
	assert.doesNotMatch(folderPanel, /requireDisconnectedFolderCompatibility/);
	assert.doesNotMatch(
		folderPanel,
		/Disconnected folder compatibility is unavailable/,
	);
});
