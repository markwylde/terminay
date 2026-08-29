import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(new URL('..', import.meta.url).pathname);

test('narrow release builds materialize their workspace dependencies through Turbo', async () => {
	const turbo = JSON.parse(await readFile(resolve(root, 'turbo.json'), 'utf8'));
	const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	const extensionStaging = await readFile(resolve(root, 'scripts/stage-built-in-extensions.mjs'), 'utf8');
	const serverCorePackage = JSON.parse(
		await readFile(resolve(root, 'packages/server-core/package.json'), 'utf8'),
	);
	const builtInPackages = [
		['ssh', 'terminay-plugin-ssh'],
		['puzed', 'terminay-plugin-puzed'],
		['agent-codex', 'terminay-agent-codex'],
		['agent-claude-code', 'terminay-agent-claude-code'],
		['agent-cursor', 'terminay-agent-cursor'],
		['agent-grok', 'terminay-agent-grok'],
		['agent-omp', 'terminay-agent-omp'],
	];

	assert.equal(serverCorePackage.scripts.build, 'tsc -p tsconfig.json');
	assert.deepEqual(turbo.tasks.build.dependsOn, ['^build']);
	assert.equal(turbo.tasks.build.outputs.includes('dist/**'), true);
	assert.equal(rootPackage.scripts['build:built-in-extension-workspaces'], 'turbo run compile --filter=terminay-*');
	assert.equal(rootPackage.scripts['build:workspaces'], 'turbo run build --filter=!terminay-* && turbo run compile --filter=terminay-*');
	assert.match(
		rootPackage.scripts['build:dev-desktop'],
		/vite build --config vite\.server-ui\.config\.ts/u,
	);
	assert.equal(
		turbo.tasks['//#build:dev-desktop'].outputs.includes('dist-web/**'),
		true,
	);
	assert.equal(
		turbo.tasks['//#build:dev-desktop'].outputs.includes('dist-electron/**'),
		true,
	);
	assert.match(rootPackage.scripts['build:application-graph'], /turbo run compile --filter=terminay-\*/u);
	assert.match(extensionStaging, /npm\(root, \["run", "build:built-in-extension-workspaces"\]\)/u);
	assert.match(extensionStaging, /npm\(root, \["run", "test:ci", "--workspace", entry\.packageName\]\)/u);
	for (const [directory, packageName] of builtInPackages) {
		const packageJson = JSON.parse(
			await readFile(resolve(root, 'extensions', directory, 'package.json'), 'utf8'),
		);
		assert.equal(typeof packageJson.scripts.compile, 'string', `${packageName} has a cacheable Turbo compile task`);
	}
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
