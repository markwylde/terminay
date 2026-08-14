import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const deletedRendererGraph = [
	'electron/preload.ts',
	'index.html',
	'src/main.tsx',
	'src/rendererApp.tsx',
	'src/rendererRuntime.tsx',
];

test('superseded renderer bootstrap and broad preload stay physically absent', async () => {
	for (const file of deletedRendererGraph) {
		await assert.rejects(
			access(file),
			(error) => error?.code === 'ENOENT',
			`${file} must not return as a diagnostics compatibility path`,
		);
	}
});

test('canonical workspace remains outside privileged diagnostics and Electron APIs', async () => {
	const [workspace, preload] = await Promise.all([
		readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
		readFile('electron/serverUiPreload.ts', 'utf8'),
	]);
	assert.doesNotMatch(
		workspace,
		/from ['"](?:electron|node:|fs|path)['"]|ipcRenderer|terminayDiagnosticsHost/u,
	);
	assert.match(preload, /parseTerminayHostContext/u);
	assert.match(preload, /parseTerminayHostActionRequest/u);
	assert.match(preload, /parseTerminayHostBytePacket/u);
	assert.deepEqual(
		[...preload.matchAll(/exposeInMainWorld\('([^']+)'/gu)].map(
			(match) => match[1],
		),
		['terminayHost', 'terminayBytes'],
	);
});
