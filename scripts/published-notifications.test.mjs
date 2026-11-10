import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActivityCount } from '../src/workspace/activityCountBadge.ts';
import {
	botNotificationHeadline,
	botUnreadCounts,
	botUnreadLabel,
	publishedNotificationItems,
} from '../src/workspace/publishedNotifications.ts';

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
	// An agent's terminal follows the same indicator settings.
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
		0,
	);
});

test('an untracked terminal lists no activity notification, agent ones included', () => {
	const untracked = (title, overrides = {}) =>
		entry(title, { indicatorsSuppressed: true, untracked: true, ...overrides });
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'quiet', 'command-finished'),
			record('n-2', 'agent', 'agent-blocked'),
			record('n-3', 'quiet', 'message', { body: 'still shown' }),
		),
		[untracked('quiet'), untracked('agent', { isAgentStatus: true })],
	);
	assert.deepEqual(
		items.map((item) => item.notificationId),
		['n-3'],
	);
});

test('nothing published lists nothing', () => {
	assert.deepEqual(publishedNotificationItems(snapshot(), [entry('a')]), []);
});

function botRecord(id, botId, overrides = {}) {
	return {
		id,
		owner: 'bot',
		botId,
		source: 'bot',
		kind: 'bot-message',
		body: 'Build is green',
		count: 2,
		throughSequence: 9,
		raisedAt: 500,
		...overrides,
	};
}

const bots = (serverId, entries) => ({
	serverId,
	bots: new Map(entries.map(([id, name]) => [id, { name, avatar: 'B', colour: '#7cc4f5' }])),
});

test('a bot notification is listed as a bot row in the attention group, newest first among attention rows', () => {
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'build', 'agent-finished', { raisedAt: 900 }),
			record('n-2', 'shell', 'attention', { raisedAt: 100 }),
			botRecord('n-3', 'bot-bird'),
		),
		[entry('build'), entry('shell')],
		bots('local', [['bot-bird', 'Bird']]),
	);
	assert.deepEqual(
		items.map((item) => item.notificationId),
		['n-3', 'n-2', 'n-1'],
	);
	assert.deepEqual(items[0].bot, {
		serverId: 'local',
		botId: 'bot-bird',
		name: 'Bird',
		avatar: 'B',
		colour: '#7cc4f5',
		count: 2,
		throughSequence: 9,
		excerpt: 'Build is green',
	});
	assert.equal(items[0].state, 'attention');
	assert.equal(items[0].since, 500);
	assert.equal(items[0].title, 'Bird');
});

test('a bot this window does not know is not listed', () => {
	const items = publishedNotificationItems(
		snapshot(botRecord('n-1', 'bot-gone')),
		[],
		bots('local', [['bot-bird', 'Bird']]),
	);
	assert.deepEqual(items, []);
	assert.deepEqual(
		publishedNotificationItems(snapshot(botRecord('n-1', 'bot-bird')), []),
		[],
		'without the server\'s bots, no bot row',
	);
});

test('the Show indicator settings never hide a bot row', () => {
	const items = publishedNotificationItems(
		snapshot(
			record('n-1', 'build', 'agent-finished'),
			botRecord('n-2', 'bot-bird'),
		),
		[entry('build', { status: 'done', indicatorsSuppressed: true })],
		bots('local', [['bot-bird', 'Bird']]),
	);
	assert.deepEqual(items.map((item) => item.notificationId), ['n-2']);
});

test('the same bot id on two servers is two rows, each kept with its own server', () => {
	const a = publishedNotificationItems(
		snapshot(botRecord('n-1', 'bot-same')),
		[],
		bots('server-a', [['bot-same', 'Bird']]),
	);
	const b = publishedNotificationItems(
		snapshot(botRecord('n-1', 'bot-same')),
		[],
		bots('server-b', [['bot-same', 'Robin']]),
	);
	assert.deepEqual(
		[...a, ...b].map((item) => [item.bot.serverId, item.bot.name]),
		[['server-a', 'Bird'], ['server-b', 'Robin']],
	);
});

test('a bot row reads how many posts are waiting', () => {
	assert.equal(botNotificationHeadline(1), 'New message');
	assert.equal(botNotificationHeadline(3), '3 new messages');
});

test('unread bot posts are counted per bot and in total, for the bots this window knows', () => {
	const counts = botUnreadCounts(
		snapshot(
			record('n-1', 'build', 'agent-finished'),
			botRecord('n-2', 'bot-bird', { count: 3 }),
			botRecord('n-3', 'bot-owl', { count: 1 }),
			botRecord('n-4', 'bot-gone', { count: 5 }),
		),
		bots('local', [
			['bot-bird', 'Bird'],
			['bot-owl', 'Owl'],
			['bot-quiet', 'Quiet'],
		]),
	);
	assert.equal(counts.serverId, 'local');
	assert.equal(counts.total, 4);
	assert.deepEqual(
		[...counts.byBot],
		[
			['bot-bird', 3],
			['bot-owl', 1],
		],
	);
});

test("nothing is counted without a published list or the server's bots", () => {
	assert.equal(botUnreadCounts(undefined, bots('local', [])), undefined);
	assert.equal(
		botUnreadCounts(snapshot(botRecord('n-1', 'bot-bird')), undefined),
		undefined,
	);
	assert.equal(botUnreadCounts(snapshot(), bots('local', [])).total, 0);
});

test('an unread count is said in words', () => {
	assert.equal(botUnreadLabel(1), '1 unread message');
	assert.equal(botUnreadLabel(12), '12 unread messages');
});

test('above 99 a badge reads 99+ while its words keep the exact count', () => {
	const counts = botUnreadCounts(
		snapshot(
			botRecord('n-1', 'bot-bird', { count: 70 }),
			botRecord('n-2', 'bot-owl', { count: 50 }),
		),
		bots('local', [
			['bot-bird', 'Bird'],
			['bot-owl', 'Owl'],
		]),
	);
	assert.equal(counts.total, 120);
	assert.equal(formatActivityCount(counts.total), '99+');
	assert.equal(botUnreadLabel(counts.total), '120 unread messages');
});

test('counts are kept with the server that published them', () => {
	const counts = botUnreadCounts(
		snapshot(botRecord('n-1', 'bot-bird', { count: 3 })),
		bots('remote-2', [['bot-bird', 'Bird']]),
	);
	assert.equal(counts.serverId, 'remote-2');
	assert.equal(counts.byBot.get('bot-bird'), 3);
});
