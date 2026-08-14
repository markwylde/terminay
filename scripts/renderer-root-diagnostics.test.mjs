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

test('renderer diagnostics stay local and legacy privileged bridges remain absent', async () => {
	const [main, declarations, diagnostics] = await Promise.all([
		readFile('electron/main.ts', 'utf8'),
		readFile('src/vite-env.d.ts', 'utf8'),
		readFile('src/shared/rendererDiagnostics.ts', 'utf8'),
	]);
	for (const source of [main, declarations]) {
		assert.doesNotMatch(
			source,
			/terminayDiagnosticsHost|terminayBootstrapDiagnostic|desktop:diagnostics-host/u,
		);
	}
	assert.match(diagnostics, /__terminayRendererDiagnostic/u);
	assert.match(diagnostics, /Object\.freeze/u);
	assert.match(diagnostics, /catch \{/u);
});
