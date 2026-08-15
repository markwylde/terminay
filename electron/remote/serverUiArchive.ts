import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/** The immutable server UI archive carried on the authenticated WebRTC lane. */
export type ServerUiArchive = Readonly<{
	archiveFormatVersion: 1;
	bundleId: string;
	bytes: Buffer;
	compressedBytes: number;
	entryPath: string;
}>;

export const SERVER_UI_ARCHIVE_FORMAT_VERSION = 1 as const;
export const SERVER_UI_ARCHIVE_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
export const SERVER_UI_ARCHIVE_MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
export const SERVER_UI_ARCHIVE_MAX_ENTRIES = 10_000;
export const SERVER_UI_ARCHIVE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;

type ArchiveInput = Readonly<{
	entryPath: string;
	protocolVersion: string;
	publicDirectory?: string;
	rendererDirectory: string;
}>;

type ArchiveFile = Readonly<{ bytes: Buffer; path: string }>;

/**
 * Build a deterministic gzip-compressed ustar bundle from the server-owned UI.
 * The bytes are immutable and intended to be cached by RemoteAccessService for
 * the lifetime of the built renderer artifact.
 */
export async function buildServerUiArchive(input: ArchiveInput): Promise<ServerUiArchive> {
	if (!isSafeRelativePath(input.entryPath)) throw new TypeError('Server UI archive entry path is invalid.');
	if (!/^[A-Za-z0-9._-]{1,64}$/u.test(input.protocolVersion)) {
		throw new TypeError('Server UI archive protocol version is invalid.');
	}
	const files = await collectFiles(input.rendererDirectory, input.publicDirectory);
	if (!files.some((file) => file.path === input.entryPath)) {
		throw new Error(`Server UI archive entry ${input.entryPath} is missing.`);
	}
	const bundleId = deriveBundleId(files, input.entryPath, input.protocolVersion);
	const metadata = Buffer.from(
		JSON.stringify({
			applicationProtocolVersion: input.protocolVersion,
			archiveFormatVersion: SERVER_UI_ARCHIVE_FORMAT_VERSION,
			bundleId,
			entryPath: input.entryPath,
		}),
		'utf8',
	);
	const archive = createTar([
		{ bytes: metadata, path: 'terminay-bundle.json' },
		...files,
	]);
	if (archive.byteLength > SERVER_UI_ARCHIVE_MAX_EXPANDED_BYTES) {
		throw new RangeError('Server UI archive exceeds the expanded size limit.');
	}
	// Node writes a deterministic gzip header for this API; the tar payload has
	// no timestamps or ownership values, so equal built input yields equal bytes.
	const bytes = gzipSync(archive);
	if (bytes.byteLength > SERVER_UI_ARCHIVE_MAX_COMPRESSED_BYTES) {
		throw new RangeError('Server UI archive exceeds the compressed size limit.');
	}
	return Object.freeze({
		archiveFormatVersion: SERVER_UI_ARCHIVE_FORMAT_VERSION,
		bundleId,
		bytes: Buffer.from(bytes),
		compressedBytes: bytes.byteLength,
		entryPath: input.entryPath,
	});
}

