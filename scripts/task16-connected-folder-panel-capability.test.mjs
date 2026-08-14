import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const folderPanel = await readFile(
	new URL('../src/components/folder-viewer/FolderPanel.tsx', import.meta.url),
	'utf8',
);

test('FolderPanel fails closed until canonical selected-server clients are available', () => {
	assert.match(folderPanel, /terminalClientContext\?\.fileViewerClient === undefined/);
	assert.match(folderPanel, /terminalClientContext\.fileObservationClient === undefined/);
	assert.match(folderPanel, /terminalClientContext\.projectRoot === undefined/);
	assert.match(folderPanel, /FileAuthorityUnavailableState feature="Folder viewer"/);
	assert.doesNotMatch(folderPanel, /DisconnectedFileCompatibility|desktopFileViewerClient|disconnectedFolderCompatibility/);
});

test('FolderPanel operations preserve hydrated project identity', () => {
	assert.match(folderPanel, /const projectId = terminalClientContext\.projectId/);
	assert.match(folderPanel, /const projectRootPath = terminalClientContext\.projectRoot/);
	assert.match(folderPanel, /fileViewerClient\.listFolder/);
	assert.match(folderPanel, /fileObservationClient\.startWatch/);
});
