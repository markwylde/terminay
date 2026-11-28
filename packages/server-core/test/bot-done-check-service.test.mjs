import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BOT_CLEANUP_NOTE } from '../dist/botService/runtime.js';
import { BotSessionStore } from '../dist/botService/sessions.js';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

/** Holds the done-check timers until a test fires them. */
function manualTimers() {
	const pending = new Map();
	let next = 0;
	return {
		pending,
		setTimeout(fn, ms) {
			pending.set(++next, { fn, ms });
			return next;
		},
		clearTimeout(handle) {
			pending.delete(handle);
		},
		fire(ms) {
			const [id, timer] =
				[...pending].find(([, t]) => t.ms === ms) ?? assert.fail(`no ${ms}`);
			pending.delete(id);
			timer.fn();
		},
	};
}
const FIVE_MINUTES = 5 * 60_000;
const SHUTDOWN = 30_000;

async function setup(t, options = {}) {
	const root = mkdtempSync(join(tmpdir(), 'bots-done-'));
	const timers = manualTimers();
	const childFile = join(root, 'child.pid');
	const r = await runtime(root, {
		nativeTimers: timers,
		env: { FAKE_CHILD_PID_FILE: childFile },
		...options,
	});
	t.after(async () => {
		await r.service.shutdown();
		await r.kill();
		rmSync(root, { recursive: true, force: true });
	});
	const bot = await r.service.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	const record = (id) => r.sessions.get(id);
	const when = (predicate) => until(r.service, 'changed', predicate);
	const waiting = (id) =>
		when(() => record(id).backgroundWait?.waitingSince != null);
	const ended = (id) =>
		when(
			() =>
				!['queued', 'running', 'needs-you'].includes(record(id).state) &&
				!r.service.queue.active(bot.id).some((i) => i.sessionId === id),
		);
	return {
		...r,
		r,
		root,
		bot,
		timers,
		childFile,
		record,
		when,
		waiting,
		ended,
	};
}
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return !/^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'));
	} catch (error) {
		return error.code === 'ENOENT' && process.platform !== 'linux';
	}
};
/** Notes when the agent's own credential lease is released. */
const watchLease = (lease) => (options) => {
	const credential = options.credential;
	const release = credential.release.bind(credential);
	credential.release = () => {
		lease.released = true;
		release();
	};
};
const transcript = (s, id) => JSON.stringify(s.sessions.get(id).updates);

test('done completes the session only after its process group is gone', async (t) => {
	const releasedAtKill = [];
	const lease = { released: false };
	const s = await setup(t, {
		onProcess: watchLease(lease),
		execFailure: (args) => {
			if (args[1] === '--kill' && !args[2].startsWith('mcp-'))
				releasedAtKill.push(lease.released);
		},
	});
	const { sessionId } = await s.service.send(
		s.bot.id,
		'hold-background ignore-eof',
	);
	await s.waiting(sessionId);
	const held = s.record(sessionId);
	assert.equal(held.state, 'running');
	assert.deepEqual(held.backgroundWait.items, [
		{
			id: 'monitor-1',
			kind: 'local_bash',
			description: 'watch the build with [redacted]',
		},
	]);
	const child = Number(readFileSync(s.childFile, 'utf8'));
	assert.ok(alive(child));

	s.timers.fire(FIVE_MINUTES);
	await s.when(() => s.record(sessionId).backgroundWait.lastAnswer === 'done');
	// The agent ignores the end of its input, so the shutdown bound ends it.
	s.timers.fire(SHUTDOWN);
	await s.ended(sessionId);
	const record = s.record(sessionId);
	assert.equal(record.state, 'completed');
	assert.equal(record.backgroundWait.checks, 1);
	assert.equal(record.backgroundWait.waitingSince, null);
	assert.equal(record.backgroundWait.items[0].id, 'monitor-1');
	assert.ok(releasedAtKill.length > 0);
	assert.equal(releasedAtKill[0], false);
	assert.equal(lease.released, true);
	assert.ok(!alive(child), 'the surviving command was ended');
	assert.match(transcript(s, sessionId), /Terminay check/);
	await assert.rejects(s.service.runtime.call(sessionId, 'chat_list', {}));
});

test('unconfirmed cleanup after done keeps the outcome and holds the lease', async (t) => {
	t.mock.method(console, 'error', () => {});
	const lease = { released: false };
	const s = await setup(t, {
		onProcess: watchLease(lease),
		execFailure: (args) =>
			args[1] === '--kill' && !args[2].startsWith('mcp-')
				? new Error('engine operation deadline exceeded')
				: undefined,
	});
	const { sessionId } = await s.service.send(s.bot.id, 'hold-background');
	await s.waiting(sessionId);
	s.timers.fire(FIVE_MINUTES);
	await s.ended(sessionId);
	await s.when(() => /Cleanup failed/.test(s.record(sessionId).runnerOutput));
	assert.equal(s.record(sessionId).state, 'completed');
	assert.equal(lease.released, false);
});

test('a user stop while it shuts down records the session as stopped', async (t) => {
	const s = await setup(t);
	const { sessionId } = await s.service.send(
		s.bot.id,
		'hold-background ignore-stop',
	);
	await s.waiting(sessionId);
	s.timers.fire(FIVE_MINUTES);
	await s.when(() => s.record(sessionId).backgroundWait.lastAnswer === 'done');
	await s.service.stop(s.bot.id, sessionId);
	await s.ended(sessionId);
	assert.equal(s.record(sessionId).state, 'stopped');
});