async function collectFiles(rendererDirectory: string, publicDirectory?: string): Promise<readonly ArchiveFile[]> {
	const roots = [
		{ directory: rendererDirectory, required: true },
		...(publicDirectory === undefined || path.resolve(publicDirectory) === path.resolve(rendererDirectory)
			? []
			: [{ directory: publicDirectory, required: false }]),
	];
	const files = new Map<string, ArchiveFile>();
	let expandedBytes = 0;
	for (const root of roots) {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(root.directory, { recursive: true, withFileTypes: true, encoding: 'utf8' });
		} catch (error) {
			if (!root.required && isMissingDirectory(error)) continue;
			throw error;
		}
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const relative = entry.parentPath === undefined
				? entry.name
				: path.relative(root.directory, path.join(entry.parentPath, entry.name));
			const normalized = relative.split(path.sep).join('/');
			if (!isSafeRelativePath(normalized) || normalized.endsWith('.map')) continue;
			if (files.has(normalized)) continue;
			if (files.size >= SERVER_UI_ARCHIVE_MAX_ENTRIES - 1) {
				throw new RangeError('Server UI archive contains too many entries.');
			}
			const bytes = await fs.readFile(path.join(root.directory, relative));
			if (bytes.byteLength > SERVER_UI_ARCHIVE_MAX_ENTRY_BYTES) {
				throw new RangeError(`Server UI archive entry ${normalized} exceeds the size limit.`);
			}
			expandedBytes += bytes.byteLength;
			if (expandedBytes > SERVER_UI_ARCHIVE_MAX_EXPANDED_BYTES) {
				throw new RangeError('Server UI archive exceeds the expanded size limit.');
			}
			files.set(normalized, Object.freeze({ bytes, path: normalized }));
		}
	}
	return Object.freeze([...files.values()].sort((left, right) => left.path.localeCompare(right.path)));
}

function deriveBundleId(files: readonly ArchiveFile[], entryPath: string, protocolVersion: string): string {
	const hash = createHash('sha256');
	hash.update(`terminay-server-ui-archive\0${SERVER_UI_ARCHIVE_FORMAT_VERSION}\0${protocolVersion}\0${entryPath}\0`);
	for (const file of files) {
		hash.update(file.path);
		hash.update('\0');
		hash.update(file.bytes);
		hash.update('\0');
	}
	return hash.digest('base64url');
}

function createTar(files: readonly ArchiveFile[]): Buffer {
	const output: Buffer[] = [];
	for (const file of files) {
		if (!isSafeRelativePath(file.path)) throw new TypeError('Server UI archive path is invalid.');
		const header = Buffer.alloc(512);
		writeTarPath(header, file.path);
		writeTarText(header, 100, 8, '0000644\0');
		writeTarText(header, 108, 8, '0000000\0');
		writeTarText(header, 116, 8, '0000000\0');
		writeTarNumber(header, 124, 12, file.bytes.byteLength);
		writeTarText(header, 136, 12, '00000000000\0');
		header.fill(0x20, 148, 156);
		header[156] = 0x30;
		writeTarText(header, 257, 6, 'ustar\0');
		writeTarText(header, 263, 2, '00');
		writeTarText(header, 329, 8, '0000000\0');
		writeTarText(header, 337, 8, '0000000\0');
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
		output.push(header, file.bytes);
		const padding = (512 - (file.bytes.byteLength % 512)) % 512;
		if (padding > 0) output.push(Buffer.alloc(padding));
	}
	output.push(Buffer.alloc(1024));
	return Buffer.concat(output);
}

function writeTarPath(header: Buffer, value: string): void {
	const encoded = Buffer.from(value, 'utf8');
	if (encoded.byteLength <= 100) {
		encoded.copy(header, 0);
		return;
	}
	const separator = value.lastIndexOf('/');
	if (separator < 1) throw new RangeError('Server UI archive path is too long.');
	const prefix = Buffer.from(value.slice(0, separator), 'utf8');
	const name = Buffer.from(value.slice(separator + 1), 'utf8');
	if (prefix.byteLength > 155 || name.byteLength > 100) {
		throw new RangeError('Server UI archive path is too long.');
	}
	name.copy(header, 0);
	prefix.copy(header, 345);
}

function writeTarNumber(header: Buffer, offset: number, length: number, value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Server UI archive size is invalid.');
	writeTarText(header, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function writeTarText(header: Buffer, offset: number, length: number, value: string): void {
	const encoded = Buffer.from(value, 'ascii');
	if (encoded.byteLength > length) throw new RangeError('Server UI archive tar header field is too long.');
	encoded.copy(header, offset);
}

function isMissingDirectory(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isSafeRelativePath(value: string): boolean {
	return value.length > 0 &&
		value.length <= 4096 &&
		!value.includes('\\') &&
		!value.includes('\0') &&
		!value.startsWith('/') &&
		!value.split('/').some((part) => part.length === 0 || part === '.' || part === '..');
}
