import assert from 'node:assert/strict';
import test from 'node:test';
import {
	documentationDocumentReason,
	documentationUnsupportedMessage,
} from './documentationDocumentState.ts';

const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024;

test('documentation document states are distinguishable', () => {
	assert.equal(documentationDocumentReason({ path: 'README.md', size: 12 }), 'ready');
	assert.equal(
		documentationDocumentReason({
			path: 'README.md',
			size: LARGE_FILE_THRESHOLD_BYTES + 1,
		}),
		'too-large',
	);
	assert.equal(documentationDocumentReason({ path: 'README.md', isBinary: true }), 'binary');
	assert.equal(
		documentationDocumentReason({ path: 'README.md', invalidEncoding: true }),
		'invalid-encoding',
	);
	assert.equal(documentationDocumentReason({ path: 'README.md', missing: true }), 'missing');
	assert.equal(
		documentationDocumentReason({ path: 'README.md', authorityAvailable: false }),
		'unavailable',
	);
	assert.equal(
		documentationDocumentReason({ path: 'README.md', parserFailed: true }),
		'parser-failure',
	);
	assert.equal(documentationDocumentReason({ path: 'image.png' }), 'not-markdown');
	for (const reason of [
		'too-large',
		'binary',
		'invalid-encoding',
		'missing',
		'unavailable',
		'parser-failure',
		'not-markdown',
	] as const) {
		assert.match(
			documentationUnsupportedMessage(reason),
			/File Viewer|unavailable|retained|canonical/i,
		);
	}
});
