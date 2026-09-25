import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshSchedule } from '../dist/index.js';

/**
 * A refresh spawns `git status` per worktree, so its rate is a cost, not a
 * latency preference. These assert the rate is bounded however the events
 * arrive — the property a trailing debounce does not have.
 */
function harness(rampMs) {
	let clock = 0;
	let runs = 0;
	const timers = new Map();
	let nextId = 1;
	const schedule = createRefreshSchedule({
		rampMs: Array.isArray(rampMs) ? rampMs : [rampMs],
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

test('sustained change ramps the interval and quiet resets it', () => {
	const ramp = [1000, 2000, 3000, 5000, 10_000, 20_000];
	const { schedule, advance, runs } = harness(ramp);

	// Keep asking throughout. The gap between runs must widen through the ramp
	// rather than holding at the fastest step.
	const runAt = [];
	let clock = 0;
	const before = runs();
	for (let tick = 0; tick < 600; tick += 1) {
		schedule.request();
		if (runs() > before + runAt.length) runAt.push(clock);
		advance(100);
		clock += 100;
	}
	const gaps = runAt.slice(1).map((at, index) => at - runAt[index]);
	assert.ok(gaps.length >= 5, `expected several runs, saw ${runAt.length}`);
	assert.ok(
		gaps[gaps.length - 1] > gaps[0],
		`expected the gap to widen, saw ${gaps.join(',')}`,
	);
	assert.ok(
		gaps.every((gap) => gap <= 20_000),
		`expected the ramp to hold at 20s, saw ${gaps.join(',')}`,
	);
});

test('the ramp holds at its widest step rather than growing', () => {
	const { schedule, advance, runs } = harness([1000, 2000]);
	for (let tick = 0; tick < 200; tick += 1) {
		schedule.request();
		advance(100);
	}
	// 20s of continuous change at a 2s ceiling: about ten runs, not one.
	assert.ok(runs() >= 8, `expected the ceiling to keep running, saw ${runs()}`);
});

test('an empty ramp is rejected', () => {
	assert.throws(
		() => createRefreshSchedule({ rampMs: [], run: () => {} }),
		RangeError,
	);
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
		() => createRefreshSchedule({ rampMs: [-1], run: () => {} }),
		RangeError,
	);
	assert.throws(
		() => createRefreshSchedule({ rampMs: [Number.NaN], run: () => {} }),
		RangeError,
	);
});
