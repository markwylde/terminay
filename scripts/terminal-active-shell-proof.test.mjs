import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../e2e/terminal-active-presentation.spec.ts', import.meta.url),
	'utf8',
);

test('configured-shell proof waits for the new canonical session and prompt', () => {
	assert.match(source, /previousSessionId/u);
	assert.match(source, /\.not\.toBe\(previousSessionId\)/u);
	assert.match(source, /toContainText\(\/\[\$#\]/u);
	assert.match(source, /keyboard\.insertText\('printenv BASH_VERSION'\)/u);
	assert.doesNotMatch(source, /terminayTest|writeServerTerminal|keyboard\.type/u);
});
