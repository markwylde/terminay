import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	BotCheckIns,
	CHECK_IN_INTERVAL_MS,
	checkInPrompt,
} from '../dist/botService/checkIns.js';
import { BotTurnQueue } from '../dist/botService/queue.js';

const MINUTE = 60_000;
const ID = 'a'.repeat(24);

/** A scheduler on a fake clock, with sessions the test can change. */
function harness() {
	let now = 0;
	let next = 1;
	const timers = new Map();
	const records = new Map();
	const dispatched = [];
	const cancelled = [];
	let refuse = false;
	const checkIns = new BotCheckIns({
		now: () => now,
		session: (id) => records.get(id),
		sessions: () => [...records.values()],
		dispatch: async (botId, prompt, origin) => {
			if (refuse) throw new Error('queue full');
			dispatched.push({ botId, prompt, origin });
			records.set(`check-in-${dispatched.length}`, {
				id: `check-in-${dispatched.length}`,
				botId,
				origin,
				state: 'running',
				dispatchedAt: now,
			});
		},
		cancelQueued: (botId, id) => cancelled.push([botId, id]),
		setTimeout: (fn, ms) => {
			const handle = next++;
			timers.set(handle, { fn, at: now + ms });
			return handle;
		},
		clearTimeout: (handle) => timers.delete(handle),
	});
	const flush = async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};
	const advance = async (to) => {
		for (;;) {
			const due = [...timers.entries()]
				.filter(([, timer]) => timer.at <= to)
				.sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			timers.delete(due[0]);
			now = Math.max(now, due[1].at);
			due[1].fn();
			await flush();
		}
		now = to;
	};
	const watch = (patch = {}) => {
		const record = {
			id: ID,
			botId: 'bot',
			origin: { kind: 'chat' },
			state: 'running',
			dispatchedAt: 0,
			...patch,
		};
		records.set(record.id, record);
		checkIns.sync(record);
		return record;
	};
	const set = (id, patch) => {
		const record = { ...records.get(id), ...patch };
		records.set(id, record);
		checkIns.sync(record);
		return record;
	};
	return {
		checkIns,
		records,
		dispatched,
		cancelled,
		timers,
		advance,
		watch,
		set,
		jump: (to) => {
			now = to;
		},
		refuse: (value) => {
			refuse = value;
		},
		finishCheckIns: () => {
			for (const [id, r] of records)
				if (r.origin.kind === 'check-in')
					records.set(id, { ...r, state: 'completed' });
		},
	};
}

test('the prompt begins with the exact wording, real ID and duration', () => {
	assert.ok(
		checkInPrompt(ID, 30).startsWith(
			`You have another session running at ${ID} and it's been running for 30 minutes. Everything is probably fine, but can you just go check on it. Is it stuck, crashed, or in some sort of trouble? If it's still progressing as expected that's fine. If not fix it.`,
		),
	);
});

test('a check-in starts at each 15-minute mark with the real duration', async () => {
	const h = harness();
	h.watch();
	await h.advance(15 * MINUTE - 1);
	assert.equal(h.dispatched.length, 0);
	for (const [i, minutes] of [15, 30, 45].entries()) {
		await h.advance(minutes * MINUTE);
		assert.equal(h.dispatched.length, i + 1);
		assert.equal(h.dispatched[i].origin.watchedSessionId, ID);
		assert.equal(h.dispatched[i].origin.runningMinutes, minutes);
		assert.match(h.dispatched[i].prompt, new RegExp(`for ${minutes} minutes`));
		h.finishCheckIns();
	}
});

test('the schedule counts from hand-over, not from queueing', async () => {
	const h = harness();
	h.jump(20 * MINUTE);
	h.watch({ dispatchedAt: 20 * MINUTE, startedAt: 0 });
	assert.equal(h.checkIns.nextMark(ID), 35 * MINUTE);
});

test('a late timer reports real minutes and keeps the next mark', async () => {
	const h = harness();
	h.watch();
	await h.advance(15 * MINUTE);
	h.finishCheckIns();
	const timer = [...h.timers.values()][0];
	h.timers.clear();
	h.jump(37 * MINUTE);
	timer.fn();
	await Promise.resolve();
	assert.equal(h.dispatched.at(-1).origin.runningMinutes, 37);
	assert.equal(h.checkIns.nextMark(ID), 45 * MINUTE);
});

test('a check-in gets no check-ins of its own', async () => {
	const h = harness();
	h.watch({
		origin: {
			kind: 'check-in',
			watchedSessionId: 'b'.repeat(24),
			runningMinutes: 15,
		},
	});
	assert.equal(h.timers.size, 0);
	await h.advance(60 * MINUTE);
	assert.equal(h.dispatched.length, 0);
});

