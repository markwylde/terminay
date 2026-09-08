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
		['agent-grok', 'terminay-agent-grok'],
		['agent-opencode', 'terminay-agent-opencode'],
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
	assert.match(
		extensionStaging,
		/npm\(root, \[['"]run['"], ['"]build:built-in-extension-workspaces['"]\]\)/u,
	);
	assert.match(
		extensionStaging,
		/npm\(root, \[['"]run['"], ['"]test:ci['"], ['"]--workspace['"], entry\.packageName\]\)/u,
	);
	for (const [directory, packageName] of builtInPackages) {
		const packageJson = JSON.parse(
			await readFile(resolve(root, 'extensions', directory, 'package.json'), 'utf8'),
		);
		assert.equal(typeof packageJson.scripts.compile, 'string', `${packageName} has a cacheable Turbo compile task`);
	}
});

test('skipped agent conformance tests do not require a built server-core', async () => {
	const harness = await readFile(resolve(root, 'tests/agent-conformance/harness.mjs'), 'utf8');
	assert.doesNotMatch(
		harness,
		/^import[\s\S]*?from\s+['"]@terminay\/server-core\/agent-child['"]/mu,
	);
	assert.match(harness, /import\(\s*['"]@terminay\/server-core\/agent-child['"]\s*\)/u);

	const conformanceTests = [
		'extensions/agent-claude-code/test/conformance.test.mjs',
		'extensions/agent-codex/test/conformance.test.mjs',
		'extensions/agent-grok/test/conformance.test.mjs',
		'extensions/agent-opencode/test/conformance.test.mjs',
	];
	for (const file of conformanceTests) {
		const source = await readFile(resolve(root, file), 'utf8');
		assert.match(source, /conformanceGate/u, `${file} is gated`);
		const packageJson = JSON.parse(
			await readFile(resolve(root, file.replace(/test\/conformance\.test\.mjs$/u, 'package.json')), 'utf8'),
		);
		assert.match(
			packageJson.scripts['test:ci'],
			/test\/\*\.test\.mjs/u,
			`${packageJson.name} test:ci still discovers the gated conformance file`,
		);
	}
});

test('release pack consumers accept npm 12 single-object metadata', async () => {
	const extensionStaging = await readFile(
		resolve(root, 'scripts/stage-built-in-extensions.mjs'),
		'utf8',
	);
	const secureRuntimeBuilder = await readFile(
		resolve(root, 'scripts/build-secure-werift-candidate.mjs'),
		'utf8',
	);
	assert.match(extensionStaging, /parseSingleNpmPackResult/u);
	assert.equal(
		[...secureRuntimeBuilder.matchAll(/parseSingleNpmPackResult\(packed\.stdout\)/gu)].length,
		3,
	);
});

test('tagged releases publish signed self-contained archives per architecture and no npm pack tarball', async () => {
	const workflow = await readFile(
		resolve(root, '.github/workflows/trigger-release.yml'),
		'utf8',
	);
	// The npm pack tgz was never installable: the server's workspace
	// dependencies are private, so an operator could not resolve them.
	assert.doesNotMatch(workflow, /npm pack --workspace @terminay\/server/u);
	assert.doesNotMatch(workflow, /terminay-server-[^\n]*\.tgz/u);

	const jobStart = workflow.indexOf('  build-standalone-server:\n');
	const notesStart = workflow.indexOf('  publish-release-notes:\n');
	assert.ok(jobStart >= 0 && notesStart > jobStart);
	const job = workflow.slice(jobStart, notesStart);
	assert.match(job, /runs-on: \$\{\{ matrix\.runner \}\}/u);
	assert.match(job, /- target: linux-x64\n\s+arch: x64\n\s+runner: ubuntu-latest/u);
	assert.match(job, /- target: linux-arm64\n\s+arch: arm64\n\s+runner: ubuntu-24\.04-arm/u);
	assert.match(job, /node scripts\/build-standalone-server-artifact\.mjs/u);
	assert.match(job, /--channel tag/u);
	assert.match(job, /--revision "\$EXPECTED_COMMIT"/u);
	assert.match(job, /ARCHIVE="release\/\$VERSION\/terminay-server-\$VERSION-\$TARGET\.tar\.gz"/u);
	assert.match(job, /release-checksum\.mjs write "\$ARCHIVE" "\$ARCHIVE\.sha256"/u);
	assert.match(job, /release-signature\.mjs sign "\$ARCHIVE" "\$ARCHIVE\.sig"/u);
	assert.match(job, /release-signature\.mjs verify "\$ARCHIVE" "\$ARCHIVE\.sig"/u);
	assert.match(job, /gh release upload "\$TAG" "\$ARCHIVE" "\$ARCHIVE\.sha256" "\$ARCHIVE\.sig" --repo "\$GH_REPO"/u);

	// Both architectures, each with its sidecar and detached signature, are the
	// exact asset set the release notes step will accept.
	const notes = workflow.slice(notesStart);
	for (const architecture of ['x64', 'arm64']) {
		for (const suffix of ['', '.sha256', '.sig']) {
			assert.ok(
				notes.includes(`terminay-server-\${VERSION}-linux-${architecture}.tar.gz${suffix}\n`),
				`release notes must require terminay-server-<version>-linux-${architecture}.tar.gz${suffix}`,
			);
		}
	}
});
