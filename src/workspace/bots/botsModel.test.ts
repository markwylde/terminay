import assert from 'node:assert/strict';
import test from 'node:test';
import type { BotProfile, BotSessionRecord } from '@terminay/protocol';
import {
	type BotEntry,
	acceptChatImages,
	botActivity,
	chatSendAttempt,
	filterCounts,
	initials,
	investigatesFailures,
	needsYou,
	SESSION_ORIGIN_CHIPS,
	SESSION_ORIGIN_FILTER_LABELS,
	sessionOriginLabel,
	sessionTitle,
	shortAge,
	visibleBots,
} from './botsModel.ts';

const bot = (id: string, name: string): BotProfile => ({
	id,
	name,
	avatar: '',
	colour: '#7cc4f5',
	description: `${name} helps`,
	instructions: '',
	agentId: 'com.terminay.builtin-agents/codex',
	modelId: null,
	signIn: { kind: 'device' },
	approvalMode: 'ask',
	maxTurnMs: 600_000,
	pinnedMemories: [],
	createdAt: 0,
	updatedAt: 0,
});

const session = (
	id: string,
	state: BotSessionRecord['state'],
	extra: Partial<BotSessionRecord> = {},
): BotSessionRecord => ({
	id,
	botId: 'b',
	origin: { kind: 'chat' },
	snapshot: {
		agentId: 'a',
		modelId: null,
		signIn: { kind: 'none' },
		approvalMode: 'ask',
		instructions: '',
		context: '',
		maxTurnMs: 1,
	},
	state,
	startedAt: 100,
	endedAt: null,
	durationMs: 0,
	open: true,
	acpSessionId: null,
	canLoad: true,
	segments: 1,
	transcriptBytes: 0,
	truncated: false,
	runnerOutput: '',
	permission: null,
	permissions: [],
	queuedMessage: null,
	firing: null,
	reason: null,
	recoveryMayHaveLostUpdates: false,
	...extra,
});

const entry = (
	name: string,
	sessions: BotSessionRecord[],
	environment: BotEntry['environment'] = 'running',
): BotEntry => ({
	serverId: 'local',
	serverLabel: 'Local',
	bot: bot(name.toLowerCase().padEnd(12, 'x').slice(0, 12), name),
	sessions,
	environment,
});

test('activity: needs you outranks working, which outranks queued and stopped', () => {
	assert.equal(
		botActivity(
			[session('1', 'running'), session('2', 'needs-you')],
			'running',
		),
		'needs-you',
	);
	assert.equal(botActivity([session('1', 'running')], 'running'), 'working');
	assert.equal(botActivity([session('1', 'queued')], 'stopped'), 'queued');
	assert.equal(botActivity([session('1', 'completed')], 'stopped'), 'stopped');
	assert.equal(botActivity([], 'not-created'), 'stopped');
	assert.equal(botActivity([session('1', 'completed')], 'running'), 'idle');
});

test('a pending permission counts as needing the user', () => {
	const asking = session('1', 'running', {
		permission: {
			id: 'p',
			options: [],
			toolCall: { title: 'git push origin main' },
		},
	});
	assert.equal(botActivity([asking], 'running'), 'needs-you');
	const [item] = needsYou([entry('Site', [asking])]);
	assert.equal(item?.summary, 'Wants to run: git push origin main');
	assert.equal(item?.sessionId, '1');
});

test('filters and search narrow the fleet, and counts match each filter', () => {
	const fleet = [
		entry('Bird', [session('1', 'running')]),
		entry('Sway', [], 'stopped'),
		entry('Gauge', [session('2', 'needs-you')]),
		entry('Frame', []),
	];
	const names = (filter: Parameters<typeof visibleBots>[1], search = '') =>
		visibleBots(fleet, filter, search).map((e) => e.bot.name);
	assert.deepEqual(names('all'), ['Bird', 'Frame', 'Gauge', 'Sway']);
	assert.deepEqual(names('working'), ['Bird']);
	assert.deepEqual(names('needs-you'), ['Gauge']);
	assert.deepEqual(names('stopped'), ['Sway']);
	assert.deepEqual(names('all', 'gau'), ['Gauge']);
	assert.deepEqual(names('all', 'LOCAL'), ['Bird', 'Frame', 'Gauge', 'Sway']);
	assert.deepEqual(filterCounts(fleet), {
		all: 4,
		working: 1,
		'needs-you': 1,
		stopped: 1,
	});
});

