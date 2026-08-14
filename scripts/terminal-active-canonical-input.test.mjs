import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../e2e/terminal-active-presentation.spec.ts', import.meta.url),
	'utf8',
);

test('active terminal shell proof uses the visible canonical xterm input', () => {
	assert.match(source, /terminal\.locator\('\.xterm-helper-textarea'\)\.focus\(\)/u);
	assert.match(source, /keyboard\.insertText/u);
	assert.doesNotMatch(source, /keyboard\.type/u);
	assert.match(source, /keyboard\.press\('Enter'\)/u);
	assert.doesNotMatch(source, /terminayTest|writeServerTerminal/u);
});
