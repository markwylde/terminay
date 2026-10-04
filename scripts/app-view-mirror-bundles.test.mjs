import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { GENERATED_FILE, generate } from './build-app-view-mirror.mjs';

test('the committed view mirror bundles match their sources and the pinned rrweb', async () => {
	const [expected, committed, manifest] = await Promise.all([
		generate(),
		readFile(GENERATED_FILE, 'utf8'),
		readFile(new URL('../package.json', import.meta.url), 'utf8'),
	]);
	assert.equal(
		committed,
		expected,
		'bundles.generated.ts is out of date; run node scripts/build-app-view-mirror.mjs',
	);
	// One exact version, and the bundles were built from it.
	const pinned = JSON.parse(manifest).dependencies.rrweb;
	assert.match(pinned, /^\d+\.\d+\.\d+$/u);
	assert.ok(committed.includes(`MIRROR_RRWEB_VERSION = ${JSON.stringify(pinned)}`));
});
