import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);

test('narrow release builds materialize their workspace dependencies', async () => {
	const serverCorePackage = JSON.parse(
		await readFile(resolve(root, 'packages/server-core/package.json'), 'utf8'),
	);
	assert.match(
		serverCorePackage.scripts.build,
		/npm run build --workspace @terminay\/extension-api/u,
	);
});

test('release pack consumers accept npm 12 single-object metadata', async () => {
	const workflow = await readFile(resolve(root, '.github/workflows/trigger-release.yml'), 'utf8');
	const secureRuntimeBuilder = await readFile(
		resolve(root, 'scripts/build-secure-werift-candidate.mjs'),
		'utf8',
	);
	assert.match(workflow, /const result = Array\.isArray\(value\)/u);
	assert.doesNotMatch(workflow, /!Array\.isArray\(result\) \|\| result\.length !== 1/u);
	assert.equal(
		[...secureRuntimeBuilder.matchAll(/parseSingleNpmPackResult\(packed\.stdout\)/gu)].length,
		3,
	);
});
