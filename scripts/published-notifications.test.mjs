import assert from 'node:assert/strict';
import test from 'node:test';
import { publishedNotificationItems } from '../src/workspace/publishedNotifications.ts';

function entry(title, overrides = {}) {
	return {
		color: '#888',
		emoji: '',
		isAgentStatus: false,
		kind: 'terminal',
		panelId: `panel-${title}`,
		projectEmoji: '',
		projectId: 'project-1',
		projectTitle: 'Alpha',
		sessionId: `session-${title}`,
		status: 'idle',
		title,
		...overrides,
	};
}

function record(id, title, kind, overrides = {}) {
	return {
		id,
		projectId: 'project-1',
		sessionId: `session-${title}`,
		source: kind === 'message' ? 'message' : 'activity',
		kind,
		raisedAt: 1_000,
		...overrides,
	};
}

function snapshot(...records) {
	return {
		revision: records.length,
		cursor: String(records.length),
		notifications: Object.fromEntries(
			records.map((item) => [item.id, item]),
		),
	};
}

test('each published notification is listed with the terminal it belongs to', () => {
	const items = publishedNotificationItems(
		snapshot(record('n-1', 'build', 'agent-finished', { raisedAt: 42 })),
		[entry('build', { color: '#123456', emoji: 'B', projectEmoji: 'P' })],
	);
	assert.deepEqual(items, [
		{
			color: '#123456',
			emoji: 'B',
			isAgentStatus: true,
			notificationId: 'n-1',
			panelId: 'panel-build',
			projectEmoji: 'P',
			projectId: 'project-1',
			projectTitle: 'Alpha',
			sessionId: 'session-build',
			since: 42,
			state: 'done',
			title: 'build',
		},
	]);
});

test('every kind reads as the state its indicator would show', () => {
	const kinds = [
		['agent-waiting', 'waiting', true],
		['agent-blocked', 'blocked', true],
		['agent-finished', 'done', true],
		['command-finished', 'unviewed', false],
		['attention', 'attention', false],
		['message', 'attention', false],
	];
	for (const [kind, state, isAgentStatus] of kinds) {
		const [item] = publishedNotificationItems(
			snapshot(record('n-1', 'a', kind, kind === 'message' ? { body: 'hi' } : {})),
			[entry('a')],
		);
		assert.equal(item.state, state, kind);
		assert.equal(item.isAgentStatus, isAgentStatus, kind);
	}
});

test('attention comes before finished, newest first within each', () => {
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'old-finished', 'command-finished', { raisedAt: 10 }),
			record('n-2', 'new-finished', 'agent-finished', { raisedAt: 50 }),
			record('n-3', 'old-waiting', 'agent-waiting', { raisedAt: 20 }),
			record('n-4', 'new-bell', 'attention', { raisedAt: 60 }),
			record('n-5', 'sent', 'message', { raisedAt: 40, body: 'look' }),
		),
		['old-finished', 'new-finished', 'old-waiting', 'new-bell', 'sent'].map(
			(title) => entry(title),
		),
	);
	assert.deepEqual(
		items.map((item) => item.title),
		['new-bell', 'sent', 'old-waiting', 'new-finished', 'old-finished'],
	);
});

test('a sent notification carries its text and still names its own terminal', () => {
	const [item] = publishedNotificationItems(
		snapshot(
			record('n-1', 'Terminal 1', 'message', {
				title: 'Terminal 2',
				body: 'Three files changed',
			}),
		),
		[entry('Terminal 1'), entry('Terminal 2')],
	);
	assert.deepEqual(item.sent, {
		title: 'Terminal 2',
		body: 'Three files changed',
	});
	assert.equal(item.title, 'Terminal 1');
	assert.equal(item.panelId, 'panel-Terminal 1');

	const [untitled] = publishedNotificationItems(
		snapshot(record('n-2', 'a', 'message', { body: 'only a body' })),
		[entry('a')],
	);
	assert.deepEqual(untitled.sent, { body: 'only a body' });
});

test('two notifications on one terminal are two rows', () => {
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'a', 'agent-finished'),
			record('n-2', 'a', 'message', { body: 'done, please review' }),
		),
		[entry('a')],
	);
	assert.deepEqual(
		items.map((item) => item.notificationId),
		['n-2', 'n-1'],
	);
});

test('a notification for a terminal this window does not show is not listed', () => {
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'elsewhere', 'attention'),
			record('n-2', 'a', 'attention', { projectId: 'project-2' }),
			record('n-3', 'a', 'attention'),
		),
		[entry('a'), entry('file', { kind: 'file', sessionId: undefined })],
	);
	assert.deepEqual(
		items.map((item) => item.notificationId),
		['n-3'],
	);
});

test("a terminal's indicator settings hide its activity notification but not what was sent", () => {
	const suppressed = entry('quiet', {
		indicatorsSuppressed: true,
		status: 'unviewed',
	});
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'quiet', 'command-finished'),
			record('n-2', 'quiet', 'message', { body: 'still shown' }),
		),
		[suppressed],
	);
	assert.deepEqual(
		items.map((item) => item.notificationId),
		['n-2'],
	);
	// An agent's terminal is governed by agent status, not the indicator settings.
	assert.equal(
		publishedNotificationItems(
			snapshot(record('n-3', 'agent', 'agent-finished')),
			[
				entry('agent', {
					indicatorsSuppressed: true,
					isAgentStatus: true,
					status: 'done',
				}),
			],
		).length,
		1,
	);
});

test('nothing published lists nothing', () => {
	assert.deepEqual(publishedNotificationItems(snapshot(), [entry('a')]), []);
});
