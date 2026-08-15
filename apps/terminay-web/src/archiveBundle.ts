/**
 * Protocol-blind server UI archive handling.  The authenticated server owns
 * the bytes and the entry document; the host only enforces extraction bounds
 * before placing files beneath its own isolated origin/cache namespace.
 */
export const TERMINAY_ARCHIVE_METADATA_PATH = 'terminay-bundle.json';
export const TERMINAY_ARCHIVE_FORMAT_VERSION = 1;

const BUNDLE_ID = /^[A-Za-z0-9_-]{8,128}$/u;
const PROTOCOL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;

export interface TerminayArchiveMetadata {
	readonly archiveFormatVersion: 1;
	readonly bundleId: string;
	readonly entryPath: string;
	readonly applicationProtocolVersion: string;
}

export interface ArchiveEntry {
	readonly path: string;
	readonly bytes: Uint8Array;
}

export interface ExtractedTerminayArchive {
	readonly metadata: TerminayArchiveMetadata;
	readonly entries: readonly ArchiveEntry[];
}

export interface ArchiveExtractionLimits {
	readonly maxEntries?: number;
	readonly maxEntryBytes?: number;
	readonly maxExpandedBytes?: number;
	readonly maxPathBytes?: number;
}

const DEFAULT_LIMITS: Required<ArchiveExtractionLimits> = Object.freeze({
	maxEntries: 1_024,
	maxEntryBytes: 16 * 1024 * 1024,
	maxExpandedBytes: 64 * 1024 * 1024,
	maxPathBytes: 512,
});

/** Parse one already-decompressed POSIX tar archive.  Deliberately reject
 * extensions (PAX/GNU long names included): bundle filenames are bounded and
 * an unsupported archive must not silently change path semantics. */
export function extractTerminayArchive(
	archive: Uint8Array,
	limitsInput: ArchiveExtractionLimits = {},
): ExtractedTerminayArchive {
	const limits = resolveLimits(limitsInput);
	const entries: ArchiveEntry[] = [];
	const seen = new Set<string>();
	let offset = 0;
	let expanded = 0;
	while (offset < archive.byteLength) {
		if (archive.byteLength - offset < 512)
			throw new TypeError('server UI archive has a truncated tar header');
		const header = archive.subarray(offset, offset + 512);
		if (allZero(header)) {
			if (archive.byteLength - offset < 1_024 || !allZero(archive.subarray(offset + 512, offset + 1_024)))
				throw new TypeError('server UI archive has an invalid tar terminator');
			if (offset + 1_024 !== archive.byteLength)
				throw new TypeError('server UI archive has trailing bytes');
			offset += 1_024;
			break;
		}
		const name = tarString(header.subarray(0, 100));
		const prefix = tarString(header.subarray(345, 500));
		const path = normalizeArchivePath(prefix ? `${prefix}/${name}` : name, limits);
		const type = header[156] ?? 0;
		if (type === 53) { // directory
			if (path === TERMINAY_ARCHIVE_METADATA_PATH)
				throw new TypeError('server UI archive metadata must be a regular file');
			offset += 512;
			continue;
		}
		if (type !== 0 && type !== 48)
			throw new TypeError('server UI archive may contain only regular files');
		const size = tarOctal(header.subarray(124, 136));
		if (size > limits.maxEntryBytes)
			throw new RangeError('server UI archive entry exceeds the size limit');
		expanded += size;
		if (expanded > limits.maxExpandedBytes)
			throw new RangeError('server UI archive exceeds the expanded size limit');
		const bodyStart = offset + 512;
		const padded = Math.ceil(size / 512) * 512;
		if (bodyStart + padded > archive.byteLength)
			throw new TypeError('server UI archive has a truncated entry');
		if (seen.has(path)) throw new TypeError('server UI archive has duplicate paths');
		if (entries.length >= limits.maxEntries)
			throw new RangeError('server UI archive exceeds the entry limit');
		seen.add(path);
		entries.push(Object.freeze({ path, bytes: Uint8Array.from(archive.subarray(bodyStart, bodyStart + size)) }));
		offset = bodyStart + padded;
	}
	if (offset !== archive.byteLength)
		throw new TypeError('server UI archive has no tar terminator');
	const metadataEntry = entries.find((entry) => entry.path === TERMINAY_ARCHIVE_METADATA_PATH);
	if (metadataEntry === undefined)
		throw new TypeError('server UI archive metadata is missing');
	let metadataValue: unknown;
	try { metadataValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataEntry.bytes)); }
	catch { throw new TypeError('server UI archive metadata is invalid JSON'); }
	const metadata = parseTerminayArchiveMetadata(metadataValue, limits);
	if (!seen.has(metadata.entryPath))
		throw new TypeError('server UI archive entry is missing');
	return Object.freeze({ metadata, entries: Object.freeze(entries) });
}

