export const PREVIEW_DOWNLOAD_LIMITS = Object.freeze({
	maxBytes: 16 * 1024 * 1024,
	maxFilename: 128,
});

export function sanitizePreviewFilename(value: string): string {
	const result = [...value]
		.map((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || /[\\/:*?"<>|]/u.test(character) ? '_' : character;
		})
		.join('')
		.trim()
		.slice(0, PREVIEW_DOWNLOAD_LIMITS.maxFilename);
	return result.length > 0 ? result : 'download';
}

export function assertPreviewDownloadSize(byteLength: number): void {
	if (
		!Number.isSafeInteger(byteLength) ||
		byteLength < 1 ||
		byteLength > PREVIEW_DOWNLOAD_LIMITS.maxBytes
	)
		throw new Error('Preview downloads are limited to 16 MiB.');
}

export interface PreviewDownloadRequest {
	readonly bytes: Uint8Array;
	readonly filename: string;
	readonly mimeType: string;
}

export async function completePreviewDownload(
	request: PreviewDownloadRequest,
	save: (input: {
		readonly bytes: Uint8Array;
		readonly filename: string;
		readonly mimeType: string;
	}) => Promise<'saved' | 'cancelled'>,
	signal?: AbortSignal,
): Promise<'saved' | 'cancelled'> {
	if (signal?.aborted === true) return 'cancelled';
	assertPreviewDownloadSize(request.bytes.byteLength);
	const filename = sanitizePreviewFilename(request.filename);
	const result = await save({
		bytes: request.bytes,
		filename,
		mimeType: request.mimeType || 'application/octet-stream',
	});
	if (signal?.aborted === true) return 'cancelled';
	return result;
}
