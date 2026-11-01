import assert from 'node:assert/strict';
import test from 'node:test';
import { BotEngineClient, BotsClient } from '../dist/index.js';
const status = {
	engine: null,
	available: false,
	reason: 'not-installed',
	detail: 'not-installed',
	pinned: null,
	candidates: [
		{
			kind: 'docker',
			address: null,
			available: false,
			reason: 'not-installed',
		},
	],
	runningContainers: 0,
	botContainers: 0,
	image: { state: 'missing', fingerprint: null, builtAt: null, error: null },
};
function transport(value) {
	const calls = [];
	return {
		calls,
		query: async () => value,
		command: async (...args) => {
			calls.push(args);
			return null;
		},
		queryWithBody: async () => {
			const body = Buffer.from(JSON.stringify(value));
			return {
				result: {
					encoding: 'json',
					version: 'stable',
					offset: 0,
					totalBytes: body.length,
				},
				body,
			};
		},
		subscribe: () => () => {},
	};
}
test('engine client validates D2 reasons and bounded counters and sends explicit engine confirmation', async () => {
	const wire = transport(status),
		c = new BotEngineClient(wire);
	assert.deepEqual(await c.status(), status);
	await c.use('podman', 'machine', true);
	assert.deepEqual(wire.calls[0].slice(0, 2), [
		'bots.engine.use',
		{ kind: 'podman', address: 'machine', confirmed: true },
	]);
	for (const invalid of [
		{ reason: 'rootless-docker' },
		{ runningContainers: -1 },
		{ image: { ...status.image, state: 'unknown' } },
		{
			candidates: [
				{ kind: 'remote', address: 'ssh://x', available: true, reason: null },
			],
		},
	])
		await assert.rejects(
			new BotEngineClient(transport({ ...status, ...invalid })).status(),
			/invalid bot engine/,
		);
	let receive;
	wire.subscribe = (_event, listener) => {
		receive = listener;
		return () => {};
	};
	c.watch(() => {});
	assert.throws(
		() => receive({ revision: 1, detail: 'private' }),
		/invalidation/,
	);
});
test('agent and queue facades reject invalid server responses before exposing them', async () => {
	const agent = {
		extensionId: 'fake',
		extensionName: 'Fake extension',
		id: 'fake/agent',
		displayName: 'Fake',
		autonomousOnly: true,
		canLoad: true,
		signInMethods: ['token'],
		deviceSignIn: null,
		status: {
			state: 'not-installed',
			action: { label: 'Build image', kind: 'build-image' },
		},
		models: { available: true, value: [{ id: 'm', displayName: 'M' }] },
	};
	assert.deepEqual(await new BotsClient(transport([agent])).agents(), [agent]);
	for (const patch of [
		{ status: { state: 'other' } },
		{ models: { available: true, value: [{ id: 1, displayName: 'M' }] } },
		{ signInMethods: ['password'] },
		{ canLoad: 'yes' },
	])
		await assert.rejects(
			new BotsClient(transport([{ ...agent, ...patch }])).agents(),
			/invalid bot agent/,
		);
	const queue = {
		botId: 'abc123def456',
		items: [
			{
				id: 'a'.repeat(24),
				kind: 'trigger',
				sessionId: null,
				triggerId: 'trigger',
				triggerName: 'Morning',
				fireTime: 1,
				enqueuedAt: 2,
			},
		],
	};
	assert.deepEqual(
		await new BotsClient(transport(queue)).queue(queue.botId),
		queue,
	);
	await assert.rejects(
		new BotsClient(transport({ ...queue, botId: 'another' })).queue(
			queue.botId,
		),
		/invalid bot queue/,
	);
	await assert.rejects(
		new BotsClient(
			transport({ ...queue, items: [{ ...queue.items[0], id: null }] }),
		).queue(queue.botId),
		/invalid bot queue/,
	);
});