export function parseTerminayArchiveMetadata(
	value: unknown,
	limitsInput: ArchiveExtractionLimits = {},
): TerminayArchiveMetadata {
	const limits = resolveLimits(limitsInput);
	if (!record(value) || Object.keys(value).sort().join('|') !== 'applicationProtocolVersion|archiveFormatVersion|bundleId|entryPath')
		throw new TypeError('server UI archive metadata is invalid');
	if (value.archiveFormatVersion !== TERMINAY_ARCHIVE_FORMAT_VERSION)
		throw new TypeError('server UI archive format is unsupported');
	if (typeof value.bundleId !== 'string' || !BUNDLE_ID.test(value.bundleId))
		throw new TypeError('server UI archive bundle id is invalid');
	if (typeof value.applicationProtocolVersion !== 'string' || !PROTOCOL_VERSION.test(value.applicationProtocolVersion))
		throw new TypeError('server UI archive application protocol version is invalid');
	const entryPath = normalizeArchivePath(value.entryPath, limits);
	if (entryPath === TERMINAY_ARCHIVE_METADATA_PATH)
		throw new TypeError('server UI archive metadata cannot be the entry');
	return Object.freeze({
		archiveFormatVersion: TERMINAY_ARCHIVE_FORMAT_VERSION,
		bundleId: value.bundleId,
		entryPath,
		applicationProtocolVersion: value.applicationProtocolVersion,
	});
}

export async function decompressTerminayArchive(
	compressed: Uint8Array,
	maxCompressedBytes = 32 * 1024 * 1024,
	decompressionStream: typeof DecompressionStream | undefined = globalThis.DecompressionStream,
): Promise<Uint8Array> {
	if (!(compressed instanceof Uint8Array)) throw new TypeError('server UI archive bytes are invalid');
	if (compressed.byteLength === 0 || compressed.byteLength > maxCompressedBytes)
		throw new RangeError('server UI archive exceeds the compressed size limit');
	if (decompressionStream === undefined)
		throw new Error('This browser cannot decompress the server UI archive.');
	let stream: ReadableStream<Uint8Array>;
	try {
		stream = new Blob([compressed as unknown as BlobPart]).stream()
			.pipeThrough(new decompressionStream('gzip')) as ReadableStream<Uint8Array>;
	} catch { throw new TypeError('server UI archive gzip stream is invalid'); }
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const result = await reader.read();
			if (result.done) break;
			const bytes = result.value;
			length += bytes.byteLength;
			if (length > 64 * 1024 * 1024) {
				await reader.cancel('server UI archive expanded size limit');
				throw new RangeError('server UI archive exceeds the expanded size limit');
			}
			chunks.push(bytes);
		}
	} catch (error) {
		if (error instanceof RangeError) throw error;
		throw new TypeError('server UI archive gzip data is invalid');
	}
	const expanded = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) { expanded.set(chunk, at); at += chunk.byteLength; }
	return expanded;
}

function resolveLimits(input: ArchiveExtractionLimits): Required<ArchiveExtractionLimits> {
	const resolved = { ...DEFAULT_LIMITS, ...input };
	for (const value of Object.values(resolved)) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('server UI archive limits are invalid');
	return resolved;
}

function normalizeArchivePath(value: unknown, limits: Required<ArchiveExtractionLimits>): string {
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > limits.maxPathBytes || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0'))
		throw new TypeError('server UI archive path is unsafe');
	const segments = value.split('/');
	if (segments.some((segment) => !segment || segment === '.' || segment === '..'))
		throw new TypeError('server UI archive path is unsafe');
	return value;
}

function tarString(value: Uint8Array): string {
	const zero = value.indexOf(0);
	const bytes = zero === -1 ? value : value.subarray(0, zero);
	try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
	catch { throw new TypeError('server UI archive header text is invalid'); }
}

function tarOctal(value: Uint8Array): number {
	const text = tarString(value).trim();
	if (!/^[0-7]+$/u.test(text)) throw new TypeError('server UI archive entry size is invalid');
	const size = Number.parseInt(text, 8);
	if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('server UI archive entry size is invalid');
	return size;
}

function allZero(value: Uint8Array): boolean { return value.every((byte) => byte === 0); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
