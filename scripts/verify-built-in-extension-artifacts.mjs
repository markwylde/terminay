#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DirectoryBuiltInExtensionArtifactSource } from '../packages/server-core/dist/extensions/index.js';

const expected = [
	'com.terminay.builtin-agents',
	'com.terminay.language.typescript',
].sort();

/**
 * Every platform a Desktop or standalone release ships. Electron and standalone
 * inventories are byte-identical, so a package that ships prebuilt native
 * modules must carry one for each of these, or it would load on some releases
 * and silently degrade on others.
 */
export const RELEASE_NATIVE_TARGETS = Object.freeze([
	['darwin', 'arm64'],
	['darwin', 'x64'],
	['linux', 'arm64'],
	['linux', 'x64'],
]);

/** The installed package that owns a tree path, e.g. `node_modules/koffi`. */
function owningPackage(path) {
	const marker = 'node_modules/';
	const index = path.lastIndexOf(marker);
	if (index === -1) return undefined;
	const rest = path.slice(index + marker.length).split('/');
	const name = rest[0]?.startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
	return `${path.slice(0, index)}${marker}${name}`;
}

/** Returns `<package>: <platform>-<arch>` for every missing prebuild. */
export function missingNativePrebuilds(
	paths,
	targets = RELEASE_NATIVE_TARGETS,
) {
	const byPackage = new Map();
	for (const path of paths) {
		if (!path.endsWith('.node')) continue;
		const owner = owningPackage(path) ?? path;
		byPackage.set(owner, [...(byPackage.get(owner) ?? []), path]);
	}
	const missing = [];
	for (const [owner, modules] of byPackage)
		for (const [platform, arch] of targets) {
			const target = new RegExp(
				`(^|[/_.-])${platform}[_-]${arch}([/_.-]|$)`,
				'u',
			);
			if (!modules.some((path) => target.test(path)))
				missing.push(`${owner}: ${platform}-${arch}`);
		}
	return missing;
}

export async function verifyBuiltInExtensionArtifacts(root) {
	const source = new DirectoryBuiltInExtensionArtifactSource(resolve(root));
	const artifacts = await source.list();
	assert.deepEqual(
		artifacts.map((artifact) => artifact.extensionId).sort(),
		expected,
		'built-in inventory must contain exactly the official extensions',
	);
	const inventory = JSON.parse(
		await readFile(join(resolve(root), 'inventory.v1.json'), 'utf8'),
	);
	for (const record of inventory.artifacts) {
		const missing = missingNativePrebuilds(
			record.files.map((file) => file.path),
		);
		assert.deepEqual(
			missing,
			[],
			`${record.extensionId} ships native modules without a prebuild for every release target`,
		);
	}
	const temporary = await mkdtemp(join(tmpdir(), 'terminay-built-in-verify-'));
	try {
		for (const artifact of artifacts)
			await source.materialize(artifact, join(temporary, artifact.extensionId));
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
	return artifacts;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
	const root = process.argv[2];
	if (!root)
		throw new Error(
			'usage: verify-built-in-extension-artifacts.mjs <artifact-directory>',
		);
	const artifacts = await verifyBuiltInExtensionArtifacts(root);
	process.stdout.write(
		`${JSON.stringify({ verified: artifacts.map((artifact) => `${artifact.packageName}@${artifact.version}`) }, null, 2)}\n`,
	);
}
