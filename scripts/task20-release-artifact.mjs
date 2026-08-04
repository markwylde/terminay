import {
	createPublicKey,
	sign,
	verify,
} from 'node:crypto';
import {
	access,
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
	cleanInstall,
	createCandidate,
	recoverIncompatible,
	rollback,
	sha256,
	UPDATE_TARGETS,
	upgrade,
} from './task20-release-lifecycle.mjs';

const POINTER_FILE = 'active-release.json';
const MANIFEST_FILE = 'artifact-manifest.json';
const SIGNATURE_FILE = 'artifact-signature.json';
const SCHEMA_VERSION = 1;
const SIGNATURE_SCHEMA_VERSION = 1;

/**
 * Build a release candidate whose file metadata is derived from the payload
 * that will actually be written. This keeps the test at the artifact
 * boundary: it does not rely on an in-memory list of files being truthful.
 */
export function createFilesystemCandidate({
	artifactId,
	product,
	version,
	protocolVersion = 1,
	serverVersion = version,
	uiVersion = version,
	files,
	entrypoints = {},
}) {
	if (
		!files ||
		typeof files !== 'object' ||
		Array.isArray(files) ||
		Object.keys(files).length === 0
	)
		throw new TypeError('artifact files are required');
	const payload = new Map();
	const descriptors = [];
	for (const [path, value] of Object.entries(files)) {
		assertRelativeArtifactPath(path);
		const bytes = Buffer.from(value);
		payload.set(path, bytes);
		descriptors.push({ path, size: bytes.byteLength, sha256: sha256(bytes) });
	}
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	if (
		!entrypoints ||
		typeof entrypoints !== 'object' ||
		Array.isArray(entrypoints)
	)
		throw new TypeError('artifact entrypoints must be a name-to-path map');
	const fileByPath = new Map(descriptors.map((file) => [file.path, file]));
	const entrypointDescriptors = Object.entries(entrypoints)
		.map(([name, path]) => {
			if (!/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(name))
				throw new TypeError(`artifact entrypoint name is invalid: ${name}`);
			if (typeof path !== 'string' || !fileByPath.has(path))
				throw new TypeError(`artifact entrypoint is not a payload file: ${name}`);
			return { name, ...fileByPath.get(path) };
		})
		.sort((left, right) => left.name.localeCompare(right.name));
	const candidate = createCandidate({
		artifactId,
		product,
		version,
		protocolVersion,
		serverVersion,
		uiVersion,
		files: descriptors,
		entrypoints: entrypointDescriptors,
	});
	return Object.freeze({ candidate, payload });
}

