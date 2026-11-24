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

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import selfsigned from 'selfsigned';
import { DictationService, OpenAiCompatibleDictationProvider, ServerDictationProvider, createDictationCredentials, serverDictationSettings } from '../dist/aiService/index.js';

const customRequest = (overrides = {}) => ({
	provider: 'openai-compatible', audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav', model: 'profile:custom', signal: new AbortController().signal, maxOutputBytes: 1024, ...overrides,
});
async function serve(t, handler, tls) {
	const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => { server.closeAllConnections(); server.close(); });
	return `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}/sherpaonnx/v1/audio/transcriptions`;
}

test('custom multipart transcription preserves endpoint/model and optional Bearer authentication', async (t) => {
	const received = [];
	const endpointUrl = await serve(t, async (req, res) => {
		const chunks = []; for await (const chunk of req) chunks.push(chunk);
		const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
		received.push({ url: req.url, key: req.headers.authorization, model: form.get('model'), format: form.get('response_format'), file: form.get('file'), language: form.get('language'), prompt: form.get('prompt') });
		res.end(JSON.stringify({ text: 'custom transcript' }));
	});
	const provider = new ServerDictationProvider({ transcribe: () => { throw new Error('must not route by model'); } });
	assert.deepEqual(await provider.transcribe(customRequest({ endpointUrl, language: 'en', prompt: 'terms' })), { text: 'custom transcript' });
	await provider.transcribe(customRequest({ endpointUrl, model: 'mlx-community/parakeet-tdt-0.6b-v3', withCredential: (use) => use(new TextEncoder().encode('custom-secret')) }));
	assert.equal(received[0].url, '/sherpaonnx/v1/audio/transcriptions');
	assert.equal(received[0].key, undefined);
	assert.equal(received[0].model, 'profile:custom');
	assert.equal(received[0].format, 'json');
	assert.equal(received[0].language, 'en'); assert.equal(received[0].prompt, 'terms');
	assert.equal(received[0].file.name, 'dictation.wav');
	assert.deepEqual([...new Uint8Array(await received[0].file.arrayBuffer())], [1, 2, 3]);
	assert.equal(received[1].key, 'Bearer custom-secret');
	assert.equal(received[1].model, 'mlx-community/parakeet-tdt-0.6b-v3');
});

test('self-signed TLS is rejected by default and bypass stays request-local', async (t) => {
	const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048 });
	const endpointUrl = await serve(t, (_req, res) => res.end('{"text":"TLS transcript"}'), { key: cert.private, cert: cert.cert });
	const provider = new OpenAiCompatibleDictationProvider();
	const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
	await assert.rejects(provider.transcribe(customRequest({ endpointUrl })), /Custom transcription request failed/);
	assert.deepEqual(await provider.transcribe(customRequest({ endpointUrl, bypassTlsVerification: true })), { text: 'TLS transcript' });
	await assert.rejects(provider.transcribe(customRequest({ endpointUrl })), /Custom transcription request failed/);
	assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, before);
});

test('custom transport rejects unsafe URLs, redirects, malformed and oversized responses', async (t) => {
	const provider = new OpenAiCompatibleDictationProvider();
	for (const endpointUrl of ['', 'file:///etc/passwd', 'https://key:secret@host/stt', 'https://host/stt?api_key=secret', 'https://host/stt#fragment']) {
		await assert.rejects(provider.transcribe(customRequest({ endpointUrl })), /full HTTP/);
	}
	let followups = 0;
	const endpointUrl = await serve(t, (req, res) => { if (req.url === '/follow') followups++; res.writeHead(307, { location: '/follow' }); res.end(); });
	await assert.rejects(provider.transcribe(customRequest({ endpointUrl })), /Custom transcription request failed/);
	assert.equal(followups, 0);
	for (const body of ['not json', '{"other":"field"}', '{"text":null}']) {
		const url = await serve(t, (_req, res) => res.end(body));
		await assert.rejects(provider.transcribe(customRequest({ endpointUrl: url })), /Custom transcription request failed/);
	}
	const large = await serve(t, (_req, res) => { res.write('{"text":"'); res.write('x'.repeat(2048)); res.end('"}'); });
	await assert.rejects(provider.transcribe(customRequest({ endpointUrl: large })), (e) => e.code === 'audio_output_too_large');
});