test('a mark is skipped while a check-in is active, and the next still fires', async () => {
	const h = harness();
	h.watch();
	await h.advance(15 * MINUTE);
	await h.advance(30 * MINUTE);
	assert.equal(h.dispatched.length, 1);
	h.finishCheckIns();
	await h.advance(45 * MINUTE);
	assert.equal(h.dispatched.length, 2);
	assert.equal(h.dispatched[1].origin.runningMinutes, 45);
});

test('a refused dispatch skips that mark only', async () => {
	const h = harness();
	h.watch();
	h.refuse(true);
	await h.advance(15 * MINUTE);
	assert.equal(h.dispatched.length, 0);
	h.refuse(false);
	await h.advance(30 * MINUTE);
	assert.equal(h.dispatched.length, 1);
});

test('a session waiting on the user gets no check-in, and later marks survive', async () => {
	const h = harness();
	h.watch();
	h.set(ID, { state: 'needs-you' });
	await h.advance(15 * MINUTE);
	assert.equal(h.dispatched.length, 0);
	h.set(ID, { state: 'running' });
	await h.advance(30 * MINUTE);
	assert.equal(h.dispatched.length, 1);
});

test('ending the session cancels its timer and queued check-in', async () => {
	const h = harness();
	h.watch();
	await h.advance(10 * MINUTE);
	h.set(ID, { state: 'completed', endedAt: 10 * MINUTE });
	assert.equal(h.timers.size, 0);
	assert.deepEqual(h.cancelled, [['bot', ID]]);
	await h.advance(60 * MINUTE);
	assert.equal(h.dispatched.length, 0);
});

test('a session interrupted by a restart gets no schedule', async () => {
	const h = harness();
	h.checkIns.reconcile([
		{
			id: ID,
			botId: 'bot',
			origin: { kind: 'chat' },
			state: 'interrupted',
			dispatchedAt: 0,
		},
	]);
	assert.equal(h.timers.size, 0);
});

test('stop clears every timer', () => {
	const h = harness();
	h.watch();
	h.checkIns.stop();
	assert.equal(h.timers.size, 0);
	assert.equal(CHECK_IN_INTERVAL_MS, 15 * MINUTE);
});

function queue() {
	const runs = new Map();
	const q = new BotTurnQueue({
		run: (item) => new Promise((resolve) => runs.set(item.sessionId, resolve)),
		suspend: async () => {},
		cancelled: () => {},
		changed: () => {},
		failure: () => {},
	});
	const add = (sessionId, origin) =>
		q.enqueue({ botId: 'bot', sessionId, origin, prompt: 'p' });
	return { q, runs, add };
}
const trigger = {
	kind: 'trigger',
	triggerId: 't',
	triggerName: 'T',
	fireTime: 0,
};
const checkIn = {
	kind: 'check-in',
	watchedSessionId: ID,
	runningMinutes: 15,
};

test('a check-in runs when every other slot is full', () => {
	const { q, runs, add } = queue();
	for (const id of ['w1', 'w2', 'w3', 'w4']) add(id, trigger);
	add('chat', { kind: 'chat' });
	add('check', checkIn);
	assert.ok(runs.has('chat'));
	assert.ok(runs.has('check'));
	assert.equal(q.active('bot').length, 6);
});

test('a stuck check-in blocks neither a user message nor work', async () => {
	const { runs, add } = queue();
	add('check', checkIn);
	for (const id of ['w1', 'w2', 'w3', 'w4']) add(id, trigger);
	assert.equal(runs.size, 5);
	add('chat', { kind: 'chat' });
	assert.ok(runs.has('chat'));
});

test('only one check-in runs per bot at a time', async () => {
	const { runs, add } = queue();
	add('c1', checkIn);
	add('c2', { ...checkIn, watchedSessionId: 'b'.repeat(24) });
	assert.ok(runs.has('c1'));
	assert.equal(runs.has('c2'), false);
	runs.get('c1')({ cleanup: 'ok' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(runs.has('c2'));
});

test('Claude alone launches with its background ceiling off', () => {
	const manifest = JSON.parse(
		readFileSync(
			new URL(
				'../../../extensions/builtin-agents/package.json',
				import.meta.url,
			),
			'utf8',
		),
	);
	const agents = JSON.stringify(manifest);
	assert.equal(agents.match(/CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS/g).length, 1);
	const find = (node) => {
		if (Array.isArray(node)) return node.flatMap(find);
		if (node === null || typeof node !== 'object') return [];
		return [
			...(node.nativeDriver ? [node] : []),
			...Object.values(node).flatMap(find),
		];
	};
	const drivers = find(manifest);
	const claude = drivers.find((a) => a.nativeDriver === 'claude-code-cli');
	const codex = drivers.find((a) => a.nativeDriver === 'codex-cli');
	assert.equal(
		claude.launchEnvironment.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS,
		'0',
	);
	assert.equal(
		codex.launchEnvironment?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS,
		undefined,
	);
});
