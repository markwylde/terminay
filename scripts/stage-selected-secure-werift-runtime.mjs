#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
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
	{ reuseValidated = false } = {},
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
	// Keep development-only cache metadata outside the staged resource root so
	// desktop and standalone release artifacts contain only runtime inputs.
	const cachePath = join(
		dirname(destination),
		`.${basename(destination)}-validated-stage.json`,
	);
	const inputFingerprint = await stageInputFingerprint(selection);
	if (reuseValidated) {
		const cached = await readValidatedStage(cachePath);
		if (cached?.inputFingerprint === inputFingerprint) {
			const verified = await verifySecureWeriftCandidate(
				join(destination, 'artifact'),
			);
			return {
				archiveSha256: cached.archiveSha256,
				destination,
				fileHashes: verified.fileHashes,
				package: cached.package,
				reusedValidatedArtifact: true,
			};
		}
	}

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
		const destinationSelectionPath = join(destination, 'selection.json');
		if (resolve(selectionPath) !== resolve(destinationSelectionPath)) {
			await cp(selectionPath, destinationSelectionPath);
		}
		await cp(first.artifactRoot, next, { recursive: true, dereference: false });
		await verifySecureWeriftCandidate(next);
		await rm(staged, { force: true, recursive: true });
		await rename(next, staged);

		const result = {
			archiveSha256: createHash('sha256')
				.update(firstArchive.bytes)
				.digest('hex'),
			destination,
			fileHashes: first.fileHashes,
			package: `${packageJson.name}@${packageJson.version}`,
		};
		await writeFile(
			cachePath,
			`${JSON.stringify({
				archiveSha256: result.archiveSha256,
				inputFingerprint,
				package: result.package,
				schemaVersion: 1,
			}, null, 2)}\n`,
		);
		return result;
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}

async function stageInputFingerprint(selection) {
	const files = [
		'build-secure-werift-candidate.mjs',
		'npm-pack-result.mjs',
		'patches/werift-0.24.1-abort-turn-refresh.patch',
	];
	const hash = createHash('sha256');
	hash.update(JSON.stringify(selection));
	for (const relativePath of files) {
		hash.update(relativePath);
		hash.update(await readFile(join(repositoryRoot, 'scripts', relativePath)));
	}
	return hash.digest('hex');
}

async function readValidatedStage(cachePath) {
	try {
		const cache = JSON.parse(await readFile(cachePath, 'utf8'));
		if (
			cache?.schemaVersion !== 1 ||
			typeof cache.archiveSha256 !== 'string' ||
			typeof cache.inputFingerprint !== 'string' ||
			typeof cache.package !== 'string'
		) {
			return undefined;
		}
		return cache;
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	}
}

function parseArguments(argv) {
	let outputDirectory;
	let reuseValidated = false;
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--reuse-validated') {
			reuseValidated = true;
			continue;
		}
		if (argv[index] === '--output-dir' && argv[index + 1] !== undefined) {
			outputDirectory = argv[index + 1];
			index += 1;
			continue;
		}
		throw new Error(
			'usage: stage-selected-secure-werift-runtime.mjs [--reuse-validated] [--output-dir PATH]',
		);
	}
	return { outputDirectory, reuseValidated };
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { outputDirectory, reuseValidated } = parseArguments(process.argv.slice(2));
	process.stdout.write(
		`${JSON.stringify(await stageSelectedSecureWeriftRuntime(outputDirectory, { reuseValidated }), null, 2)}\n`,
	);
}