test('custom transport cancellation terminates stalled upload and response work', async (t) => {
	for (const phase of ['upload', 'response']) {
		let accepted;
		const ready = new Promise((resolve) => { accepted = resolve; });
		let closed;
		const disconnected = new Promise((resolve) => { closed = resolve; });
		const endpointUrl = await serve(t, (req, res) => {
			res.on('close', closed); req.on('aborted', closed); req.resume();
			if (phase === 'response') { req.resume(); res.writeHead(200); res.write('{"text":"'); }
			accepted();
		});
		const controller = new AbortController();
		const pending = new OpenAiCompatibleDictationProvider().transcribe(customRequest({ endpointUrl, signal: controller.signal, ...(phase === 'upload' ? { audio: new Uint8Array(8 * 1024 * 1024) } : {}) }));
		await ready; controller.abort();
		await assert.rejects(pending);
		await disconnected;
	}
});

test('custom credentials remain isolated, optional only when absent, and explicitly targeted', async () => {
	const entries = new Map([['dictation-openai-api-key', new TextEncoder().encode('openai-secret')]]);
	let fail = false;
	const vault = {
		status: () => ({ state: 'unlocked', entries: [...entries.keys()].map((id) => ({ id })) }),
		put: async ({ id, value }) => { entries.set(id, value); },
		replace: async ({ id, value }) => { entries.set(id, value); },
		remove: async (id) => { entries.delete(id); },
		withSecret: async (id, use) => { if (fail || !entries.has(id)) throw new Error('vault-secret-sentinel'); return use(entries.get(id)); },
	};
	const credentials = createDictationCredentials(vault);
	assert.equal(await credentials.withCredential('openai-compatible', (value) => value.byteLength), 0);
	const key = new TextEncoder().encode('custom-secret');
	await credentials.set(key, 'openai-compatible');
	assert.deepEqual(credentials.status('openai-compatible'), { configured: true });
	assert.equal(await credentials.withCredential('openai-compatible', (value) => new TextDecoder().decode(value)), 'custom-secret');
	fail = true;
	await assert.rejects(credentials.withCredential('openai-compatible', () => assert.fail()), (error) => !error.message.includes('sentinel'));
	await credentials.clear('openai-compatible');
	assert.equal(new TextDecoder().decode(entries.get('dictation-openai-api-key')), 'openai-secret');
	assert.throws(() => credentials.status('parakeet'), /Invalid/);
	assert.deepEqual(credentials.status(), { configured: true });
});

test('a service deadline closes a stalled custom HTTP response without insertion', async (t) => {
	let closed;
	let contacted = false;
	const disconnected = new Promise((resolve) => { closed = resolve; });
	const endpointUrl = await serve(t, (req, res) => {
		contacted = true;
		req.resume();
		res.on('close', closed);
		res.writeHead(200);
		res.write('{"text":"');
	});
	const target = { serverId: 'server-a', projectId: 'project-a', panelId: 'panel-a', sessionId: 'session-a' };
	const settings = { enabled: true, provider: 'openai-compatible', endpointUrl, model: 'profile:custom', bypassTlsVerification: false };
	const inserted = [];
	const service = new DictationService({
		serverId: target.serverId,
		settings,
		authority: { getTarget: () => ({ ...target, live: true }), writeInput: (_target, text) => { inserted.push(text); } },
		provider: new OpenAiCompatibleDictationProvider(),
	});
	await assert.rejects(service.transcribe({
		requestId: 'stalled-http', clientId: 'client-a', target,
		audio: new Uint8Array([1]), mimeType: 'audio/wav', deadlineMs: 250,
		expectedConfiguration: JSON.stringify([settings.provider, endpointUrl, settings.model, false]),
	}), (error) => error.code === 'audio_timeout');
	assert.equal(contacted, true);
	await disconnected;
	assert.deepEqual(inserted, []);
});

test('server dictation configuration enables explicit providers and retains arbitrary custom model', () => {
	const value = serverDictationSettings({ dictation: { enabled: true, provider: 'openai-compatible', endpointUrl: ' https://custom/stt ', customModel: ' profile:custom ', bypassTlsVerification: true } });
	assert.equal(value.provider, 'openai-compatible'); assert.equal(value.model, 'profile:custom'); assert.equal(value.endpointUrl, 'https://custom/stt'); assert.equal(value.bypassTlsVerification, true);
	assert.equal(serverDictationSettings({ dictation: { provider: 'openai' } }).provider, 'openai');
	assert.equal(serverDictationSettings({ dictation: { provider: 'parakeet' } }).model, 'mlx-community/parakeet-tdt-0.6b-v3');
});