test('not done keeps running and is asked again; stop ends the checks', async (t) => {
	const s = await setup(t);
	const { sessionId } = await s.service.send(
		s.bot.id,
		'hold-background still-waiting',
	);
	await s.waiting(sessionId);
	for (const checks of [1, 2]) {
		s.timers.fire(FIVE_MINUTES);
		await s.when(() => {
			const wait = s.record(sessionId).backgroundWait;
			return (
				wait.checks === checks &&
				wait.lastAnswer === 'waiting' &&
				wait.waitingSince !== null
			);
		});
		assert.equal(s.record(sessionId).state, 'running');
	}
	await s.service.stop(s.bot.id, sessionId);
	await s.ended(sessionId);
	const record = s.record(sessionId);
	assert.equal(record.state, 'stopped');
	assert.equal(record.backgroundWait.waitingSince, null);
	assert.equal(
		[...s.timers.pending.values()].filter((v) => v.ms === FIVE_MINUTES).length,
		0,
	);
});

test('a check-in left waiting is asked too, and can diagnose a held session', async (t) => {
	const s = await setup(t);
	const watched = await s.service.send(
		s.bot.id,
		'hold-background still-waiting',
	);
	await s.waiting(watched.sessionId);
	const checkIn = await s.service.send(s.bot.id, 'hold-background', undefined, {
		kind: 'check-in',
		watchedSessionId: watched.sessionId,
		runningMinutes: 15,
	});
	await s.waiting(checkIn.sessionId).catch((error) => {
		console.log(s.record(checkIn.sessionId));
		throw error;
	});
	const detail = await s.service.runtime.call(
		checkIn.sessionId,
		'sessions_get',
		{ sessionId: watched.sessionId },
	);
	assert.equal(detail.backgroundWait.items[0].id, 'monitor-1');
	assert.ok(detail.backgroundWait.lastActivityAt > 0);
	const briefing = s.service.runtime.briefing(checkIn.sessionId);
	assert.ok(briefing.includes(BOT_CLEANUP_NOTE));

	// The check-in's timer is the newer of the two.
	const [id, timer] = [...s.timers.pending]
		.filter(([, v]) => v.ms === FIVE_MINUTES)
		.at(-1);
	s.timers.pending.delete(id);
	timer.fn();
	await s.ended(checkIn.sessionId);
	assert.equal(s.record(checkIn.sessionId).state, 'completed');
	assert.equal(s.record(watched.sessionId).state, 'running');
	await s.service.stop(s.bot.id, watched.sessionId);
	await s.ended(watched.sessionId);
});

test('the cleanup rule names every kind of background work', async (t) => {
	for (const word of ['shells', 'Monitors', 'wakeups', 'subagents'])
		assert.match(BOT_CLEANUP_NOTE, new RegExp(word));
	const s = await setup(t);
	const { sessionId } = await s.service.send(s.bot.id, 'normal');
	assert.ok(s.service.runtime.briefing(sessionId).includes(BOT_CLEANUP_NOTE));
	await s.ended(sessionId);
	assert.equal(s.record(sessionId).backgroundWait, undefined);
});

test('sessions_get fits long, escaped and multibyte items in its budget', async (t) => {
	const s = await setup(t);
	const { sessionId } = await s.service.send(
		s.bot.id,
		'hold-background still-waiting',
	);
	await s.waiting(sessionId);
	const description = `${'"\\'.repeat(40)}${'é€'.repeat(35)}`;
	s.sessions.patch(sessionId, {
		backgroundWait: {
			...s.record(sessionId).backgroundWait,
			items: Array.from({ length: 32 }, (_, i) => ({
				id: `task-${i}-${'x'.repeat(200)}`,
				kind: 'local_bash',
				description,
			})),
			omitted: 3,
		},
	});
	const detail = await s.service.runtime.call(sessionId, 'sessions_get', {
		sessionId,
	});
	assert.ok(Buffer.byteLength(JSON.stringify(detail)) <= 8192);
	assert.equal(detail.id, sessionId);
	assert.equal(detail.state, 'running');
	const { items, omitted } = detail.backgroundWait;
	assert.ok(items.length > 0 && items.length <= 8);
	assert.equal(items.length + omitted, 35);
	for (const item of items)
		assert.ok(Buffer.byteLength(item.description) <= 128);
	await s.service.stop(s.bot.id, sessionId);
	await s.ended(sessionId);
});

test('the record round-trips, may be absent, and is bounded', async (t) => {
	const s = await setup(t);
	const { sessionId } = await s.service.send(
		s.bot.id,
		'hold-background still-waiting',
	);
	await s.waiting(sessionId);
	const stored = s.record(sessionId).backgroundWait;
	const reread = () => new BotSessionStore(join(s.root, 'sessions'));
	assert.deepEqual(reread().get(sessionId).backgroundWait, stored);
	await s.service.stop(s.bot.id, sessionId);
	await s.ended(sessionId);
	const plain = await s.service.send(s.bot.id, 'normal');
	await s.ended(plain.sessionId);
	assert.equal(reread().get(plain.sessionId).backgroundWait, undefined);
	for (const bad of [
		{ ...stored, checks: -1 },
		{ ...stored, items: Array(33).fill(stored.items[0]) },
		{
			...stored,
			items: [{ ...stored.items[0], description: 'x'.repeat(257) }],
		},
	]) {
		s.sessions.patch(plain.sessionId, { backgroundWait: bad });
		// Both the record and its previous copy are now invalid.
		s.sessions.patch(plain.sessionId, { reason: 'again' });
		assert.throws(() => reread().get(plain.sessionId));
	}
});