test('needs you lists every waiting session across bots, oldest first', () => {
	const fleet = [
		entry('Bird', [session('late', 'needs-you', { startedAt: 300 })]),
		entry('Gauge', [session('early', 'needs-you', { startedAt: 200 })]),
	];
	assert.deepEqual(
		needsYou(fleet).map((n) => n.sessionId),
		['early', 'late'],
	);
});

test('initials and ages are short enough for a card', () => {
	assert.equal(initials('Site Submitter'), 'SS');
	assert.equal(initials('bird'), 'B');
	assert.equal(initials('  '), '?');
	assert.equal(shortAge(0, 30_000), 'now');
	assert.equal(shortAge(0, 4 * 60_000), '4m');
	assert.equal(shortAge(0, 3 * 3_600_000), '3h');
	assert.equal(shortAge(0, 72 * 3_600_000), '3d');
});

test('Investigate failures reads as on unless a profile turns it off', () => {
	assert.equal(investigatesFailures(bot('b', 'Bird')), true);
	assert.equal(investigatesFailures({ ...bot('b', 'Bird'), investigateFailures: true }), true);
	assert.equal(investigatesFailures({ ...bot('b', 'Bird'), investigateFailures: false }), false);
});

test('failure investigations have their own filter, chip, label and title', () => {
	assert.deepEqual(Object.keys(SESSION_ORIGIN_FILTER_LABELS), ['all', 'chat', 'trigger', 'run-now', 'failure']);
	assert.equal(SESSION_ORIGIN_FILTER_LABELS.failure, 'Failure');
	assert.equal(SESSION_ORIGIN_CHIPS.failure, 'Investigate');
	const ref = {
		kind: 'execution' as const,
		sessionId: 's'.repeat(24),
		firingId: null,
		triggerId: 't'.repeat(24),
		triggerName: 'Gitea poll',
		at: 1,
		reason: 'spawn EAGAIN',
	};
	const one = session('i', 'running', { origin: { kind: 'failure', failures: [ref], overflow: 0 } });
	const many = session('j', 'running', { origin: { kind: 'failure', failures: [ref, ref], overflow: 3 } });
	assert.equal(sessionOriginLabel(one.origin), 'Investigate failure');
	assert.equal(sessionTitle(one), 'Investigate failure');
	assert.equal(sessionTitle(many), 'Investigate failure (5 failures)');
	const trigger = { kind: 'trigger' as const, triggerId: 't'.repeat(24), triggerName: 'Nightly', fireTime: 1 };
	assert.equal(sessionOriginLabel(trigger), 'Trigger · Nightly');
	assert.equal(sessionOriginLabel({ ...trigger, kind: 'run-now' }), 'Run now · Nightly');
	assert.equal(sessionOriginLabel({ kind: 'chat' }), 'Chat');
});

test('composer accepts PNG, JPEG, GIF and WebP up to 2 MiB and four per message', () => {
	const img = (type: string, size = 10) => ({ type, size });
	assert.deepEqual(
		acceptChatImages(0, [img('image/png'), img('image/jpeg'), img('image/gif'), img('image/webp')])
			.accepted.length,
		4,
	);
	const text = acceptChatImages(0, [img('text/plain'), img('image/png')]);
	assert.equal(text.accepted.length, 1);
	assert.match(text.refusal ?? '', /PNG, JPEG, GIF and WebP/);
	const big = acceptChatImages(0, [img('image/png', 2 * 1024 * 1024 + 1)]);
	assert.deepEqual(big.accepted, []);
	assert.match(big.refusal ?? '', /2 MiB/);
	assert.equal(acceptChatImages(0, [img('image/png', 2 * 1024 * 1024)]).refusal, undefined);
	const fifth = acceptChatImages(4, [img('image/png')]);
	assert.deepEqual(fifth.accepted, []);
	assert.match(fifth.refusal ?? '', /at most 4/);
	assert.equal(acceptChatImages(3, [img('image/png'), img('image/png')]).accepted.length, 1);
});

test('a retry of the same content reuses its idempotency key', () => {
	let n = 0;
	const fresh = () => `key-${++n}`;
	const first = chatSendAttempt(undefined, 'hello|a', fresh);
	assert.equal(chatSendAttempt(first, 'hello|a', fresh).key, 'key-1');
	assert.equal(chatSendAttempt(first, 'hello|a,b', fresh).key, 'key-2');
});
