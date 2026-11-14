import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
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
		['builtin-agents', 'terminay-builtin-agents'],
		['language-typescript', 'terminay-language-typescript'],
		['gitea', 'terminay-gitea'],
		['github', 'terminay-github'],
	];

	// server-core also stages the bot image context into its dist, so its
	// cached build must hash that context too.
	assert.equal(
		serverCorePackage.scripts.build,
		'tsc -p tsconfig.json && node ../../scripts/stage-bot-image.mjs',
	);
	const serverCoreBuild = turbo.tasks['@terminay/server-core#build'];
	assert.deepEqual(serverCoreBuild.dependsOn, ['^build']);
	assert.equal(serverCoreBuild.outputs.includes('dist/**'), true);
	assert.equal(
		serverCoreBuild.inputs.includes('$TURBO_ROOT$/docker/terminay-bot/**'),
		true,
	);
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
	// Built in the GNU/Linux floor image by the shared archive script, then
	// held to the glibc floor before it is checksummed or signed (ADR-0077).
	assert.match(
		job,
		/sh scripts\/run-in-linux-floor\.sh --output "\$OUTPUT" -- sh scripts\/build-linux-standalone-archive\.sh "\$TARGET" tag "\$EXPECTED_COMMIT" "\$OUTPUT\/terminay-server-\$VERSION-\$TARGET\.tar\.gz"/u,
	);
	assert.doesNotMatch(job, /build-standalone-server-artifact\.mjs/u);
	const archiveBuild = await readFile(
		resolve(root, 'scripts/build-linux-standalone-archive.sh'),
		'utf8',
	);
	assert.match(archiveBuild, /node scripts\/build-standalone-server-artifact\.mjs/u);
	assert.match(archiveBuild, /--channel "\$channel"/u);
	assert.match(archiveBuild, /--revision "\$revision"/u);
	assert.match(job, /ARCHIVE="release\/\$VERSION\/terminay-server-\$VERSION-\$TARGET\.tar\.gz"/u);
	const floorCheck = job.indexOf('node scripts/linux-glibc-floor.mjs check --target "$TARGET" "$ARCHIVE"');
	const floorProbe = job.indexOf('sh scripts/probe-linux-glibc-floor.sh server-archive "$ARCHIVE"');
	assert.ok(floorCheck >= 0 && floorProbe > floorCheck, 'the archive is checked and probed at the glibc floor');
	assert.ok(floorProbe < job.indexOf('release-checksum.mjs write'), 'the floor gate runs before the checksum');
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

test('the CLI is published to npm only after the archives it installs are attached', async () => {
	const workflow = await readFile(
		resolve(root, '.github/workflows/trigger-release.yml'),
		'utf8',
	);

	const archiveStart = workflow.indexOf('  build-standalone-server:\n');
	const publishStart = workflow.indexOf('  publish-cli:\n');
	const notesStart = workflow.indexOf('  publish-release-notes:\n');
	assert.ok(archiveStart >= 0 && publishStart > archiveStart && notesStart > publishStart);

	const job = workflow.slice(publishStart, notesStart);
	// Publishing before the archives are attached would ship a CLI whose own
	// release has nothing for it to install.
	assert.match(job, /needs: \[release, build-standalone-server\]/u);
	assert.match(job, /node scripts\/check-embedded-release-key\.mjs/u);
	assert.match(job, /npm publish --workspace terminay --provenance --access public/u);
	// Trusted publishing: the registry authenticates the workflow by its OIDC
	// identity, so the job must hold no npm credential at all. A token here
	// would be a long-lived publish secret sitting in the release pipeline.
	// Comments are stripped first, because the job documents in prose that it
	// sets no token and that sentence must not read as one.
	const configuration = job
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n');
	assert.match(job, /id-token: write/u);
	assert.match(job, /registry-url: https:\/\/registry\.npmjs\.org/u);
	assert.doesNotMatch(configuration, /NODE_AUTH_TOKEN/u);
	assert.doesNotMatch(configuration, /NPM_TOKEN/u);
	assert.doesNotMatch(configuration, /_authToken/u);

	// npm exchanges the OIDC token for a short-lived credential only from
	// 11.5.1 onward; an older npm would fall back to looking for a token.
	assert.match(job, /npm install --global npm@12\.2\.1/u);

	// The published version is the release tag, so `npx terminay@X.Y.Z` and
	// release X.Y.Z are the same thing.
	assert.match(job, /node scripts\/sync-package-version\.mjs "\$VERSION"/u);
	assert.match(job, /apps\/terminay-cli\/package\.json"\)\.version'\)" = "\$VERSION"/u);

	const keyCheck = job.indexOf('check-embedded-release-key.mjs');
	const publish = job.indexOf('npm publish');
	assert.ok(keyCheck < publish, 'the embedded key check must gate the publish');
});

