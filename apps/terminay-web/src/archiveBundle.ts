export {
	extractTerminayArchive,
	parseTerminayArchiveMetadata,
	TERMINAY_ARCHIVE_FORMAT_VERSION,
	TERMINAY_ARCHIVE_METADATA_PATH,
	type ArchiveEntry,
	type ArchiveExtractionLimits,
	type ExtractedTerminayArchive,
	type TerminayArchiveMetadata,
} from '@terminay/ui-bundle/archive';

/** Browser-only gzip decompression. Tar parsing/metadata validation stays in
 * @terminay/ui-bundle so Electron never imports an application package. */
export async function decompressTerminayArchive(
	compressed: Uint8Array,
	maxCompressedBytes = 32 * 1024 * 1024,
	decompressionStream: typeof DecompressionStream | undefined = globalThis.DecompressionStream,
): Promise<Uint8Array> {
	if (!(compressed instanceof Uint8Array)) throw new TypeError('server UI archive bytes are invalid');
	if (compressed.byteLength === 0 || compressed.byteLength > maxCompressedBytes) throw new RangeError('server UI archive exceeds the compressed size limit');
	if (decompressionStream === undefined) throw new Error('This browser cannot decompress the server UI archive.');
	let stream: ReadableStream<Uint8Array>;
	try { stream = new Blob([compressed as unknown as BlobPart]).stream().pipeThrough(new decompressionStream('gzip')) as ReadableStream<Uint8Array>; }
	catch { throw new TypeError('server UI archive gzip stream is invalid'); }
	const reader = stream.getReader(); const chunks: Uint8Array[] = []; let length = 0;
	try {
		for (;;) {
			const result = await reader.read(); if (result.done) break;
			length += result.value.byteLength;
			if (length > 64 * 1024 * 1024) { await reader.cancel('server UI archive expanded size limit'); throw new RangeError('server UI archive exceeds the expanded size limit'); }
			chunks.push(result.value);
		}
	} catch (error) { if (error instanceof RangeError) throw error; throw new TypeError('server UI archive gzip data is invalid'); }
	const expanded = new Uint8Array(length); let at = 0;
	for (const chunk of chunks) { expanded.set(chunk, at); at += chunk.byteLength; }
	return expanded;
}
