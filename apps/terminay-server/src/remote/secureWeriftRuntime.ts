import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SELECTED_PACKAGE_NAME = '@terminay/werift-runtime-proof';
const SELECTED_PACKAGE_VERSION = '0.24.1-candidate.1';
/** The governed patch set, in the exact order the build applies it. */
const SELECTED_PATCHES = [
	{
		path: 'scripts/patches/werift-0.24.1-abort-turn-refresh.patch',
		sha256: '34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211',
		purpose:
			'Abort the pending TURN allocation refresh timer during peer close.',
	},
	{
		path: 'scripts/patches/werift-0.24.1-sctp-zero-window-probe.patch',
		sha256: '298aa1ebb0f0eb45c673dd24907e7e8110bfef499524993d8203fd74ecaa6b2b',
		purpose:
			'Probe a zero receive window and serialize data-channel flush so outbound delivery cannot deadlock.',
	},
] as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface SecureWeriftRuntimeModule {
	readonly RTCPeerConnection: new (
		configuration?: Readonly<Record<string, unknown>>,
	) => unknown;
}

export interface SecureWeriftSelection {
	readonly schemaVersion: 1;
	readonly runtime: 'secure-werift';
	readonly artifactFormat: 'terminay-secure-werift-v1';
	readonly package: Readonly<{
		name: typeof SELECTED_PACKAGE_NAME;
		version: typeof SELECTED_PACKAGE_VERSION;
	}>;
	readonly patches: readonly Readonly<{
		path: string;
		sha256: string;
		purpose: string;
	}>[];
	readonly integrity: Readonly<{
		payloadManifest: 'SHA256SUMS';
		rejectExtraFiles: true;
		rejectSymlinks: true;
	}>;
	readonly runtimePolicy: Readonly<{
		fallback: 'disabled';
		legacyNodeDataChannelFallback: false;
	}>;
}

/**
 * Verify and load the one formally selected WebRTC runtime. `runtimeRoot`
 * is the packaged resource directory containing selection.json and artifact/.
 * Callers resolve that directory from their explicit Desktop/standalone layout;
 * this boundary deliberately has no package-name or environment fallback.
 */
export async function loadSelectedSecureWeriftRuntime(
	runtimeRoot: string,
): Promise<SecureWeriftRuntimeModule> {
	const { artifactRoot } = await verifySelectedSecureWeriftRuntime(runtimeRoot);
	const entrypoint = path.join(artifactRoot, 'lib', 'index.mjs');
	const loaded = (await import(pathToFileURL(entrypoint).href)) as {
		readonly RTCPeerConnection?: unknown;
	};
	if (typeof loaded.RTCPeerConnection !== 'function') {
		throw new TypeError(
			'selected Secure-Werift runtime does not expose RTCPeerConnection',
		);
	}
	// The audited upstream closure retains shared media/negotiation internals,
	// but no upstream media export crosses this privileged capability boundary.
	return Object.freeze({
		RTCPeerConnection: loaded.RTCPeerConnection,
	}) as SecureWeriftRuntimeModule;
}

export async function verifySelectedSecureWeriftRuntime(
	runtimeRoot: string,
): Promise<{
	readonly artifactRoot: string;
	readonly selection: SecureWeriftSelection;
}> {
	if (!path.isAbsolute(runtimeRoot)) {
		throw new TypeError('selected WebRTC runtime root must be absolute');
	}
	await assertRegularFile(path.join(runtimeRoot, 'selection.json'));
	const selection = validateSelection(
		JSON.parse(
			await readFile(path.join(runtimeRoot, 'selection.json'), 'utf8'),
		) as unknown,
	);
	const artifactRoot = path.join(runtimeRoot, 'artifact');
	const artifactMetadata = await lstat(artifactRoot);
	if (!artifactMetadata.isDirectory() || artifactMetadata.isSymbolicLink()) {
		throw new Error('selected WebRTC runtime artifact root is invalid');
	}
	const packageJsonPath = path.join(artifactRoot, 'package.json');
	await assertRegularFile(packageJsonPath);
	const packageJson = JSON.parse(
		await readFile(packageJsonPath, 'utf8'),
	) as Record<string, unknown>;
	if (
		packageJson.name !== selection.package.name ||
		packageJson.version !== selection.package.version
	) {
		throw new Error('selected WebRTC runtime package identity is invalid');
	}
	await verifyPayloadManifest(
		artifactRoot,
		selection.integrity.payloadManifest,
	);
	return { artifactRoot, selection };
}

