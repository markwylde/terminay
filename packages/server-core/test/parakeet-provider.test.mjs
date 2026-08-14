import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';
import { AiServiceError, SERVER_PARAKEET_MODEL, ServerParakeetDictationProvider } from '../dist/index.js';

test('selected-server Parakeet provider owns and removes its bounded input file', async () => {
	let inputPath;
	const provider = new ServerParakeetDictationProvider({
		async transcribe(path) {
			inputPath = path;
			assert.equal((await stat(path)).isFile(), true);
			return 'server transcript';
		},
	});
	const result = await provider.transcribe({
		model: SERVER_PARAKEET_MODEL,
		mimeType: 'audio/webm;codecs=opus',
		audio: new Uint8Array([1, 2, 3]),
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
	});
	assert.equal(result, 'server transcript');
	assert.match(inputPath, /terminay-parakeet-input-/u);
	await assert.rejects(stat(inputPath), /ENOENT/u);
});

test('selected-server Parakeet provider rejects model changes and cleans failures', async () => {
	let failedPath;
	const provider = new ServerParakeetDictationProvider({
		async transcribe(path) { failedPath = path; throw new Error('worker failed'); },
	});
	const request = {
		model: SERVER_PARAKEET_MODEL,
		mimeType: 'audio/wav',
		audio: new Uint8Array([1]),
		signal: new AbortController().signal,
		maxOutputBytes: 1024,
	};
	await assert.rejects(provider.transcribe({ ...request, model: 'mutable/model' }), (error) => error instanceof AiServiceError && error.code === 'invalid_request');
	await assert.rejects(provider.transcribe(request), /worker failed/u);
	await assert.rejects(stat(failedPath), /ENOENT/u);
});
