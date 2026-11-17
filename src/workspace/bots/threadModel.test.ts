import assert from 'node:assert/strict';
import test from 'node:test';
import {
	deleteLabel,
	fullMessages,
	observedThrough,
	replyCountLabel,
	threadIsNew,
	visibleStartFailures,
} from './threadModel.ts';

const summary = (lastBotReplySequence: number | null) => ({
	replyCount: 2,
	lastReplyAt: 0,
	lastReplySequence: 9,
	lastBotReplySequence,
	authors: ['user' as const],
});

test('reply count labels', () => {
	assert.equal(replyCountLabel(1), '1 reply');
	assert.equal(replyCountLabel(3), '3 replies');
});

test('a thread is new only for a bot reply past the read position', () => {
	assert.equal(threadIsNew(summary(8), 5), true);
	assert.equal(
		threadIsNew(summary(4), 5),
		false,
		'only the user replied since',
	);
	assert.equal(threadIsNew(summary(null), 0), false, 'user-only thread');
	assert.equal(
		threadIsNew(summary(8), undefined),
		false,
		'no read position yet',
	);
	assert.equal(threadIsNew(undefined, 1), false);
});

test('observed sequence covers roots and their latest replies', () => {
	assert.equal(observedThrough([]), undefined);
	assert.equal(
		observedThrough([
			{ sequence: 3 },
			{ sequence: 5, thread: { ...summary(7), lastReplySequence: 12 } },
			{ sequence: 9 },
		]),
		12,
	);
});

test('start failures hide behind a later started message or a dismissal', () => {
	const failed = {
		author: 'user' as const,
		dispatch: { state: 'failed' as const, executionId: null },
	};
	const started = {
		author: 'user' as const,
		dispatch: { state: 'started' as const, executionId: 'x' },
	};
	const dismissed = {
		author: 'user' as const,
		dispatch: { state: 'failed' as const, executionId: null, dismissed: true },
	};
	const bot = { author: 'bot' as const };
	assert.deepEqual(visibleStartFailures([failed, started]), []);
	assert.deepEqual(visibleStartFailures([started, failed, bot]), [failed]);
	assert.deepEqual(visibleStartFailures([dismissed]), []);
});

test('deleting a root with replies says so', () => {
	assert.equal(
		deleteLabel({ thread: summary(1) }),
		'Delete message and replies',
	);
	assert.equal(deleteLabel({}), 'Delete message');
	assert.equal(deleteLabel({ threadId: 'a'.repeat(24) }), 'Delete message');
});

test('a page skips a message deleted since it was listed but fails on other errors', async () => {
	const fail = (code: string) => Object.assign(new Error(code), { code });
	const client = {
		get: async (_bot: string, id: string) => {
			if (id === 'gone') throw fail('not_found');
			if (id === 'down') throw fail('unavailable');
			return { message: { id }, text: id, nextCursor: null } as never;
		},
	};
	const got = await fullMessages(client, 'b', ['a', 'gone', 'c']);
	assert.deepEqual(
		got.map((m) => m.id),
		['a', 'c'],
	);
	await assert.rejects(fullMessages(client, 'b', ['a', 'down']), /unavailable/);
});

test('not found is read from the code or, across the bridge, the refusal text', async () => {
	const { isNotFound } = await import('./threadModel.ts');
	assert.equal(isNotFound({ code: 'not_found' }), true);
	assert.equal(isNotFound(new Error('Message not found')), true);
	assert.equal(
		isNotFound(new Error('Error invoking remote method: Thread not found')),
		true,
	);
	assert.equal(isNotFound(new Error('Attachment not found')), false);
	assert.equal(isNotFound(new Error('disconnected')), false);
	assert.equal(isNotFound(undefined), false);
});
