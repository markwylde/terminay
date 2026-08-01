import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkWorkspace } from './check-workspace-boundaries.mjs';
import {
	assertFilesystemArtifactExists,
	activateFilesystemArtifact,
	cleanInstallFilesystem,
	createFilesystemCandidate,
	readInstalledFilesystemState,
	readFilesystemArtifact,
	recoverIncompatibleFilesystem,
	removeFilesystemReleaseRoot,
	rollbackFilesystem,
	signFilesystemArtifact,
	upgradeFilesystem,
	verifyFilesystemArtifactSignature,
	writeFilesystemArtifact,
} from './task20-release-artifact.mjs';

function artifact(version, protocolVersion = 1, product = 'terminay-server') {
	const files = product === 'terminay-desktop'
		? {
			'dist-electron/main.js': `desktop-main-${version}`,
			'dist-electron/preload.mjs': `desktop-preload-${version}`,
			'resources/server/dist/index.js': `embedded-server-${version}`,
		}
		: {
			'dist/server.js': `server-${version}`,
			'dist/ui/manifest.json': JSON.stringify({
				serverVersion: version,
				protocolVersion: String(protocolVersion),
			}),
		};
	return createFilesystemCandidate({
		artifactId: `${product}-${version}-${protocolVersion}`,
		product,
		version,
		protocolVersion,
		serverVersion: version,
		uiVersion: version,
		files,
		entrypoints: product === 'terminay-desktop'
			? {
				main: 'dist-electron/main.js',
				preload: 'dist-electron/preload.mjs',
				server: 'resources/server/dist/index.js',
			}
			: {
				server: 'dist/server.js',
				ui: 'dist/ui/manifest.json',
			},
	});
}

async function fixture() {
	return mkdtemp(join(tmpdir(), 'terminay-task20-artifact-'));
}

