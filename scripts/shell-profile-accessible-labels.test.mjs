import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../src/components/ShellProfilesSettings.tsx', import.meta.url),
	'utf8',
);

test('shell target controls have explicit non-concatenated accessible names', () => {
	assert.match(source, /<select aria-label="Target type"/u);
	assert.match(source, /<select aria-label="Startup mode"/u);
	assert.match(source, /<input aria-label="Executable"/u);
});
