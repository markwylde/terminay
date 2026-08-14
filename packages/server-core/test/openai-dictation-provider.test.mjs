import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAiDictationProvider } from '../dist/aiService/index.js';

test('OpenAI dictation keeps the credential inside the server provider callback', async () => {
	const originalFetch = globalThis.fetch;
	let authorization;
	globalThis.fetch = async (_url, options) => {
		authorization = options.headers.Authorization;
		return new Response(JSON.stringify({ text: 'server transcript' }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
	try {
		const provider = new OpenAiDictationProvider();
		const result = await provider.transcribe({
			audio: new Uint8Array([1, 2, 3]),
			language: 'en',
			maxOutputBytes: 1024,
			mimeType: 'audio/wav',
			model: 'gpt-4o-transcribe',
			signal: new AbortController().signal,
			withCredential: async (use) => {
				const secret = new TextEncoder().encode('server-secret');
				try {
					return await use(secret);
				} finally {
					secret.fill(0);
				}
			},
		});
		assert.deepEqual(result, { text: 'server transcript' });
		assert.equal(authorization, 'Bearer server-secret');
	} finally {
		globalThis.fetch = originalFetch;
	}
});