/** Write and validate a standalone/desktop-like artifact directory. */
export async function writeFilesystemArtifact(root, artifact) {
	const { candidate, payload } = artifact;
	const artifactsRoot = join(resolve(root), 'artifacts');
	await mkdir(artifactsRoot, { recursive: true });
	const artifactRoot = join(artifactsRoot, candidate.artifactId);
	try {
		// A release ID names immutable verified bytes. Reusing an existing
		// directory would allow a later staging attempt to replace payload files
		// (or traverse an attacker-created entry) after it has been trusted.
		await mkdir(artifactRoot);
	} catch (error) {
		if (error?.code === 'EEXIST')
			throw new Error(`artifact staging path already exists: ${candidate.artifactId}`);
		throw error;
	}
	for (const [path, bytes] of payload) {
		const target = safeArtifactPath(artifactRoot, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, bytes);
	}
	const manifest = {
		schemaVersion: SCHEMA_VERSION,
		artifactId: candidate.artifactId,
		product: candidate.product,
		version: candidate.version,
		protocolVersion: candidate.protocolVersion,
		serverVersion: candidate.serverVersion,
		uiVersion: candidate.uiVersion,
		files: candidate.files,
		entrypoints: candidate.entrypoints,
	};
	await writeFile(
		join(artifactRoot, MANIFEST_FILE),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return readFilesystemArtifact(root, candidate.artifactId);
}

/** Attach a detached Ed25519 signature to the exact manifest bytes written
 * for an artifact. The private key is never persisted in the artifact. */
export async function signFilesystemArtifact(root, artifactId, { privateKey, keyId }) {
	if (typeof keyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(keyId))
		throw new TypeError('artifact signing key id is invalid');
	const artifact = await readFilesystemArtifact(root, artifactId);
	const manifest = await readFile(join(artifact.root, MANIFEST_FILE));
	const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
	const signature = sign(null, manifest, privateKey).toString('base64');
	const record = {
		schemaVersion: SIGNATURE_SCHEMA_VERSION,
		algorithm: 'ed25519',
		keyId,
		publicKey,
		signature,
	};
	await writeFile(join(artifact.root, SIGNATURE_FILE), `${JSON.stringify(record, null, 2)}\n`);
	return Object.freeze({ algorithm: record.algorithm, keyId: record.keyId });
}

/** Verify the detached signature after the payload and manifest pass the
 * normal file-set/hash checks. The caller supplies the trusted public key;
 * the embedded public key is metadata only and is never trusted by itself. */
export async function verifyFilesystemArtifactSignature(root, artifactId, { publicKey, keyId }) {
	if (typeof keyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(keyId))
		throw new TypeError('artifact signing key id is invalid');
	const artifact = await readFilesystemArtifact(root, artifactId);
	const record = JSON.parse(await readFile(join(artifact.root, SIGNATURE_FILE), 'utf8'));
	if (
		record?.schemaVersion !== SIGNATURE_SCHEMA_VERSION ||
		record.algorithm !== 'ed25519' ||
		record.keyId !== keyId ||
		typeof record.signature !== 'string' ||
		typeof record.publicKey !== 'string'
	)
		throw new Error('artifact signature metadata is invalid');
	const manifest = await readFile(join(artifact.root, MANIFEST_FILE));
	if (!verify(null, manifest, publicKey, Buffer.from(record.signature, 'base64')))
		throw new Error(`artifact signature verification failed: ${artifactId}`);
	return Object.freeze({ algorithm: record.algorithm, keyId: record.keyId });
}

/**
 * Read a candidate back from disk and verify its complete file set. Missing,
 * changed, extra, or path-traversing files fail closed before any active
 * release pointer can be changed.
 */
export async function readFilesystemArtifact(root, artifactId) {
	const artifactRoot = join(resolve(root), 'artifacts', artifactId);
	await assertArtifactDirectory(artifactRoot);
	const raw = JSON.parse(
		await readArtifactRegularFile(artifactRoot, MANIFEST_FILE, 'utf8'),
	);
	if (
		raw?.schemaVersion !== SCHEMA_VERSION ||
		raw?.artifactId !== artifactId ||
		!Array.isArray(raw.files) ||
		!Array.isArray(raw.entrypoints)
	)
		throw new Error('artifact manifest is invalid');
	const candidate = createCandidate({
		artifactId: raw.artifactId,
		product: raw.product,
		version: raw.version,
		protocolVersion: raw.protocolVersion,
		serverVersion: raw.serverVersion,
		uiVersion: raw.uiVersion,
		files: raw.files,
		entrypoints: raw.entrypoints,
	});
	const expected = new Set(candidate.files.map((file) => file.path));
	const actual = new Set(await listPayloadFiles(artifactRoot));
	if (
		actual.size !== expected.size ||
		[...actual].some((path) => !expected.has(path))
	)
		throw new Error(`artifact file set does not match manifest: ${artifactId}`);
	for (const file of candidate.files) {
		const bytes = await readArtifactRegularFile(artifactRoot, file.path);
		if (bytes.byteLength !== file.size || sha256(bytes) !== file.sha256)
			throw new Error(`artifact file integrity mismatch: ${file.path}`);
	}
	for (const entrypoint of candidate.entrypoints) {
		const descriptor = candidate.files.find((file) => file.path === entrypoint.path);
		if (
			!descriptor ||
			descriptor.size !== entrypoint.size ||
			descriptor.sha256 !== entrypoint.sha256
		)
			throw new Error(`artifact entrypoint metadata mismatch: ${entrypoint.name}`);
	}
	return Object.freeze({ candidate, root: artifactRoot });
}

/**
 * Release artifacts are verified from a filesystem location that may persist
 * between staging and activation.  Never follow a substituted symlink for the
 * artifact root, manifest, or any payload file: doing so could make a valid
 * manifest attest bytes outside of the immutable artifact directory.
 */
async function assertArtifactDirectory(artifactRoot) {
	const details = await lstat(artifactRoot);
	if (!details.isDirectory() || details.isSymbolicLink())
		throw new Error(`artifact root is not a real directory: ${artifactRoot}`);
}

async function readArtifactRegularFile(artifactRoot, relativePath, encoding) {
	const path = safeArtifactPath(artifactRoot, relativePath);
	const details = await lstat(path);
	if (!details.isFile() || details.isSymbolicLink())
		throw new Error(`artifact contains unsupported filesystem entry: ${relativePath}`);
	return encoding === undefined ? readFile(path) : readFile(path, encoding);
}

export async function cleanInstallFilesystem(root, artifact, options) {
	const existing = await readPointer(root);
	if (existing !== null) throw new Error('an active release already exists');
	const verified = await writeFilesystemArtifact(root, artifact);
	const state = cleanInstall(verified.candidate, options);
	await writePointer(root, state);
	return state;
}

export async function upgradeFilesystem(root, state, artifact, options = {}) {
	const staged = await writeFilesystemArtifact(root, artifact);
	return activateFilesystemArtifact(root, state, staged.candidate.artifactId, options);
}

/**
 * Activate an already-staged artifact only after re-reading and verifying its
 * complete on-disk manifest. The active pointer is the last write in this
 * transition, so a bad payload or incompatible candidate cannot replace the
 * current release.
 */
export async function activateFilesystemArtifact(
	root,
	state,
	artifactId,
	options = {},
) {
	const verified = await readFilesystemArtifact(root, artifactId);
	const next = upgrade(state, verified.candidate, options);
	await writePointer(root, next);
	return next;
}

export async function rollbackFilesystem(root, state) {
	const next = rollback(state);
	await readFilesystemArtifact(root, next.active.artifactId);
	await writePointer(root, next);
	return next;
}

export async function recoverIncompatibleFilesystem(
	root,
	state,
	artifact,
	options = {},
) {
	const verified = await writeFilesystemArtifact(root, artifact);
	const result = recoverIncompatible(state, verified.candidate, options);
	if (result.recovery === 'preserved-active') {
		const onDisk = await readPointer(root);
		if (onDisk?.activeArtifactId !== state.active.artifactId)
			throw new Error('incompatible recovery changed the active release');
		return result;
	}
	await writePointer(root, result);
	return result;
}

export async function readInstalledFilesystemState(root) {
	const pointer = await readPointer(root);
	if (pointer === null) return null;
	const active = (await readFilesystemArtifact(root, pointer.activeArtifactId))
		.candidate;
	const previous =
		pointer.previousArtifactId === null
			? null
			: (await readFilesystemArtifact(root, pointer.previousArtifactId))
					.candidate;
	return Object.freeze({
		target: pointer.target,
		active,
		previous,
		dataRoot: pointer.dataRoot,
		serverIdentity: pointer.serverIdentity,
	});
}

async function writePointer(root, state) {
	if (!Object.values(UPDATE_TARGETS).includes(state.target))
		throw new Error('release target is invalid');
	const directory = resolve(root);
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `${POINTER_FILE}.next`);
	await writeFile(
		temporary,
		`${JSON.stringify(
			{
				schemaVersion: SCHEMA_VERSION,
				target: state.target,
				activeArtifactId: state.active.artifactId,
				previousArtifactId: state.previous?.artifactId ?? null,
				dataRoot: state.dataRoot,
				serverIdentity: state.serverIdentity,
			},
			null,
			2,
		)}\n`,
	);
	await rename(temporary, join(directory, POINTER_FILE));
}

