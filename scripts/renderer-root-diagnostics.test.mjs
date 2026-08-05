import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rendererAppSource = await readFile(
	new URL('../src/rendererApp.tsx', import.meta.url),
	'utf8',
);
const rendererTypesSource = await readFile(
	new URL('../src/types/desktopDiagnostics.ts', import.meta.url),
	'utf8',
);
const rendererGlobalsSource = await readFile(
	new URL('../src/vite-env.d.ts', import.meta.url),
	'utf8',
);

test('shared React root reports a bounded semantic failure and keeps recovery UI', () => {
	assert.match(rendererAppSource, /class RootErrorBoundary extends Component/);
	assert.match(
		rendererAppSource,
		/reportRootFailure\('react-root', error, info\.componentStack \?\? undefined\)/,
	);
	assert.match(
		rendererAppSource,
		/message="Terminay encountered an application error\."/,
	);
	assert.match(
		rendererAppSource,
		/<RootErrorBoundary>[\s\S]*<RuntimeBoundary \/>[\s\S]*<\/RootErrorBoundary>/,
	);
	assert.match(rendererAppSource, /function truncateUtf8\(/);
	assert.match(rendererAppSource, /componentStack: 3_072/);
	assert.match(rendererAppSource, /message: 2_048/);
	assert.match(rendererAppSource, /name: 128/);
	assert.match(rendererAppSource, /stack: 6_144/);
});

test('root reports are versioned, phase-limited, deduplicated, and observation-only', () => {
	assert.match(
		rendererTypesSource,
		/'bootstrap-import' \| 'react-root'/,
	);
	assert.match(rendererTypesSource, /readonly version: 1/);
	assert.match(rendererAppSource, /reportedRootFailures\.has\(deduplicationKey\)/);
	assert.match(rendererAppSource, /MAX_DEDUPLICATION_ENTRIES = 64/);
	assert.match(
		rendererAppSource,
		/window\.terminayDiagnosticsHost\?\.reportRootError\(payload\)/,
	);
	assert.match(rendererGlobalsSource, /terminayDiagnosticsHost\?:/);
	assert.doesNotMatch(
		rendererAppSource,
		/from ['"](?:electron|node:|fs|path)['"]|ipcRenderer|writeFile|appendFile/,
	);
});

test('runtime import failures use the same bounded root diagnostic path', () => {
	assert.match(rendererAppSource, /\.catch\(\(error: unknown\) =>/);
	assert.match(
		rendererAppSource,
		/reportRootFailure\('bootstrap-import', error\)/,
	);
	assert.match(
		rendererAppSource,
		/message="Terminay application modules could not be loaded\."/,
	);
});
