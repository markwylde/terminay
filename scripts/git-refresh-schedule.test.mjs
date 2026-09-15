import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshSchedule } from '../src/workspace/gitRefreshSchedule.ts';

/**
 * A refresh spawns `git status` per worktree, so its rate is a cost, not a
 * latency preference. These assert the rate is bounded however the events
 * arrive — the property a trailing debounce does not have.
 */
function harness(minIntervalMs) {
	let clock = 0;
	let runs = 0;
	const timers = new Map();
	let nextId = 1;
	const schedule = createRefreshSchedule({
		minIntervalMs,
		run: () => {
			runs += 1;
		},
		now: () => clock,
		setTimer: (callback, delayMs) => {
			const id = nextId++;
			timers.set(id, { callback, dueAt: clock + delayMs });
			return id;
		},
		clearTimer: (id) => {
			timers.delete(id);
		},
	});
	const advance = (ms) => {
		const target = clock + ms;
		for (;;) {
			let due;
			for (const [id, entry] of timers)
				if (entry.dueAt <= target && (due === undefined || entry.dueAt < due[1].dueAt))
					due = [id, entry];
			if (due === undefined) break;
			timers.delete(due[0]);
			clock = due[1].dueAt;
			due[1].callback();
		}
		clock = target;
	};
	return { schedule, advance, runs: () => runs };
}

test('an isolated request after a quiet period runs without waiting', () => {
	const { schedule, runs } = harness(1000);
	schedule.request();
	// The case a user watches: save a file, look at the panel. Not delayed.
	assert.equal(runs(), 1);
});

test('a steady event stream is bounded by the minimum interval', () => {
	const { schedule, advance, runs } = harness(1000);
	// 10 seconds of events arriving every 120ms -- the cadence that produced
	// ~8 refreshes a second under a trailing debounce.
	for (let elapsed = 0; elapsed < 10_000; elapsed += 120) {
		schedule.request();
		advance(120);
	}
	assert.ok(
		runs() <= 11,
		`expected at most 11 refreshes in 10s at a 1s interval, saw ${runs()}`,
	);
	assert.ok(runs() >= 9, `expected refreshes to keep up, saw ${runs()}`);
});

test('requests during an interval collapse into exactly one run', () => {
	const { schedule, advance, runs } = harness(1000);
	schedule.request();
	assert.equal(runs(), 1);
	for (let i = 0; i < 50; i += 1) schedule.request();
	assert.equal(runs(), 1, 'a burst must not run again inside the interval');
	advance(1000);
	assert.equal(runs(), 2, 'the burst must produce exactly one later run');
});

test('a request during an interval is never dropped', () => {
	const { schedule, advance, runs } = harness(1000);
	schedule.request();
	advance(100);
	schedule.request();
	advance(899);
	assert.equal(runs(), 1, 'still inside the interval');
	advance(1);
	assert.equal(runs(), 2, 'the pending change is reflected once the interval ends');
});

test('cancel drops the pending run', () => {
	const { schedule, advance, runs } = harness(1000);
	schedule.request();
	schedule.request();
	schedule.cancel();
	advance(5000);
	assert.equal(runs(), 1);
});

test('a non-finite or negative interval is rejected', () => {
	assert.throws(
		() => createRefreshSchedule({ minIntervalMs: -1, run: () => {} }),
		RangeError,
	);
	assert.throws(
		() => createRefreshSchedule({ minIntervalMs: Number.NaN, run: () => {} }),
		RangeError,
	);
});
