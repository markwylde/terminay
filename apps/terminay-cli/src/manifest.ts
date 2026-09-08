import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { Architecture, ReleaseChannel } from './resolve.js';

/**
 * The manifest inside a server archive, and what makes it trustworthy.
 *
 * `scripts/build-standalone-server-artifact.mjs` writes this file, and the
 * signature the CLI already checked covers it, so re-hashing the unpacked tree
 * against it turns "the download was authentic" into "what landed on disk is
 * what was signed". A tar that unpacked partially, or a versioned directory
 * something later edited, is caught here rather than at first start.
 */

export const ARCHIVE_MANIFEST = 'artifact-manifest.json';

export interface ManifestFile {
	readonly path: string;
	readonly mode: string;
	readonly size: number;
	readonly sha256: string;
}

export interface ArchiveManifest {
	readonly schemaVersion: 1;
	readonly artifact: 'terminay-server';
	readonly target: string;
	readonly channel: ReleaseChannel;
	readonly revision: string;
	readonly architecture: Architecture;
	readonly version: string;
	readonly entrypoints: Readonly<{ server: string }>;
	readonly files: readonly ManifestFile[];
}

export class ManifestError extends Error {}

function fail(message: string): never {
	throw new ManifestError(`the installed archive is not valid: ${message}`);
}

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/u;

export function parseArchiveManifest(value: unknown): ArchiveManifest {
	if (typeof value !== 'object' || value === null) fail('its manifest is not an object');
	const manifest = value as Record<string, unknown>;
	if (manifest.schemaVersion !== 1) fail('its manifest has an unsupported schema version');
	if (manifest.artifact !== 'terminay-server') fail(`its manifest describes ${String(manifest.artifact)}`);
	for (const field of ['target', 'revision', 'version', 'channel', 'architecture']) {
		if (typeof manifest[field] !== 'string' || (manifest[field] as string).length === 0) fail(`its manifest is missing ${field}`);
	}
	if (!/^[a-f0-9]{40}$/u.test(manifest.revision as string)) fail('its manifest revision is not a commit sha');
	const entrypoints = manifest.entrypoints as Record<string, unknown> | undefined;
	if (typeof entrypoints?.server !== 'string') fail('its manifest names no server entrypoint');
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('its manifest lists no files');
	for (const file of manifest.files) {
		const entry = file as Record<string, unknown>;
		if (typeof entry.path !== 'string' || !SAFE_PATH.test(entry.path)) fail(`its manifest lists an unsafe path: ${String(entry.path)}`);
		if (!/^[a-f0-9]{64}$/u.test(String(entry.sha256))) fail(`its manifest has no digest for ${entry.path}`);
		if (!Number.isSafeInteger(entry.size)) fail(`its manifest has no size for ${entry.path}`);
		if (!/^[0-7]{3}$/u.test(String(entry.mode))) fail(`its manifest has no mode for ${entry.path}`);
	}
	return manifest as unknown as ArchiveManifest;
}

export async function readArchiveManifest(root: string): Promise<ArchiveManifest> {
	const raw = await readFile(join(root, ARCHIVE_MANIFEST), 'utf8').catch(() => undefined);
	if (raw === undefined) fail(`it has no ${ARCHIVE_MANIFEST}`);
	try {
		return parseArchiveManifest(JSON.parse(raw));
	} catch (error) {
		if (error instanceof ManifestError) throw error;
		fail(`its ${ARCHIVE_MANIFEST} is not valid JSON`);
	}
}

async function digest(path: string): Promise<string> {
	const hash = createHash('sha256');
	await pipeline(createReadStream(path), hash);
	return hash.digest('hex');
}

export interface ExpectedRelease {
	readonly channel?: ReleaseChannel;
	readonly architecture?: Architecture;
	readonly version?: string;
	readonly revision?: string;
}

/**
 * Re-hash the unpacked tree against its manifest. Symbolic links are refused
 * outright: the manifest describes regular files, and a link where a file is
 * expected is how an archive escapes its own directory.
 */
export async function validateUnpackedArchive(root: string, expected: ExpectedRelease = {}): Promise<ArchiveManifest> {
	const manifest = await readArchiveManifest(root);
	for (const [field, wanted] of Object.entries(expected)) {
		if (wanted === undefined) continue;
		const actual = (manifest as unknown as Record<string, unknown>)[field];
		if (actual !== wanted) fail(`its manifest records ${field} ${String(actual)}, but ${String(wanted)} was expected`);
	}
	for (const file of manifest.files) {
		const absolute = join(root, file.path);
		const info = await lstat(absolute).catch(() => undefined);
		if (info === undefined) fail(`${file.path} is missing`);
		if (info.isSymbolicLink()) fail(`${file.path} is a symbolic link`);
		if (!info.isFile()) fail(`${file.path} is not a regular file`);
		if (info.size !== file.size) fail(`${file.path} is ${info.size} bytes, but its manifest records ${file.size}`);
		if ((await digest(absolute)) !== file.sha256) fail(`${file.path} does not match the digest its manifest records`);
	}
	const entrypoint = join(root, manifest.entrypoints.server);
	const launcher = await lstat(entrypoint).catch(() => undefined);
	if (launcher === undefined || !launcher.isFile()) fail(`its server entrypoint ${manifest.entrypoints.server} is missing`);
	if ((launcher.mode & 0o111) === 0) fail(`its server entrypoint ${manifest.entrypoints.server} is not executable`);
	return manifest;
}
