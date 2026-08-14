import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const standalone = await readFile(new URL('../apps/terminay-server/src/cli.ts', import.meta.url), 'utf8');
const embedded = await readFile(new URL('../electron/serverTerminalAuthority.ts', import.meta.url), 'utf8');
const desktop = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../src/workspace/useDictationController.ts', import.meta.url), 'utf8');

test('standalone composition owns runtime, provider, status/install, and cleanup', () => {
	assert.match(standalone, /new ParakeetRuntime\(/u);
	assert.match(standalone, /new ServerParakeetDictationProvider\(/u);
	assert.match(standalone, /dictationProvider: parakeetProvider/u);
	assert.match(standalone, /dictationRuntime: parakeetProvider/u);
	assert.match(standalone, /parakeetProvider\.stop\(\)/u);
});

test('embedded composition receives the server runtime and exposes only framed operations', () => {
	assert.match(desktop, /parakeetRuntime,/u);
	assert.match(embedded, /dictationProvider: parakeetProvider/u);
	assert.match(embedded, /dictationRuntime: parakeetProvider/u);
	assert.match(embedded, /AI_SERVER_OPERATIONS\.runtimeStatus/u);
	assert.match(embedded, /AI_SERVER_OPERATIONS\.installRuntime/u);
	assert.doesNotMatch(renderer, /ParakeetRuntime|ServerParakeetDictationProvider/u);
});