/** Every governed patch, in order, with no additions or substitutions. */
function matchesSelectedPatches(value: unknown): boolean {
	if (!Array.isArray(value) || value.length !== SELECTED_PATCHES.length) return false;
	return SELECTED_PATCHES.every((expected, index) => {
		const actual = value[index] as Partial<(typeof SELECTED_PATCHES)[number]> | undefined;
		return (
			actual?.path === expected.path &&
			actual.sha256 === expected.sha256 &&
			actual.purpose === expected.purpose &&
			HASH_PATTERN.test(expected.sha256)
		);
	});
}

function validateSelection(value: unknown): SecureWeriftSelection {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('selected WebRTC runtime manifest is invalid');
	}
	const selection = value as Partial<SecureWeriftSelection>;
	if (
		selection.schemaVersion !== 1 ||
		selection.runtime !== 'secure-werift' ||
		selection.artifactFormat !== 'terminay-secure-werift-v1' ||
		selection.package?.name !== SELECTED_PACKAGE_NAME ||
		selection.package.version !== SELECTED_PACKAGE_VERSION ||
		!matchesSelectedPatches(selection.patches) ||
		selection.integrity?.payloadManifest !== 'SHA256SUMS' ||
		selection.integrity.rejectExtraFiles !== true ||
		selection.integrity.rejectSymlinks !== true ||
		selection.runtimePolicy?.fallback !== 'disabled' ||
		selection.runtimePolicy.legacyNodeDataChannelFallback !== false
	) {
		throw new TypeError('selected WebRTC runtime manifest is invalid');
	}
	return selection as SecureWeriftSelection;
}

async function verifyPayloadManifest(
	artifactRoot: string,
	manifestName: string,
): Promise<void> {
	const manifestPath = path.join(artifactRoot, manifestName);
	await assertRegularFile(manifestPath);
	const rows = (await readFile(manifestPath, 'utf8')).trimEnd().split('\n');
	const expected = new Map<string, string>();
	for (const row of rows) {
		const match = /^([a-f0-9]{64}) {2}([^\0\r\n]+)$/u.exec(row);
		if (match === null || !HASH_PATTERN.test(match[1] ?? '')) {
			throw new Error('selected WebRTC runtime checksum manifest is invalid');
		}
		const expectedHash = match[1] as string;
		const relativePath = normalizeManifestPath(match[2] as string);
		if (relativePath === manifestName || expected.has(relativePath)) {
			throw new Error('selected WebRTC runtime checksum manifest is invalid');
		}
		expected.set(relativePath, expectedHash);
	}
	const files = await listRegularFiles(artifactRoot);
	const actualPayload = files.filter((file) => file !== manifestName);
	if (
		actualPayload.length !== expected.size ||
		actualPayload.some((file) => !expected.has(file))
	) {
		throw new Error('selected WebRTC runtime payload inventory is invalid');
	}
	for (const [relativePath, expectedHash] of expected) {
		const filePath = path.join(artifactRoot, relativePath);
		await assertRegularFile(filePath);
		const actualHash = createHash('sha256')
			.update(await readFile(filePath))
			.digest('hex');
		if (actualHash !== expectedHash) {
			throw new Error(
				`selected WebRTC runtime integrity mismatch: ${relativePath}`,
			);
		}
	}
}

async function listRegularFiles(
	root: string,
	current = root,
): Promise<string[]> {
	const entries = (await readdir(current, { withFileTypes: true })).sort(
		(left, right) => left.name.localeCompare(right.name),
	);
	const files: string[] = [];
	for (const entry of entries) {
		const absolutePath = path.join(current, entry.name);
		const metadata = await lstat(absolutePath);
		if (metadata.isSymbolicLink()) {
			throw new Error('selected WebRTC runtime cannot contain symlinks');
		}
		if (metadata.isDirectory()) {
			files.push(...(await listRegularFiles(root, absolutePath)));
		} else if (metadata.isFile()) {
			files.push(path.relative(root, absolutePath).split(path.sep).join('/'));
		} else {
			throw new Error('selected WebRTC runtime contains an invalid entry');
		}
	}
	return files.sort((left, right) => left.localeCompare(right));
}

async function assertRegularFile(filePath: string): Promise<void> {
	const metadata = await lstat(filePath);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error('selected WebRTC runtime file is not regular');
	}
}

function normalizeManifestPath(value: string): string {
	if (
		value.length === 0 ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value
			.split('/')
			.some((part) => part === '' || part === '.' || part === '..')
	) {
		throw new Error('selected WebRTC runtime checksum path is invalid');
	}
	return value;
}
