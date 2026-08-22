import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);

test('narrow release builds materialize their workspace dependencies', async () => {
	const serverCorePackage = JSON.parse(
		await readFile(resolve(root, 'packages/server-core/package.json'), 'utf8'),
	);
	const workspaceGraph = await readFile(
		resolve(root, 'scripts/build-workspace-graph.mjs'),
		'utf8',
	);
	assert.match(
		serverCorePackage.scripts.build,
		/build-workspace-graph\.mjs --target @terminay\/server-core/u,
	);
	const serverCoreDefinition = workspaceGraph.slice(
		workspaceGraph.indexOf("'@terminay/server-core':"),
		workspaceGraph.indexOf("'@terminay/server':"),
	);
	assert.match(
		serverCoreDefinition,
		/dependencies:\s*\[\s*'@terminay\/protocol',\s*'@terminay\/extension-api',\s*'@terminay\/ui-bundle',\s*\]/u,
		'building server-core must compile the workspace packages shipped alongside it',
	);
});

test('release pack consumers accept npm 12 single-object metadata', async () => {
	const workflow = await readFile(resolve(root, '.github/workflows/trigger-release.yml'), 'utf8');
	const secureRuntimeBuilder = await readFile(
		resolve(root, 'scripts/build-secure-werift-candidate.mjs'),
		'utf8',
	);
	assert.match(workflow, /node scripts\/npm-pack-result\.mjs/u);
	assert.doesNotMatch(workflow, /!Array\.isArray\(result\) \|\| result\.length !== 1/u);
	assert.equal(
		[...secureRuntimeBuilder.matchAll(/parseSingleNpmPackResult\(packed\.stdout\)/gu)].length,
		3,
	);
});
