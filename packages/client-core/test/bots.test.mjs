import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_OPERATIONS as op } from '@terminay/protocol';
import { BotsClient } from '../dist/index.js';

const profile = {
	id: 'abc123def456',
	name: 'Bird',
	agentId: 'fake.agent',
	approvalMode: 'autonomous',
};
function transport(value) {
	const calls = [];
	return {
		calls,
		queryWithBody: async (operation, payload) => {
			calls.push({ operation, payload });
			const body = new TextEncoder().encode(JSON.stringify(value));
			return {
				result: {
					encoding: 'json',
					offset: 0,
					version: 'stable',
					totalBytes: body.byteLength,
				},
				body,
			};
		},
		command: async () => null,
		commandWithBody: async () => ({ botId: profile.id }),
		subscribe: () => () => {},
	};
}
test('bots facade validates fetched records and sends profiles and memory edits through binary bodies', async () => {
	const wire = transport(profile);
	const calls = [];
	wire.commandWithBody = async (...args) => {
		calls.push(args);
		return { botId: profile.id };
	};
	const client = new BotsClient(wire);
	assert.deepEqual(
		await client.save({ name: 'Bird', agentId: 'fake.agent' }),
		profile,
	);
	assert.equal(calls[0][0], op.save);
	assert.equal(JSON.parse(new TextDecoder().decode(calls[0][2])).name, 'Bird');
	await client.writeMemory(profile.id, 'note.md', 'x'.repeat(100000));
	assert.equal(calls[1][0], op.writeMemory);
	assert.equal(calls[1][2].byteLength, 100000);
});
test('bots facade rejects malformed page metadata and content-bearing invalidations', async () => {
	const wire = transport(profile);
	wire.queryWithBody = async () => ({
		result: { encoding: 'json', offset: 5, totalBytes: 5, version: 'v' },
		body: new Uint8Array([1]),
	});
	const client = new BotsClient(wire);
	await assert.rejects(client.get(profile.id), /invalid bot response page/);
	let callback;
	wire.subscribe = (_event, listener) => {
		callback = listener;
		return () => {};
	};
	client.watch(() => {});
	assert.throws(
		() => callback({ botId: profile.id, revision: 1, transcript: 'secret' }),
		/invalidation/,
	);
});

test('trigger facade rejects malformed definitions, outcomes and upcoming cursors', async () => {
	for (const [value, read] of [
		[
			{ revision: 1, triggers: [{ id: 'invalid' }] },
			(c) => c.triggers(profile.id),
		],
		[
			[
				{
					id: 'f',
					triggerId: 't',
					firedAt: 1,
					outcome: 'unknown',
					reason: null,
				},
			],
			(c) => c.triggerFirings(profile.id),
		],
		[
			{ firings: [], next: { at: 'tomorrow', triggerId: 't' } },
			(c) => c.upcomingTriggers(profile.id, 0, 100),
		],
		[
			[1, 2, 'tomorrow'],
			(c) =>
				c.previewTrigger(profile.id, { kind: 'every', intervalMs: 300000 }),
		],
	])
		await assert.rejects(read(new BotsClient(transport(value))), /invalid/);
});
