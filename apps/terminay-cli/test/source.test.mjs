import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SourceBuildError, ToolchainError, buildFromSource, preflightToolchain } from '../dist/source.js';
import { createFakeBin } from './fake-bin.mjs';

async function withTools(present, run) {
	const fake = await createFakeBin();
	for (const [name, script] of Object.entries(present)) fake.install(name, script);
	// An empty PATH plus the stub directory: only what a test installs exists.
	const env = { ...process.env, PATH: fake.directory };
	try {
		await run(fake, env);
	} finally {
		await fake.close();
	}
}

test('a missing build tool is named before anything is downloaded', async () => {
	await withTools({ git: '', make: '' }, async (fake, env) => {
		await assert.rejects(
			() => preflightToolchain(['git', 'python3', 'make', 'c++'], env),
			(error) => error instanceof ToolchainError && /python3/u.test(error.message) && /c\+\+/u.test(error.message),
		);
		assert.ok(
			!fake.invocations().some((line) => line.startsWith('git clone')),
			'nothing may be cloned before the toolchain is checked',
		);
	});
});

test('a complete toolchain passes the preflight', async () => {
	await withTools({ git: '', python3: '', make: '', 'c++': '' }, async (_fake, env) => {
		await assert.doesNotReject(() => preflightToolchain(['git', 'python3', 'make', 'c++'], env));
	});
});

test('the missing-tool message tells the operator how to install them', async () => {
	await withTools({ git: '' }, async (_fake, env) => {
		await assert.rejects(
			() => preflightToolchain(['git', 'make'], env),
			(error) => /apt install build-essential/u.test(error.message),
		);
	});
});

test('a source build fails before downloading when the toolchain is incomplete', async () => {
	await withTools({ git: '' }, async (fake, env) => {
		await assert.rejects(
			() => buildFromSource({ ref: 'feature/x', env, architecture: 'x64', write: () => {} }),
			(error) => error instanceof ToolchainError,
		);
		assert.deepEqual(fake.invocations(), [], 'the preflight uses the shell builtin, not the tools themselves');
	});
});

test('a source build clones the ref, builds, and yields an installable archive', async () => {
	const workspace = await mkdtemp(join(tmpdir(), 'terminay-source-'));
	const destination = await mkdtemp(join(tmpdir(), 'terminay-source-out-'));
	const revision = 'd'.repeat(40);
	const fake = await createFakeBin();
	for (const tool of ['python3', 'make', 'c++']) fake.install(tool, '');

	// A git that materialises a checkout containing the scripts the builder
	// invokes, so the whole sequence runs without the network.
	// `git clone --depth 1 --branch <ref> <remote> <checkout>`: the checkout is
	// the seventh argument, and it has to exist for the steps that follow.
	fake.install(
		'git',
		`case "$1" in
  clone) mkdir -p "$7/scripts" ;;
  rev-parse) echo "${revision}" ;;
esac`,
	);
	fake.install('npm', '');
	// The builder and the runtime staging step are stood in for; what is under
	// test here is the CLI's orchestration, not the repository's own builder.
	fake.install(
		'node',
		`case "$2" in
  *pty-runtime-platforms*) printf 'https://127.0.0.1:1/node.tar.xz' ;;
  *stage-selected-secure-werift-runtime*) : ;;
  *build-standalone-server-artifact*) mkdir -p "$WANT_OUTPUT" && printf 'archive' > "$WANT_OUTPUT/terminay-server-source-linux-x64.tar.gz" && printf '{"archivePath":"%s"}' "$WANT_OUTPUT/terminay-server-source-linux-x64.tar.gz" ;;
esac`,
	);
	try {
		const env = { ...process.env, PATH: `${fake.directory}:${process.env.PATH}` };
		// The stub builder writes where the CLI asked it to.
		await assert.rejects(
			() =>
				buildFromSource({
					ref: 'feature/x',
					env,
					architecture: 'x64',
					workingDirectory: workspace,
					destination,
					write: () => {},
				}),
			// The download of the pinned Node archive is the first real network
			// call, and it has nowhere to go in this test.
			(error) => error instanceof SourceBuildError,
		);
		const invocations = fake.invocations();
		assert.ok(invocations.some((line) => line.startsWith('git clone --depth 1 --branch feature/x')), 'the ref is shallow-cloned');
		assert.ok(invocations.some((line) => line === 'npm ci'), 'dependencies are installed');
		assert.ok(invocations.some((line) => line.includes('build:application-graph')), 'the application graph is built');
	} finally {
		await fake.close();
		await rm(workspace, { recursive: true, force: true });
		await rm(destination, { recursive: true, force: true });
	}
});

test('a failed build keeps its directory and says where it is', async () => {
	const workspace = await mkdtemp(join(tmpdir(), 'terminay-source-fail-'));
	const fake = await createFakeBin();
	for (const tool of ['python3', 'make', 'c++', 'npm']) fake.install(tool, '');
	fake.install('git', 'exit 1');
	try {
		const env = { ...process.env, PATH: `${fake.directory}:${process.env.PATH}` };
		await assert.rejects(
			() => buildFromSource({ ref: 'feature/x', env, architecture: 'x64', workingDirectory: workspace, write: () => {} }),
			(error) => error instanceof SourceBuildError && /The build directory was kept at/u.test(error.message),
		);
		const { readdir } = await import('node:fs/promises');
		const left = await readdir(workspace);
		assert.ok(left.length > 0, 'the build directory must survive a failure so it can be read');
	} finally {
		await fake.close();
		await rm(workspace, { recursive: true, force: true });
	}
});

test('the real source build runs end to end when it is opted into', { skip: process.env.TERMINAY_RUN_SOURCE_BUILD_E2E !== '1' }, async () => {
	// Opt-in: this clones the repository, installs dependencies, and compiles,
	// which takes many minutes and needs a full toolchain.
	const workspace = await mkdtemp(join(tmpdir(), 'terminay-source-e2e-'));
	const destination = await mkdtemp(join(tmpdir(), 'terminay-source-e2e-out-'));
	try {
		const built = await buildFromSource({
			ref: process.env.TERMINAY_SOURCE_BUILD_REF ?? 'main',
			workingDirectory: workspace,
			destination,
			architecture: process.arch,
			write: (line) => process.stdout.write(`${line}\n`),
		});
		assert.ok((await stat(built.archivePath)).isFile());
		assert.match(built.revision, /^[0-9a-f]{40}$/u);
	} finally {
		await rm(workspace, { recursive: true, force: true });
		await rm(destination, { recursive: true, force: true });
	}
});