test('file-backed clean install, upgrade, rollback, and identity preservation use verified artifacts', async () => {
	const root = await fixture();
	try {
		const first = artifact('1.0.0');
		const installed = await cleanInstallFilesystem(root, first, {
			dataRoot: '/var/lib/terminay',
			serverIdentity: 'server-a',
		});
		assert.equal(installed.active.artifactId, first.candidate.artifactId);
		assert.deepEqual(first.candidate.entrypoints, [
			{
				name: 'server',
				path: 'dist/server.js',
				size: 12,
				sha256: '44e2c036e143643a1504d412d3c731e82f73e1a10dbadc79aeaf065c4439bab7',
			},
			{
				name: 'ui',
				path: 'dist/ui/manifest.json',
				size: 47,
				sha256: '6a3bc98dec457ed7ae79a0550bdcde09685e2907894631a3f9854f8da87dc5e9',
			},
		]);
		await assertFilesystemArtifactExists(root, first.candidate.artifactId);

		const second = artifact('1.1.0');
		const upgraded = await upgradeFilesystem(root, installed, second);
		assert.equal(upgraded.active.artifactId, second.candidate.artifactId);
		assert.equal(upgraded.previous.artifactId, first.candidate.artifactId);
		assert.equal(upgraded.dataRoot, '/var/lib/terminay');
		assert.equal(upgraded.serverIdentity, 'server-a');

		const onDiskUpgrade = await readInstalledFilesystemState(root);
		assert.equal(onDiskUpgrade.active.artifactId, second.candidate.artifactId);
		assert.equal(onDiskUpgrade.previous.artifactId, first.candidate.artifactId);

		const rolledBack = await rollbackFilesystem(root, upgraded);
		assert.equal(rolledBack.active.artifactId, first.candidate.artifactId);
		assert.equal(rolledBack.previous, null);
		const onDiskRollback = await readInstalledFilesystemState(root);
		assert.equal(onDiskRollback.active.artifactId, first.candidate.artifactId);
		assert.equal(onDiskRollback.previous, null);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('incompatible artifact recovery leaves the active pointer unchanged', async () => {
	const root = await fixture();
	try {
		const first = artifact('1.0.0');
		const installed = await cleanInstallFilesystem(root, first, {
			dataRoot: '/var/lib/terminay',
			serverIdentity: 'server-a',
		});
		const incompatible = artifact('2.0.0', 2);
		const result = await recoverIncompatibleFilesystem(
			root,
			installed,
			incompatible,
			{ protocolVersion: 1 },
		);
		assert.equal(result.recovery, 'preserved-active');
		assert.equal(result.state.active.artifactId, first.candidate.artifactId);
		const onDisk = await readInstalledFilesystemState(root);
		assert.equal(onDisk.active.artifactId, first.candidate.artifactId);
		assert.equal(onDisk.previous, null);
		await assertFilesystemArtifactExists(
			root,
			incompatible.candidate.artifactId,
		);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('activation verifies the staged manifest before switching and rollback re-verifies the exact prior artifact', async () => {
	const root = await fixture();
	try {
		const first = artifact('1.0.0');
		const installed = await cleanInstallFilesystem(root, first, {
			dataRoot: '/var/lib/terminay',
			serverIdentity: 'server-a',
		});
		const second = artifact('1.1.0');
		await writeFilesystemArtifact(root, second);

		const secondPayload = join(
			root,
			'artifacts',
			second.candidate.artifactId,
			'dist/server.js',
		);
		await writeFile(secondPayload, 'tampered-before-activation');
		await assert.rejects(
			activateFilesystemArtifact(root, installed, second.candidate.artifactId),
			/integrity mismatch/u,
		);
		const afterRejectedActivation = JSON.parse(
			await readFile(join(root, 'active-release.json'), 'utf8'),
		);
		assert.equal(afterRejectedActivation.activeArtifactId, first.candidate.artifactId);

		await writeFile(secondPayload, 'server-1.1.0');
		const upgraded = await activateFilesystemArtifact(
			root,
			installed,
			second.candidate.artifactId,
		);
		const verifiedSecond = await readFilesystemArtifact(
			root,
			second.candidate.artifactId,
		);
		assert.deepEqual(upgraded.active.entrypoints, verifiedSecond.candidate.entrypoints);

		const firstPayload = join(
			root,
			'artifacts',
			first.candidate.artifactId,
			'dist/server.js',
		);
		await writeFile(firstPayload, 'tampered-before-rollback');
		await assert.rejects(
			rollbackFilesystem(root, upgraded),
			/integrity mismatch/u,
		);
		const afterRejectedRollback = JSON.parse(
			await readFile(join(root, 'active-release.json'), 'utf8'),
		);
		assert.equal(afterRejectedRollback.activeArtifactId, second.candidate.artifactId);

		await writeFile(firstPayload, 'server-1.0.0');
		const rolledBack = await rollbackFilesystem(root, upgraded);
		assert.equal(rolledBack.active.artifactId, first.candidate.artifactId);
		assert.equal(rolledBack.previous, null);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('artifact tampering and unexpected files fail closed before state is read', async () => {
	const root = await fixture();
	try {
		const first = artifact('1.0.0');
		const installed = await cleanInstallFilesystem(root, first, {
			dataRoot: '/var/lib/terminay',
			serverIdentity: 'server-a',
		});
		const tamperedPath = join(
			root,
			'artifacts',
			first.candidate.artifactId,
			'dist/server.js',
		);
		await writeFile(tamperedPath, 'tampered');
		await assert.rejects(
			readInstalledFilesystemState(root),
			/integrity mismatch/,
		);
		await writeFile(tamperedPath, 'server-1.0.0');
		await writeFile(
			join(root, 'artifacts', first.candidate.artifactId, 'unexpected.txt'),
			'unexpected',
		);
		await assert.rejects(
			readInstalledFilesystemState(root),
			/file set does not match/,
		);
		assert.equal(installed.active.artifactId, first.candidate.artifactId);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('artifact verification refuses substituted symlink payloads before an active pointer is trusted', async () => {
	const root = await fixture();
	try {
		const first = artifact('1.0.0');
		await cleanInstallFilesystem(root, first, {
			dataRoot: '/var/lib/terminay',
			serverIdentity: 'server-a',
		});
		const artifactRoot = join(root, 'artifacts', first.candidate.artifactId);
		const payload = join(artifactRoot, 'dist/server.js');
		const outside = join(root, 'outside-server.js');
		await writeFile(outside, 'server-1.0.0');
		await writeFile(payload, 'server-1.0.0');
		// Replacing a verified payload with an equally-sized external file must
		// not be accepted merely because its bytes still match the manifest.
		await unlink(payload);
		await symlink(outside, payload);
		await assert.rejects(
			readInstalledFilesystemState(root),
			/unsupported filesystem entry/u,
		);
		await unlink(payload);
		await writeFile(payload, 'server-1.0.0');

		const manifest = join(artifactRoot, 'artifact-manifest.json');
		const outsideManifest = join(root, 'outside-manifest.json');
		await writeFile(outsideManifest, await readFile(manifest));
		await unlink(manifest);
		await symlink(outsideManifest, manifest);
		await assert.rejects(
			readInstalledFilesystemState(root),
			/unsupported filesystem entry/u,
		);
		await unlink(manifest);
		await writeFile(manifest, await readFile(outsideManifest));

		const relocatedArtifact = join(root, 'artifacts', `${first.candidate.artifactId}.real`);
		await rename(artifactRoot, relocatedArtifact);
		await symlink(relocatedArtifact, artifactRoot, 'dir');
		await assert.rejects(
			readInstalledFilesystemState(root),
			/not a real directory/u,
		);
		const pointer = JSON.parse(await readFile(join(root, 'active-release.json'), 'utf8'));
		assert.equal(pointer.activeArtifactId, first.candidate.artifactId);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('staging never rewrites an existing artifact id or its verified payload', async () => {
	const root = await fixture();
	try {
		const first = artifact('1.0.0');
		await writeFilesystemArtifact(root, first);
		const replacement = createFilesystemCandidate({
			artifactId: first.candidate.artifactId,
			product: 'terminay-server',
			version: '1.0.0',
			protocolVersion: 1,
			files: {
				'dist/server.js': 'replacement-server',
				'dist/ui/manifest.json': JSON.stringify({
					serverVersion: '1.0.0',
					protocolVersion: '1',
				}),
			},
			entrypoints: {
				server: 'dist/server.js',
				ui: 'dist/ui/manifest.json',
			},
		});
		await assert.rejects(
			writeFilesystemArtifact(root, replacement),
			/artifact staging path already exists/u,
		);
		const verified = await readFilesystemArtifact(root, first.candidate.artifactId);
		assert.equal(
			await readFile(join(verified.root, 'dist/server.js'), 'utf8'),
			'server-1.0.0',
		);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('desktop and standalone manifests bind exact entrypoint bytes and workspace imports stay inside declared boundaries', async () => {
	const root = await fixture();
	try {
		const desktop = artifact('1.0.0', 1, 'terminay-desktop');
		const verified = await writeFilesystemArtifact(root, desktop);
		assert.deepEqual(verified.candidate.entrypoints, [
			{
				name: 'main',
				path: 'dist-electron/main.js',
				size: 18,
				sha256: '470997439420b95a55c8f1be311f75097dacd97b80385f5938e40c37160f824d',
			},
			{
				name: 'preload',
				path: 'dist-electron/preload.mjs',
				size: 21,
				sha256: '5b77767f96ce5f1685a4c8b4715feba42a0d9ad81f3d2311742ed45e059ec090',
			},
			{
				name: 'server',
				path: 'resources/server/dist/index.js',
				size: 21,
				sha256: '2deb9768cf07c00f71a388a91ecd1e0c8d0112a2a97c67635c93ef7ae8f64406',
			},
		]);
		const manifest = JSON.parse(await readFile(join(verified.root, 'artifact-manifest.json'), 'utf8'));
		assert.deepEqual(manifest.entrypoints, verified.candidate.entrypoints);
		await writeFile(join(verified.root, 'dist-electron/main.js'), 'changed-main');
		await assert.rejects(() => readFilesystemArtifact(root, desktop.candidate.artifactId), /integrity mismatch/);
		await writeFile(join(verified.root, 'dist-electron/main.js'), 'desktop-main-1.0.0');
		manifest.entrypoints[0].sha256 = '0'.repeat(64);
		await writeFile(join(verified.root, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
		await assert.rejects(() => readFilesystemArtifact(root, desktop.candidate.artifactId), /entrypoints must reference exact manifest files/);

		const boundary = checkWorkspace(process.cwd());
		assert.deepEqual(boundary.violations, []);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('desktop and standalone artifacts remain separate update targets', async () => {
	const root = await fixture();
	try {
		const desktop = artifact('1.0.0', 1, 'terminay-desktop');
		const server = artifact('1.0.0', 1, 'terminay-server');
		await writeFilesystemArtifact(root, desktop);
		await writeFilesystemArtifact(root, server);
		assert.equal(await readInstalledFilesystemState(root), null);
		await assertFilesystemArtifactExists(root, desktop.candidate.artifactId);
		await assertFilesystemArtifactExists(root, server.candidate.artifactId);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});

test('detached release signatures cover the exact manifest and fail closed on tampering', async () => {
	const root = await fixture();
	try {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		const server = artifact('2.0.0');
		await writeFilesystemArtifact(root, server);
		assert.deepEqual(
			await signFilesystemArtifact(root, server.candidate.artifactId, {
				privateKey,
				keyId: 'release-key-1',
			}),
			{ algorithm: 'ed25519', keyId: 'release-key-1' },
		);
		assert.deepEqual(
			await verifyFilesystemArtifactSignature(root, server.candidate.artifactId, {
				publicKey,
				keyId: 'release-key-1',
			}),
			{ algorithm: 'ed25519', keyId: 'release-key-1' },
		);

		await writeFile(
			join(root, 'artifacts', server.candidate.artifactId, 'dist/server.js'),
			'tampered payload',
		);
		await assert.rejects(
			verifyFilesystemArtifactSignature(root, server.candidate.artifactId, {
				publicKey,
				keyId: 'release-key-1',
			}),
			/integrity mismatch/u,
		);
	} finally {
		await removeFilesystemReleaseRoot(root);
	}
});
