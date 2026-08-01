#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildSecureWeriftCandidate,
	packSecureWeriftCandidate,
	verifySecureWeriftCandidate,
	WERIFT_CANDIDATE_VERSION,
	WERIFT_TURN_REFRESH_PATCH_SHA256,
} from './build-secure-werift-candidate.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export async function stageSelectedSecureWeriftRuntime(
	outputDirectory = join(repositoryRoot, 'build', 'webrtc-runtime'),
) {
	const destination = resolve(outputDirectory);
	const selectionPath = join(
		repositoryRoot,
		'build',
		'webrtc-runtime',
		'selection.json',
	);
	const selection = JSON.parse(
		await readFile(selectionPath, 'utf8'),
	);
	assert.equal(selection.runtime, 'secure-werift');
	assert.equal(selection.runtimePolicy?.fallback, 'disabled');
	assert.equal(selection.package?.version, WERIFT_CANDIDATE_VERSION);
	assert.equal(
		selection.patches?.[0]?.sha256,
		WERIFT_TURN_REFRESH_PATCH_SHA256,
	);

	const temporary = await mkdtemp(join(tmpdir(), 'terminay-selected-werift-'));
	try {
		const first = await buildSecureWeriftCandidate(join(temporary, 'first'));
		const second = await buildSecureWeriftCandidate(join(temporary, 'second'));
		assert.deepEqual(
			first.fileHashes,
			second.fileHashes,
			'independent Secure Werift builds differ',
		);

		const [firstArchive, secondArchive] = await Promise.all([
			packSecureWeriftCandidate(first.artifactRoot),
			packSecureWeriftCandidate(second.artifactRoot),
		]);
		assert.equal(firstArchive.filename, secondArchive.filename);
		assert.deepEqual(
			firstArchive.bytes,
			secondArchive.bytes,
			'independent Secure Werift archives differ',
		);

		const packageJson = JSON.parse(
			await readFile(join(first.artifactRoot, 'package.json'), 'utf8'),
		);
		assert.equal(packageJson.name, selection.package?.name);
		assert.equal(packageJson.version, selection.package?.version);

		const next = join(destination, 'artifact.next');
		const staged = join(destination, 'artifact');
		await rm(next, { force: true, recursive: true });
		await mkdir(destination, { recursive: true });
		await cp(selectionPath, join(destination, 'selection.json'));
		await cp(first.artifactRoot, next, { recursive: true, dereference: false });
		await verifySecureWeriftCandidate(next);
		await rm(staged, { force: true, recursive: true });
		await rename(next, staged);

		return {
			archiveSha256: createHash('sha256')
				.update(firstArchive.bytes)
				.digest('hex'),
			destination,
			fileHashes: first.fileHashes,
			package: `${packageJson.name}@${packageJson.version}`,
		};
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}

function parseOutputDirectory(argv) {
	if (argv.length === 0) return undefined;
	if (argv.length !== 2 || argv[0] !== '--output-dir') {
		throw new Error(
			'usage: stage-selected-secure-werift-runtime.mjs [--output-dir PATH]',
		);
	}
	return argv[1];
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.stdout.write(
		`${JSON.stringify(await stageSelectedSecureWeriftRuntime(parseOutputDirectory(process.argv.slice(2))), null, 2)}\n`,
	);
}