test('the published CLI package ships only its compiled output and one dependency', async () => {
	const manifest = JSON.parse(
		await readFile(resolve(root, 'apps/terminay-cli/package.json'), 'utf8'),
	);

	assert.equal(manifest.name, 'terminay');
	assert.notEqual(manifest.private, true, 'the CLI is the one workspace that is published');
	assert.deepEqual(manifest.files, ['dist']);
	assert.deepEqual(manifest.bin, { terminay: 'dist/cli.js' });

	// The CLI is run as root through `npx`, so its dependency footprint is
	// deliberately one pinned package.
	assert.deepEqual(Object.keys(manifest.dependencies), ['qrcode']);
	assert.match(manifest.dependencies.qrcode, /^\d+\.\d+\.\d+$/u, 'runtime dependencies are pinned exactly');

	// It must never pull the server in: that would drag a native addon into an
	// npx install and tie the CLI to one server version.
	for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
		assert.doesNotMatch(name, /^@terminay\//u, `the CLI must not depend on ${name}`);
	}

	// It runs on whatever Node the operator has; the server runs on the Node
	// inside its own archive.
	assert.equal(manifest.engines.node, '>=20');
});

test('the archive job builds and stages the server-served workspace UI', async () => {
	const workflow = await readFile(
		resolve(root, '.github/workflows/trigger-release.yml'),
		'utf8',
	);
	const jobStart = workflow.indexOf('  build-standalone-server:\n');
	const notesStart = workflow.indexOf('  publish-cli:\n');
	const job = workflow.slice(jobStart, notesStart);

	// `build:app` produces both UI bundles; the archive must stage the one the
	// hosted archive loader can serve. Staging the Desktop renderer bundle
	// instead ships an artifact that pairs a device and then serves a
	// placeholder, with every transport signal green.
	const archiveBuild = await readFile(
		resolve(root, 'scripts/build-linux-standalone-archive.sh'),
		'utf8',
	);
	assert.match(job, /sh scripts\/build-linux-standalone-archive\.sh/u);
	assert.match(archiveBuild, /npm run build:app/u);

	const builder = await readFile(
		resolve(root, 'scripts/build-standalone-server-artifact.mjs'),
		'utf8',
	);
	assert.match(builder, /args\['ui-bundle'\] \?\? 'dist-web'/u);
	assert.match(builder, /assertHostedUiEntry\(uiBundle\)/u);

	// The probe the release already runs is the last gate before publishing.
	const probe = await readFile(
		resolve(root, 'scripts/probe-standalone-server-archive.mjs'),
		'utf8',
	);
	assert.match(probe, /assertHostedUiEntry/u);
	assert.match(job, /probe-standalone-server-archive\.mjs/u);
});

test('build:app produces the bundle the archive stages', async () => {
	const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	// dist-web comes from the server-ui config; if that step ever leaves
	// build:app, the archive would stage a directory nothing wrote.
	assert.equal(manifest.scripts['build:app'], 'npm run build:application-graph && turbo run build:production-bundles && npm run build:server-postcompile');
	assert.match(manifest.scripts['build:production-bundles'], /build:server-ui:bundle/u);
	assert.match(manifest.scripts['build:server-ui:bundle'], /vite\.server-ui\.config\.ts/u);
});


