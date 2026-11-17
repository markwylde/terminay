import assert from 'node:assert/strict';
import test from 'node:test';
import { BotMessagesClient } from '../dist/index.js';

const base = {
	id: 'a'.repeat(24),
	botId: 'abc123def456',
	sequence: 1,
	revision: 1,
	author: 'bot',
	executionId: 'b'.repeat(24),
	createdAt: 1,
	updatedAt: 1,
	excerpt: 'Opened a terminal',
	textBytes: 17,
	attachmentCount: 0,
};
const client = (value) =>
	new BotMessagesClient({
		query: async () => value,
		command: async () => value,
	});

test('list keeps valid actions and plain posts, and drops malformed actions', async () => {
	const valid = {
		...base,
		activity: {
			tool: 'open_terminal',
			outcome: 'done',
			count: 2,
			target: { kind: 'terminal', projectId: 'project-a', sessionId: 's-1' },
		},
	};
	const malformed = {
		...base,
		id: 'c'.repeat(24),
		activity: { tool: 'open_terminal', outcome: 'maybe', count: 1 },
	};
	const badTarget = {
		...base,
		id: 'd'.repeat(24),
		activity: {
			tool: 'x',
			outcome: 'done',
			count: 1,
			target: { kind: 'project', projectId: '../etc' },
		},
	};
	const post = { ...base, id: 'e'.repeat(24) };
	const page = await client({
		items: [valid, malformed, badTarget, post],
		nextCursor: null,
		eventsCursor: 'c',
		total: 4,
		truncated: false,
	}).list(base.botId);
	assert.deepEqual(
		page.items.map((m) => m.id),
		[valid.id, post.id],
	);
	assert.deepEqual(page.items[0].activity, valid.activity);
	assert.equal(page.items[1].activity, undefined);
});

test('detail refuses a malformed action rather than showing it as a post', async () => {
	const detail = (activity) => ({
		message: { ...base, attachments: [], activity },
		text: 'x',
		nextCursor: null,
		truncated: false,
	});
	await assert.rejects(
		client(detail({ tool: 'x', outcome: 'done', count: 0 })).get(
			base.botId,
			base.id,
		),
		/action/,
	);
	const ok = await client(
		detail({ tool: 'x', outcome: 'failed', reason: 'nope', count: 1 }),
	).get(base.botId, base.id);
	assert.equal(ok.message.activity.reason, 'nope');
});
