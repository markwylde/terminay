import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');

function body(name) {
	const start = main.indexOf(`function ${name}`);
	assert.notEqual(start, -1, `${name} must exist`);
	const next = main.indexOf('\nfunction ', start + 1);
	return main.slice(start, next === -1 ? main.length : next);
}

test('native menu actions use the canonical closed host event', () => {
	const source = body('sendCommandToFocusedWindow');
	assert.match(source, /'server-ui-host:event'/u);
	assert.match(source, /type:\s*'menu\.command'/u);
	assert.doesNotMatch(source, /'app:command'/u);
});

test('native keyboard shortcuts use the canonical closed host event', () => {
	const source = body('bindAppShortcuts');
	assert.match(source, /'server-ui-host:event'/u);
	assert.match(source, /type:\s*'menu\.command'/u);
	assert.doesNotMatch(source, /'app:command'/u);
});
