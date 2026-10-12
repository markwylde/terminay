import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
	assertBundledKeyMatches,
	EMBEDDED_KEY_SOURCE,
} from './check-embedded-release-key.mjs';

/**
 * The `terminay` CLI as a server archive carries it.
 *
 * An installed server is upgraded by the upgrader its own release ships, so
 * that an upgrade needs no npm, no registry, and no Node.js on the host beyond
 * the runtime already in the archive. The CLI is bundled into one file from
 * the same source the npm package is compiled from, and run by a wrapper on
 * the archive's own Node.
 *
 * Bundled from source rather than from the compiled package, so an archive
 * never depends on a build step that may or may not have run, and with the
 * working directory pinned, so the bytes are the same on every machine.
 */

export const ARCHIVE_CLI_BUNDLE = 'cli/terminay.mjs';
export const ARCHIVE_CLI_LAUNCHER = 'bin/terminay';
/** Relative to the repository root. */
export const CLI_ENTRY = 'apps/terminay-cli/src/cli.ts';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The wrapper. It finds the archive from its own path with nothing but shell
 * built-ins, so it runs on a host whose PATH offers nothing at all.
 */
export function renderCliLauncher() {
	return [
		'#!/bin/sh',
		'set -eu',
		'case "$0" in',
		// Written in two pieces so the shell's own expansion is not mistaken
		// for a template placeholder left in a plain string.
		'  */*) BIN=$' + '{0%/*} ;;',
		'  *) BIN=. ;;',
		'esac',
		'ROOT=$(CDPATH= cd -- "$BIN/.." && pwd)',
		`exec "$ROOT/bin/node" "$ROOT/${ARCHIVE_CLI_BUNDLE}" "$@"`,
		'',
	].join('\n');
}

/** Bundle the CLI into one ESM file and return its bytes as text. */
export async function bundleCli({ root = repositoryRoot, outfile }) {
	await mkdir(dirname(outfile), { recursive: true });
	await build({
		// Relative inputs under a pinned directory: module paths appear in the
		// output as comments, and an absolute one would differ per machine.
		absWorkingDir: root,
		entryPoints: [CLI_ENTRY],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node24',
		// The QR renderer is CommonJS and reaches for Node built-ins.
		banner: {
			js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
		},
		legalComments: 'inline',
		sourcemap: false,
		logLevel: 'silent',
		outfile,
	});
	return readFile(outfile, 'utf8');
}

/**
 * Add the CLI and its wrapper to a staged archive root.
 *
 * The bundle must embed the release key the CLI source embeds: that key is
 * what makes a download trustworthy, and an archive whose upgrader trusted a
 * different one would refuse every release, or accept the wrong ones.
 */
export async function stageArchiveCli({ archiveRoot, root = repositoryRoot }) {
	const bundlePath = join(archiveRoot, ARCHIVE_CLI_BUNDLE);
	const launcherPath = join(archiveRoot, ARCHIVE_CLI_LAUNCHER);
	const bundle = await bundleCli({ root, outfile: bundlePath });
	const source = await readFile(join(root, EMBEDDED_KEY_SOURCE), 'utf8');
	const fingerprint = assertBundledKeyMatches(bundle, source);
	await mkdir(dirname(launcherPath), { recursive: true });
	await writeFile(launcherPath, renderCliLauncher(), { mode: 0o755 });
	return { bundlePath, launcherPath, fingerprint };
}
