import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

// These are stable, narrow host/disconnected-mode boundaries, not temporary
// migration adapters. Each edge has an active owner and is unavailable to the
// normal connected web path.
const STABLE_HOST_BOUNDARY_EDGES = new Set([
	'src/App.tsx -> ./services/ai/legacyAiTabMetadataClient',
	'src/App.tsx -> ./services/recordings/legacyRecordingsClient',
	'src/components/RecordingsWindow.tsx -> ../services/recordings/legacyRecordingsClient',
	'src/components/SettingsWindow.tsx -> ../services/ai/legacyAiTabMetadataClient',
	'src/hooks/useMacroSettings.ts -> ../services/macros/legacyMacroSettingsCapability',
	'src/rendererRuntime.tsx -> ./services/macros/legacyMacroSettingsCapability.ts',
	'src/rendererRuntime.tsx -> ./services/fileViewer/disconnectedFilePanelCompatibility.ts',
	'src/rendererRuntime.tsx -> ./services/fileViewer/disconnectedFolderCompatibility.ts',
	'src/rendererRuntime.tsx -> ./services/settings/legacySettingsClient.ts',
	'src/rendererRuntime.tsx -> ./shared/legacyServerConnectionLifecycleCapability.ts',
	'src/rendererRuntime.tsx -> ./shared/legacyServerFrameCapability.ts',
	'src/services/fileViewer/DisconnectedFileCompatibilityProvider.tsx -> ./disconnectedFilePanelCompatibility',
	'src/services/fileViewer/DisconnectedFileCompatibilityProvider.tsx -> ./disconnectedFolderCompatibility',
	'src/services/fileViewer/terminayFileGateway.ts -> ./legacyFileViewerTransport',
	'src/services/settings/legacySettingsClient.ts -> ./legacySettingsCapability',
	'src/shared/rendererServerClient.ts -> ./legacyServerFrameCapability',
	'src/web/browserRendererHostAdapters.ts -> ../services/macros/legacyMacroSettingsCapability',
]);

const COMPATIBILITY_SPECIFIER =
	/(?:^|\/)(?:legacy[^/]*|disconnected[^/]*|rendererCompatibility)(?:\.[cm]?[jt]sx?)?$/u;
const IMPORT_SPECIFIER = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/gu;

test('Task 19 keeps every hidden compatibility import on an explicit directed edge', async () => {
	const files = await collectSourceFiles('src');
	const observed = new Set();
	for (const file of files) {
		const source = await readFile(file, 'utf8');
		for (const match of source.matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1];
			if (!COMPATIBILITY_SPECIFIER.test(specifier)) continue;
			observed.add(`${file} -> ${specifier}`);
		}
	}
	assert.deepEqual(
		[...observed].sort(),
		[...STABLE_HOST_BOUNDARY_EDGES].sort(),
		'host-boundary import graph changed; remove the edge or classify its stable bounded owner',
	);
});

test('Task 19 production browser enrollment has no terminal-only protocol authority', async () => {
	const [entry, manager] = await Promise.all([
		readFile('src/remote/main.tsx', 'utf8'),
		readFile('src/web/main.tsx', 'utf8'),
	]);
	for (const source of [entry, manager]) {
		assert.doesNotMatch(source, /legacyRemote|session-list|session-opened|attach-session|RemoteSocket/u);
	}
});

test('Task 19 normal web entries do not import Desktop compatibility modules', async () => {
	for (const file of ['src/web/main.tsx', 'apps/terminay-web/src/index.ts']) {
		const source = await readFile(file, 'utf8');
		const imports = [...source.matchAll(IMPORT_SPECIFIER)].map(
			(match) => match[1],
		);
		assert.deepEqual(
			imports.filter(
				(specifier) =>
					COMPATIBILITY_SPECIFIER.test(specifier) ||
					specifier.includes('remote/services'),
			),
			[],
		);
	}
});

test('Task 19 Desktop bootstrap loads the application runtime directly', async () => {
	const [main, rendererApp, rendererRuntime] = await Promise.all([
		readFile('src/main.tsx', 'utf8'),
		readFile('src/rendererApp.tsx', 'utf8'),
		readFile('src/rendererRuntime.tsx', 'utf8'),
	]);

	assert.deepEqual(
		[...main.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]),
		['./rendererApp.tsx'],
		'the production entry must load only the renderer bootstrap boundary',
	);

	const runtimeImport = "import('./rendererRuntime.tsx')";
	assert.equal(countOccurrences(rendererApp, runtimeImport), 1);
	assert.doesNotMatch(rendererApp, /rendererCompatibility|configureRendererCompatibility/u);
	assert.doesNotMatch(rendererRuntime, /rendererCompatibility/u);
});

async function collectSourceFiles(directory) {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const candidate = path.posix.join(directory, entry.name);
		if (entry.isDirectory())
			result.push(...(await collectSourceFiles(candidate)));
		else if (
			/\.[cm]?[jt]sx?$/u.test(entry.name) &&
			!/\.test\.[cm]?[jt]sx?$/u.test(entry.name) &&
			!/\.d\.[cm]?[jt]s$/u.test(entry.name)
		)
			result.push(candidate);
	}
	return result;
}

function countOccurrences(source, value) {
	return source.split(value).length - 1;
}
