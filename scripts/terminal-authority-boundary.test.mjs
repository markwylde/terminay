import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const featureFiles = [
	'src/App.tsx',
	'src/components/TerminalPanel.tsx',
	'src/components/SettingsWindow.tsx',
	'src/components/folder-viewer/FolderPanel.tsx',
	'src/components/file-viewer/FilePanel.tsx',
];

const [
	featureSources,
	terminalPanel,
	inputQueue,
	remoteEntry,
] = await Promise.all([
	Promise.all(
		featureFiles.map(async (path) => [path, await readFile(path, 'utf8')]),
	),
	readFile('src/components/TerminalPanel.tsx', 'utf8'),
	readFile('src/components/terminalPanelInputQueue.ts', 'utf8'),
	readFile('src/remote/main.tsx', 'utf8'),
]);

test('production feature renderers retain no broad preload authority', () => {
	for (const [path, source] of featureSources) {
		assert.doesNotMatch(source, /window\.terminay(?:\s*\n\s*)?\./u, path);
	}
});

test('App-originated terminal commands reach the exact shared-client attachment queue', () => {
	assert.match(
		terminalPanel,
		/new TerminayTerminalPanelClient\(terminalClientContext\.client\)/u,
	);
	assert.match(terminalPanel, /detail\?\.sessionId !== sessionId/u);
	assert.match(terminalPanel, /writePanelInput\(detail\.data\)/u);
	assert.match(terminalPanel, /serverInputQueue\?\.enqueue\(data\)/u);
	assert.match(inputQueue, /await attachment\.write\(item\.data\)/u);
	assert.match(terminalPanel, /void panelAttachment\.resize\(next\)/u);
	assert.doesNotMatch(
		terminalPanel,
		/(?:writeTerminal|resizeTerminal|killTerminal|getTerminalBuffer)/u,
	);
});

test('remote entry reuses the shared browser workspace through the opaque session endpoint', () => {
	assert.match(remoteEntry, /mountWebManagerApp/u);
	assert.doesNotMatch(remoteEntry, /new WebSocket|\.send\(/u);
	assert.match(remoteEntry, /acquireHostedApplicationTransport\(authenticated\.ticket\)/u);
	assert.doesNotMatch(remoteEntry, /RTCDataChannel|getChannel/u);
});
