import assert from 'node:assert/strict';
import test from 'node:test';
import type { BotProfile, BotSessionRecord } from '@terminay/protocol';
import {
	acceptChatFiles,
	attachmentView,
	type BotEntry,
	botActivity,
	chatFileKind,
	chatSendAttempt,
	filterCounts,
	formatFileSize,
	hasTerminayMcpAccess,
	initials,
	investigatesFailures,
	needsYou,
	recoveryNotice,
	SESSION_ORIGIN_CHIPS,
	SESSION_ORIGIN_FILTER_LABELS,
	sessionOriginLabel,
	sessionTitle,
	shortAge,
	startupSummary,
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
	assert.equal(
		investigatesFailures({ ...bot('b', 'Bird'), investigateFailures: true }),
		true,
	);
	assert.equal(
		investigatesFailures({ ...bot('b', 'Bird'), investigateFailures: false }),
		false,
	);
	assert.equal(hasTerminayMcpAccess(bot('b', 'Bird')), false);
	assert.equal(
		hasTerminayMcpAccess({ ...bot('b', 'Bird'), terminayMcpAccess: true }),
		true,
	);
	assert.equal(
		hasTerminayMcpAccess({ ...bot('b', 'Bird'), terminayMcpAccess: false }),
		false,
	);
});

test('failure investigations have their own filter, chip, label and title', () => {
	assert.deepEqual(Object.keys(SESSION_ORIGIN_FILTER_LABELS), [
		'all',
		'chat',
		'trigger',
		'run-now',
		'failure',
	]);
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
	const one = session('i', 'running', {
		origin: { kind: 'failure', failures: [ref], overflow: 0 },
	});
	const many = session('j', 'running', {
		origin: { kind: 'failure', failures: [ref, ref], overflow: 3 },
	});
	assert.equal(sessionOriginLabel(one.origin), 'Investigate failure');
	assert.equal(sessionTitle(one), 'Investigate failure');
	assert.equal(sessionTitle(many), 'Investigate failure (5 failures)');
	const trigger = {
		kind: 'trigger' as const,
		triggerId: 't'.repeat(24),
		triggerName: 'Nightly',
		fireTime: 1,
	};
	assert.equal(sessionOriginLabel(trigger), 'Trigger · Nightly');
	assert.equal(
		sessionOriginLabel({ ...trigger, kind: 'run-now' }),
		'Run now · Nightly',
	);
	assert.equal(sessionOriginLabel({ kind: 'chat' }), 'Chat');
});

test('composer accepts any file: images up to 2 MiB, others up to 5 MiB, four per message', () => {
	const MiB = 1024 * 1024;
	const image = (size = 10) => ({ kind: 'image' as const, size });
	const file = (size = 10) => ({ kind: 'file' as const, size });
	assert.equal(
		acceptChatFiles(0, [image(), file(), file(3 * MiB), image()]).accepted
			.length,
		4,
	);
	const big = acceptChatFiles(0, [image(2 * MiB + 1), file()]);
	assert.equal(big.accepted.length, 1);
	assert.match(big.refusal ?? '', /Images must be 2 MiB/);
	assert.equal(acceptChatFiles(0, [image(2 * MiB)]).refusal, undefined);
	assert.equal(acceptChatFiles(0, [file(5 * MiB)]).refusal, undefined);
	assert.match(
		acceptChatFiles(0, [file(5 * MiB + 1)]).refusal ?? '',
		/Files must be 5 MiB/,
	);
	assert.match(acceptChatFiles(0, [file(0)]).refusal ?? '', /Empty/);
	const fifth = acceptChatFiles(4, [file()]);
	assert.deepEqual(fifth.accepted, []);
	assert.match(fifth.refusal ?? '', /at most 4 files/);
	assert.equal(acceptChatFiles(3, [file(), image()]).accepted.length, 1);
});

test('file kind comes from content, never the claimed type or name', () => {
	const png = Uint8Array.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
	]);
	const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
	assert.equal(chatFileKind(png), 'image');
	assert.equal(chatFileKind(zip), 'file');
	assert.equal(
		chatFileKind(new TextEncoder().encode('<svg onload=x>')),
		'file',
	);
	assert.equal(chatFileKind(new Uint8Array()), 'file');
});

test('only raster images render; every other attachment is a chip', () => {
	for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
		assert.equal(attachmentView(mime), 'image');
	for (const mime of [
		'application/octet-stream',
		'text/html',
		'image/svg+xml',
		'',
	])
		assert.equal(attachmentView(mime), 'file');
	assert.equal(formatFileSize(512), '512 B');
	assert.equal(formatFileSize(1536), '1.5 KB');
	assert.equal(formatFileSize(3 * 1024 * 1024), '3.0 MB');
});

test('a retry of the same content reuses its idempotency key', () => {
	let n = 0;
	const fresh = () => `key-${++n}`;
	const first = chatSendAttempt(undefined, 'hello|a', fresh);
	assert.equal(chatSendAttempt(first, 'hello|a', fresh).key, 'key-1');
	assert.equal(chatSendAttempt(first, 'hello|a,b', fresh).key, 'key-2');
});

test('an environment that needs the user names the bot, the tone and the action', () => {
	const missing = recoveryNotice('Codexia', 'not-created');
	assert.equal(missing?.kind, 'not-created');
	assert.equal(missing?.tone, 'warn');
	assert.equal(missing?.create, 'Create environment');
	assert.equal(missing?.recreate, undefined);
	assert.match(missing?.title ?? '', /^Codexia’s environment is not created$/);

	const failed = recoveryNotice('Codexia', 'failed');
	assert.equal(failed?.tone, 'error');
	assert.equal(failed?.create, 'Try again');
	assert.equal(failed?.recreate, true);

	// Container updates are shown on the Overview from the bot's own
	// container, never here from the shared image's state.
	for (const state of ['running', 'stopped', 'starting', 'building'] as const)
		assert.equal(recoveryNotice('Codexia', state), undefined);
	assert.equal(recoveryNotice('Codexia', undefined), undefined);
});

test('startup attempts read as plain words', () => {
	const attempt = {
		stage: 'adapter-check',
		temporary: true,
		code: 'adapter-timeout',
		at: 0,
		cause: 'slow',
	} as const;
	const time = () => '10:00:30';
	assert.equal(
		startupSummary({ state: 'completed', dispatchedAt: 5, attempts: [] }),
		null,
	);
	assert.equal(
		startupSummary({
			state: 'completed',
			dispatchedAt: 5,
			retryLimit: 3,
			attempts: [attempt],
		}),
		'Started on attempt 2 of 4.',
	);
	assert.equal(
		startupSummary(
			{
				state: 'running',
				dispatchedAt: null,
				retryLimit: 3,
				retryAt: 30_000,
				attempts: [attempt, attempt],
			},
			time,
		),
		'Retrying: attempt 3 of 4 at 10:00:30.',
	);
	assert.equal(
		startupSummary({
			state: 'failed',
			dispatchedAt: null,
			retryLimit: 3,
			attempts: [attempt, attempt, attempt, attempt],
			startupFailure: {
				stage: 'adapter-check',
				temporary: true,
				code: 'adapter-timeout',
			},
		}),
		'Failed after 4 attempts.',
	);
	// A lasting final failure is not in the temporary history.
	assert.equal(
		startupSummary({
			state: 'failed',
			dispatchedAt: null,
			attempts: [attempt],
			startupFailure: {
				stage: 'adapter-check',
				temporary: false,
				code: 'adapter-lasting',
			},
		}),
		'Failed after 2 attempts.',
	);
});
