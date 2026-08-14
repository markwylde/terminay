import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../e2e/terminal-active-presentation.spec.ts', import.meta.url),
	'utf8',
);

test('active terminal shell proof uses the visible canonical xterm input', () => {
	assert.match(source, /activeTerminal\.getByRole\('textbox'/u);
	assert.match(source, /terminalInput\.pressSequentially\('shopt login_shell'\)/u);
	assert.match(source, /terminalInput\.press\('Enter'\)/u);
	assert.doesNotMatch(source, /keyboard\.(?:insertText|type)/u);
	assert.doesNotMatch(source, /terminayTest|writeServerTerminal/u);
});
