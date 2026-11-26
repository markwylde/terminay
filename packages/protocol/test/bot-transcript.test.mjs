import assert from 'node:assert/strict';
import test from 'node:test';
import { foldTranscript, transcriptTime } from '../dist/index.js';

const T = 1_764_000_000_000;
const chunk = (text, receivedAt, sessionUpdate = 'agent_message_chunk') => ({
	sessionUpdate,
	content: { type: 'text', text },
	receivedAt,
});

test('transcriptTime accepts only integers a Date can represent', () => {
	assert.equal(transcriptTime(T), T);
	assert.equal(transcriptTime(0), 0);
	for (const bad of [
		String(T),
		null,
		undefined,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1e20,
		8.64e15 + 1,
		T + 0.5,
	])
		assert.equal(transcriptTime(bad), undefined, String(bad));
});

test('each entry kind takes the admission time of the update that starts it', () => {
	const items = foldTranscript([
		{ kind: 'user', text: 'go', receivedAt: T },
		chunk('thinking', T + 1000, 'agent_thought_chunk'),
		chunk('Hel', T + 2000),
		chunk('lo', T + 9000),
		{
			sessionUpdate: 'tool_call',
			toolCallId: 'a',
			title: 'Bash',
			status: 'in_progress',
			receivedAt: T + 10_000,
		},
		{
			sessionUpdate: 'tool_call_update',
			toolCallId: 'a',
			status: 'completed',
			receivedAt: T + 50_000,
		},
		{
			sessionUpdate: 'plan',
			entries: [{ content: 'one', status: 'pending' }],
			receivedAt: T + 11_000,
		},
		{
			sessionUpdate: 'plan',
			entries: [{ content: 'one', status: 'completed' }],
			receivedAt: T + 60_000,
		},
		chunk('Done', T + 70_000),
		{ kind: 'permission-request', permission: {}, receivedAt: T + 80_000 },
		{ kind: 'truncated', receivedAt: T + 90_000 },
	]);
	assert.deepEqual(
		items.map((i) => [i.kind, i.at]),
		[
			['user', T],
			['thought', T + 1000],
			['agent', T + 2000],
			['tool', T + 10_000],
			['plan', T + 11_000],
			['agent', T + 70_000],
			['permission', T + 80_000],
			['truncated', T + 90_000],
		],
	);
	assert.equal(items[2].text, 'Hello');
	assert.equal(items[3].status, 'completed');
	assert.equal(items[4].steps[0].status, 'completed');
});

test('updates without a valid admission time fold to entries without one', () => {
	const items = foldTranscript([
		{ kind: 'user', text: 'old' },
		chunk('reply', 'yesterday'),
		{ sessionUpdate: 'tool_call', toolCallId: 'a', receivedAt: 1e20 },
	]);
	assert.equal(items.length, 3);
	for (const item of items) assert.equal('at' in item, false);
});

test('a transcript-item record takes the server time over its own', () => {
	const item = (at) => ({ kind: 'agent', key: 'm1', text: 'hi', at });
	const [stamped] = foldTranscript([
		{ kind: 'transcript-item', item: item(5), receivedAt: T },
	]);
	assert.equal(stamped.at, T);
	const [unstamped] = foldTranscript([
		{ kind: 'transcript-item', item: item(T + 1) },
	]);
	assert.equal(unstamped.at, T + 1);
	const [invalid] = foldTranscript([
		{ kind: 'transcript-item', item: item(Number.NaN) },
	]);
	assert.equal('at' in invalid, false);
});
