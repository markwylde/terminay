import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('embedded file catalog exposes the mutation capabilities used by the explorer', async () => {
	const source = await readFile('electron/serverTerminalAuthority.ts', 'utf8');

	for (const capability of [
		'atomicWrite',
		'makeDirectory',
		'remove',
		'rename',
	]) {
		assert.match(
			source,
			new RegExp(`\\b${capability}: async \\(`),
			`missing embedded ${capability} capability`,
		);
	}
});
