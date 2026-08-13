import assert from 'node:assert/strict';
import test from 'node:test';
import { requestReleaseNotes } from './release-notes-openrouter.mjs';

test('release notes use the bounded OpenRouter HTTP contract directly', async () => {
	let request;
	const notes = await requestReleaseNotes({
		apiKey: 'test-key',
		instructions: 'Only use this release range.',
		message: 'v1.0.0..v1.0.1',
		fetchImpl: async (url, init) => {
			request = { url, init };
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									'Intro.\n\n## Fixes\n\n### UI\n- Kept context visible.',
							},
						},
					],
				}),
				{ status: 200 },
			);
		},
	});
	assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
	assert.equal(request.init.headers.Authorization, 'Bearer test-key');
	assert.equal(
		JSON.parse(request.init.body).messages[1].content,
		'v1.0.0..v1.0.1',
	);
	assert.match(notes, /## Fixes/);
});

test('release notes reject provider failures and malformed markdown', async () => {
	await assert.rejects(
		requestReleaseNotes({
			apiKey: 'test-key',
			instructions: 'rules',
			message: 'range',
			fetchImpl: async () => new Response('unavailable', { status: 503 }),
		}),
		/HTTP 503/,
	);
	await assert.rejects(
		requestReleaseNotes({
			apiKey: 'test-key',
			instructions: 'rules',
			message: 'range',
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						choices: [{ message: { content: 'not structured markdown' } }],
					}),
					{ status: 200 },
				),
		}),
		/required structure/,
	);
});