async function readPointer(root) {
	try {
		const pointer = JSON.parse(
			await readFile(join(resolve(root), POINTER_FILE), 'utf8'),
		);
		if (
			pointer?.schemaVersion !== SCHEMA_VERSION ||
			typeof pointer.activeArtifactId !== 'string' ||
			typeof pointer.dataRoot !== 'string' ||
			typeof pointer.serverIdentity !== 'string'
		)
			throw new Error('active release pointer is invalid');
		if (
			pointer.previousArtifactId !== null &&
			typeof pointer.previousArtifactId !== 'string'
		)
			throw new Error('active release pointer is invalid');
		return pointer;
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

async function listPayloadFiles(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const target = join(directory, entry.name);
			if (
				directory === root &&
				(entry.name === MANIFEST_FILE || entry.name === SIGNATURE_FILE)
			)
				continue;
			if (entry.isDirectory()) await visit(target);
			else if (entry.isFile())
				files.push(relative(root, target).split(sep).join('/'));
			else
				throw new Error(
					`artifact contains unsupported filesystem entry: ${target}`,
				);
		}
	}
	await visit(root);
	return files;
}

function safeArtifactPath(root, path) {
	assertRelativeArtifactPath(path);
	const target = resolve(root, path);
	const escaped = relative(resolve(root), target);
	if (
		escaped === '..' ||
		escaped.startsWith(`..${sep}`) ||
		escaped.length === 0 ||
		escaped.includes('\0')
	)
		throw new Error('artifact path escapes its root');
	return target;
}

function assertRelativeArtifactPath(path) {
	if (
		typeof path !== 'string' ||
		path.length === 0 ||
		path.includes('\0') ||
		path.startsWith('/') ||
		path.includes('\\') ||
		path.split('/').some((part) => part === '' || part === '.' || part === '..')
	)
		throw new TypeError(`artifact path is invalid: ${path}`);
}

export async function removeFilesystemReleaseRoot(root) {
	await rm(root, { recursive: true, force: true });
}

export async function assertFilesystemArtifactExists(root, artifactId) {
	await access(join(resolve(root), 'artifacts', artifactId, MANIFEST_FILE));
	return stat(join(resolve(root), 'artifacts', artifactId));
}
