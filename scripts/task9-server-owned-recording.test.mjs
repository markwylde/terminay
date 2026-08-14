import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const authority = await readFile(
	new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
	'utf8',
);

test('authority session snapshots retain immutable launch metadata for server integrations', () => {
	assert.match(authority, /readonly shellPath: string \| null/u);
	assert.match(
		authority,
		/readonly recordings\?: ServerCoreCompositionOptions\['recordings'\]/u,
	);
});

test('recordings are server-owned and have no renderer feature IPC bridge', () => {
	assert.match(
		main,
		/const serverRecordingAdapter = new ServerRecordingAdapter/u,
	);
	assert.match(main, /recordings: serverRecordingAdapter/u);
	assert.doesNotMatch(main, /desktop:recording-service-host:/u);
	assert.doesNotMatch(main, /readRecordingServiceRequest/u);
});
