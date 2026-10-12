import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
	describeArtifactFiles,
	normalizeArtifactModes,
} from './artifact-determinism.mjs';
import { extractEmbeddedKey } from './check-embedded-release-key.mjs';
import {
	ARCHIVE_CLI_BUNDLE,
	ARCHIVE_CLI_LAUNCHER,
	bundleCli,
	renderCliLauncher,
	stageArchiveCli,
} from './standalone-cli-bundle.mjs';

const execFileAsync = promisify(execFile);

/** An archive root with nothing in it but a Node runtime, as the builder has
 * staged by the time the CLI is added. */
async function withArchiveRoot(run) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-archive-cli-'));
	const root = join(directory, 'terminay-server-test');
	try {
		await mkdir(join(root, 'bin'), { recursive: true });
		await run(root, directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test('the archive carries the CLI, and its wrapper runs it on the archive Node with nothing on PATH', async () => {
	await withArchiveRoot(async (root) => {
		const staged = await stageArchiveCli({ archiveRoot: root });
		assert.equal(staged.bundlePath, join(root, ARCHIVE_CLI_BUNDLE));
		assert.equal(staged.launcherPath, join(root, ARCHIVE_CLI_LAUNCHER));

		// The archive's own runtime, not whatever the host has: the wrapper is
		// given an empty PATH and must still find Node beside itself.
		await symlink(process.execPath, join(root, 'bin', 'node'));
		const { stdout, stderr } = await execFileAsync(
			join(root, ARCHIVE_CLI_LAUNCHER),
			['daemon', '--help'],
			{ env: { PATH: '' }, cwd: tmpdir() },
		);
		assert.equal(stderr, '');
		assert.match(stdout, /terminay daemon <command>/u);
		assert.match(stdout, /upgrade \[ref\]/u);
		assert.match(stdout, /--check/u);

		// Reached through a path with no directory part, as `sh terminay` in
		// the bin directory would, it still finds the archive.
		const bare = await execFileAsync('/bin/sh', ['terminay', '--help'], {
			env: { PATH: '' },
			cwd: join(root, 'bin'),
		});
		assert.match(bare.stdout, /terminay daemon <command>/u);
	});
});

test('the wrapper uses no external program to find the archive', () => {
	const launcher = renderCliLauncher();
	assert.match(launcher, /^#!\/bin\/sh\n/u);
	assert.doesNotMatch(launcher, /dirname|readlink|realpath|which/u);
	assert.match(
		launcher,
		/exec "\$ROOT\/bin\/node" "\$ROOT\/cli\/terminay\.mjs" "\$@"/u,
	);
});

test('the CLI and its wrapper are listed in the manifest inventory with their modes', async () => {
	await withArchiveRoot(async (root) => {
		await stageArchiveCli({ archiveRoot: root });
		// Exactly what the builder does with them: executable modes are
		// normalised from a fixed list, never taken from the working tree.
		await normalizeArtifactModes(
			root,
			new Set([join(root, ARCHIVE_CLI_LAUNCHER)]),
		);
		const files = new Map(
			(await describeArtifactFiles(root)).map((file) => [file.path, file]),
		);
		assert.equal(files.get(ARCHIVE_CLI_LAUNCHER)?.mode, '755');
		assert.equal(files.get(ARCHIVE_CLI_BUNDLE)?.mode, '644');
		assert.match(
			files.get(ARCHIVE_CLI_BUNDLE)?.sha256 ?? '',
			/^[a-f0-9]{64}$/u,
		);
		assert.equal((await stat(join(root, ARCHIVE_CLI_BUNDLE))).isFile(), true);
	});

	const builder = await readFile(
		new URL('build-standalone-server-artifact.mjs', import.meta.url),
		'utf8',
	);
	// Staged before the inventory is taken, and executable in both passes.
	assert.ok(
		builder.indexOf('stageArchiveCli({ archiveRoot: root })') <
			builder.indexOf('files: await describeArtifactFiles(root)'),
		'the CLI must be staged before the manifest lists the files',
	);
	assert.match(builder, /join\(root, ARCHIVE_CLI_LAUNCHER\),\n\t\]\);/u);
	assert.equal(
		builder.match(/normalizeArtifactModes\(root, executables\)/gu)?.length,
		2,
	);
	assert.match(builder, /cli: ARCHIVE_CLI_LAUNCHER/u);
});

test('the bundle is the same bytes on every build', async () => {
	await withArchiveRoot(async (root, directory) => {
		const first = await bundleCli({ outfile: join(root, 'first.mjs') });
		const second = await bundleCli({
			outfile: join(directory, 'elsewhere', 'second.mjs'),
		});
		assert.equal(first, second);
		// No path from the machine that built it.
		assert.doesNotMatch(
			first,
			new RegExp(directory.replace(/[/.]/gu, '\\$&'), 'u'),
		);
		assert.doesNotMatch(first, /\/Users\/|\/home\/|\/workspace\//u);
	});
});

test('the bundled CLI embeds the release key the CLI source embeds', async () => {
	await withArchiveRoot(async (root) => {
		const { bundlePath, fingerprint } = await stageArchiveCli({
			archiveRoot: root,
		});
		const source = await readFile(
			new URL('../apps/terminay-cli/src/verify.ts', import.meta.url),
			'utf8',
		);
		const bundle = await readFile(bundlePath, 'utf8');
		assert.equal(
			extractEmbeddedKey(bundle.replaceAll('\\n', '\n')).replace(/\s/gu, ''),
			extractEmbeddedKey(source).replace(/\s/gu, ''),
		);
		assert.match(fingerprint, /^[A-Za-z0-9+/=]+$/u);
	});
});

test('the archive server launcher names the upgrader beside it, unless one was given', async () => {
	const builder = await readFile(
		new URL('build-standalone-server-artifact.mjs', import.meta.url),
		'utf8',
	);
	const launcher = builder.slice(
		builder.indexOf('async function writeLaunchers'),
	);
	// `:=` only assigns when unset, so an operator's own value stands.
	assert.match(
		launcher,
		/\{TERMINAY_UPGRADER:=\$ROOT\/\$\{ARCHIVE_CLI_LAUNCHER\}\}/u,
	);
	assert.match(launcher, /export [^\n]*\bTERMINAY_UPGRADER\b/u);
	// And its own commit, so a release started from a data volume does not
	// report the commit of the image it was staged over.
	assert.match(
		launcher,
		/\{TERMINAY_SERVER_REVISION:=\$\{release\.revision\}\}/u,
	);
	assert.match(launcher, /export [^\n]*\bTERMINAY_SERVER_REVISION\b/u);
});

test('the image runs the archive CLI and carries no second copy', async () => {
	const dockerfile = await readFile(
		new URL('../Dockerfile', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(
		dockerfile,
		/terminay-cli\/terminay\.mjs|\/opt\/terminay-cli/u,
	);
	assert.doesNotMatch(dockerfile, /npx esbuild/u);
	const command = await readFile(
		new URL('../docker/terminay', import.meta.url),
		'utf8',
	);
	assert.match(command, /exec "\$running\/bin\/terminay" "\$@"/u);
	assert.match(command, /image=\$\{TERMINAY_IMAGE_RELEASE:-\/opt\/terminay\}/u);
});
