import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../src/workspace/useProjectCollection.ts', import.meta.url),
	'utf8',
);

test('canonical workspace projection retains a project shell profile on hydration and refresh', () => {
	const occurrences = source.match(
		/defaultShellProfileId:\s*serverProject\.defaultShellProfileId/gu,
	) ?? [];

	assert.equal(
		occurrences.length,
		2,
		'both initial hydration and snapshot reconciliation must project the canonical shell profile',
	);
});