test('production bundle caching contains the complete JS graph and leaves native staging outside', async () => {
	const turbo = JSON.parse(await readFile(resolve(root, 'turbo.json'), 'utf8'));
	const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	const task = turbo.tasks['//#build:production-bundles'];
	assert.deepEqual(task.dependsOn, turbo.tasks['//#build:dev-desktop'].dependsOn);
	assert.deepEqual(task.outputs, ['dist-web/**', 'dist-electron/**', 'dist/**']);
	for (const input of ['src/**', 'electron/**', 'public/**', 'server.html', 'remote.html', 'vite.config.ts', 'vite.server-ui.config.ts', 'vite.server-preload.config.ts', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.base.json', 'package.json', 'scripts/run-together.mjs', 'scripts/development-workspace-aliases.mjs', 'scripts/build-ui-bundle-manifest.mjs', 'scripts/server-ui-bundle-language-workers.mjs', '.env*']) assert.ok(task.inputs.includes(input), input);
	for (const variable of ['NODE_ENV', 'VITE_*', 'TERMINAY_DEVELOPMENT_SOURCE_WORKSPACES', 'TERMINAY_SERVER_UI_WATCH']) assert.ok(task.env.includes(variable), variable);
	assert.equal(manifest.scripts['build:production-bundles'], 'node scripts/run-together.mjs "npm run build:server-ui:bundle" "tsc" "vite build && vite build --config vite.server-preload.config.ts && node scripts/build-ui-bundle-manifest.mjs dist $npm_package_version 1 remote.html"');
});

test('production cache keys restore clean JS outputs and invalidate changed inputs and flags', { timeout: 90_000 }, async (t) => {
	const directory = await mkdtemp(resolve(tmpdir(), 'terminay-production-cache-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const turbo = JSON.parse(await readFile(resolve(root, 'turbo.json'), 'utf8'));
	// Exercise Turbo's actual hashing/restoration with the production input,
	// output and environment contract. Tiny fixture commands replace compilers;
	// graph dependencies are verified separately above.
	const task = { ...turbo.tasks['//#build:production-bundles'], dependsOn: ['cache-placeholder#build'] };
	await writeFile(resolve(directory, 'turbo.json'), JSON.stringify({ tasks: { '//#build:production-bundles': task, build: { outputs: ['dist/**'] } } }));
	await writeFile(resolve(directory, 'package.json'), JSON.stringify({ name: 'terminay-cache-fixture', private: true, workspaces: ['packages/*'], packageManager: 'npm@12.2.1', scripts: { 'build:production-bundles': 'node fixture-build.mjs' } }));
	await writeFile(resolve(directory, 'package-lock.json'), JSON.stringify({ name: 'terminay-cache-fixture', lockfileVersion: 3, packages: {} }));
	await writeFile(resolve(directory, '.gitignore'), '.turbo/\ndist/\ndist-web/\ndist-electron/\n.env*\n');
	await writeFile(resolve(directory, 'fixture-build.mjs'), `import { mkdirSync, writeFileSync } from 'node:fs'; for (const [dir, name] of [['dist-web', 'server.html'], ['dist-electron', 'main.js'], ['dist', 'remote.html']]) { mkdirSync(dir, { recursive: true }); writeFileSync(dir + '/' + name, 'verified output'); }`);
	await mkdir(resolve(directory, 'packages/placeholder'), { recursive: true });
	await writeFile(resolve(directory, 'packages/placeholder/package.json'), JSON.stringify({ name: 'cache-placeholder', version: '1.0.0', scripts: { build: 'node build.mjs' } }));
	await writeFile(resolve(directory, 'packages/placeholder/build.mjs'), `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('dist', { recursive: true }); writeFileSync('dist/index.js', 'compiled workspace');`);
	await writeFile(resolve(directory, 'packages/placeholder/source.ts'), 'workspace one');
	await mkdir(resolve(directory, 'src'));
	await mkdir(resolve(directory, 'scripts'));
	await writeFile(resolve(directory, 'src/app.ts'), 'export const version = 1;');
	await writeFile(resolve(directory, 'vite.server-ui.config.ts'), 'config one');
	await writeFile(resolve(directory, 'scripts/server-ui-bundle-language-workers.mjs'), 'guard one');
	const run = promisify(execFile);
	const invoke = async (dry = true, overrides = {}) => {
		const { stdout } = await run(process.execPath, [resolve(root, 'node_modules/turbo/bin/turbo'), 'run', 'build:production-bundles', '--cache=local:rw', ...(dry ? ['--dry=json'] : [])], {
			cwd: directory, timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
			env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1', ...overrides },
		});
		return dry ? JSON.parse(stdout).tasks.find((entry) => entry.taskId === '//#build:production-bundles') : stdout;
	};
	const cold = await invoke();
	assert.equal(cold.cache.status, 'MISS');
	await invoke(false);
	await writeFile(resolve(directory, 'packages/placeholder/dist/postcompile-marker.json'), 'staged after build');
	for (const output of ['dist-web', 'dist-electron', 'dist']) await rm(resolve(directory, output), { recursive: true });
	const warm = await invoke();
	assert.equal(warm.hash, cold.hash);
	assert.equal(warm.cache.status, 'HIT');
	await invoke(false);
	assert.equal(await readFile(resolve(directory, 'dist-web/server.html'), 'utf8'), 'verified output');
	assert.equal(await readFile(resolve(directory, 'packages/placeholder/dist/postcompile-marker.json'), 'utf8'), 'staged after build');
	for (const [file, content] of [['src/app.ts', 'export const version = 2;'], ['vite.server-ui.config.ts', 'config two'], ['scripts/server-ui-bundle-language-workers.mjs', 'guard two'], ['.env.production', 'VITE_CACHE_PROBE=fromfile'], ['packages/placeholder/source.ts', 'workspace two']]) {
		const before = await invoke();
		await writeFile(resolve(directory, file), content);
		const after = await invoke();
		assert.notEqual(after.hash, before.hash, file);
		assert.equal(after.cache.status, 'MISS');
	}
	const baseline = await invoke();
	for (const variable of ['NODE_ENV', 'VITE_CACHE_PROBE', 'TERMINAY_DEVELOPMENT_SOURCE_WORKSPACES', 'TERMINAY_SERVER_UI_WATCH']) {
		assert.notEqual((await invoke(true, { [variable]: 'changed' })).hash, baseline.hash, variable);
	}
});
