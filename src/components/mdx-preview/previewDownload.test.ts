import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertPreviewDownloadSize,
	completePreviewDownload,
	sanitizePreviewFilename,
} from './previewDownload.ts';

test('4.1 and 4.2 sanitize filenames, bound size, expose cancel, and write nothing on cancel', async () => {
	assert.equal(sanitizePreviewFilename('../../etc/passwd'), '.._.._etc_passwd');
	assert.equal(sanitizePreviewFilename(''), 'download');
	assert.throws(() => assertPreviewDownloadSize(0));
	assert.throws(() => assertPreviewDownloadSize(17 * 1024 * 1024));
	const written: string[] = [];
	const cancelled = await completePreviewDownload(
		{ bytes: new Uint8Array([1, 2, 3]), filename: 'diagram.png', mimeType: 'image/png' },
		async () => 'cancelled',
	);
	assert.equal(cancelled, 'cancelled');
	assert.deepEqual(written, []);
	const saved = await completePreviewDownload(
		{ bytes: new Uint8Array([1, 2, 3]), filename: 'diagram.png', mimeType: 'image/png' },
		async (input) => {
			written.push(input.filename);
			return 'saved';
		},
	);
	assert.equal(saved, 'saved');
	assert.deepEqual(written, ['diagram.png']);
	const abort = new AbortController();
	abort.abort();
	assert.equal(
		await completePreviewDownload(
			{ bytes: new Uint8Array([1]), filename: 'a.bin', mimeType: 'application/octet-stream' },
			async () => {
				written.push('should-not-write');
				return 'saved';
			},
			abort.signal,
		),
		'cancelled',
	);
});
