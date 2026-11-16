import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parseTerminayHostAction,
	requiredTerminayHostCapability,
	TERMINAY_FILE_SAVE_CHUNK_MAX_BYTES,
} from '../dist/index.js';

const token = 'A'.repeat(32);

test('streamed file saves carry a suggested name, an opaque token and bounded chunks', () => {
	assert.equal(TERMINAY_FILE_SAVE_CHUNK_MAX_BYTES, 1024 * 1024);
	assert.deepEqual(parseTerminayHostAction({ type: 'file.save.open', filename: '.env' }), {
		type: 'file.save.open',
		filename: '.env',
	});
	assert.deepEqual(
		parseTerminayHostAction({ type: 'file.save.write', token, bytesBase64: 'AAE=' }),
		{ type: 'file.save.write', token, bytesBase64: 'AAE=' },
	);
	const full = Buffer.alloc(TERMINAY_FILE_SAVE_CHUNK_MAX_BYTES).toString('base64');
	assert.equal(
		parseTerminayHostAction({ type: 'file.save.write', token, bytesBase64: full }).bytesBase64,
		full,
	);
	assert.deepEqual(
		parseTerminayHostAction({ type: 'file.save.close', token, commit: false }),
		{ type: 'file.save.close', token, commit: false },
	);
	for (const type of ['file.save.open', 'file.save.write', 'file.save.close'])
		assert.equal(requiredTerminayHostCapability({ type }), 'osIntegration');
});

test('streamed file saves refuse paths, bad tokens and oversized chunks', () => {
	const oversized = Buffer.alloc(TERMINAY_FILE_SAVE_CHUNK_MAX_BYTES + 1).toString('base64');
	for (const [action, pattern] of [
		[{ type: 'file.save.open', filename: '../etc/passwd' }, /file save name is invalid/u],
		[{ type: 'file.save.open', filename: 'a\\b' }, /file save name is invalid/u],
		[{ type: 'file.save.open', filename: '..' }, /file save name is invalid/u],
		[{ type: 'file.save.open', filename: '' }, /file save name is invalid/u],
		[{ type: 'file.save.open', filename: 'a\nb' }, /file save name is invalid/u],
		[{ type: 'file.save.open', filename: 'x'.repeat(256) }, /file save name is invalid/u],
		[{ type: 'file.save.open', filename: 'a', path: '/tmp' }, /fields are invalid/u],
		[{ type: 'file.save.write', token: 'short', bytesBase64: 'AA==' }, /file save token is invalid/u],
		[{ type: 'file.save.write', token, bytesBase64: oversized }, /file save chunk is invalid/u],
		[{ type: 'file.save.write', token, bytesBase64: '' }, /file save chunk is invalid/u],
		[{ type: 'file.save.write', token, bytesBase64: 'not base64!' }, /file save chunk is invalid/u],
		[{ type: 'file.save.close', token, commit: 'yes' }, /file save commit flag is invalid/u],
	])
		assert.throws(() => parseTerminayHostAction(action), pattern);
});
