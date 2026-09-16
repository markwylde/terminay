import assert from 'node:assert/strict';
import test from 'node:test';
import { createRampSchedule, DEFAULT_RAMP_INTERVALS_MS } from '../dist/index.js';

function harness(options = {}) {
	let now = 100_000;
	const timers = [];
	const runs = [];
	const ramp = createRampSchedule(() => runs.push(now), {
		now: () => now,
		schedule: (callback, milliseconds) => {
			const timer = { callback, milliseconds };
			timers.push(timer);
			return timer;
		},
		cancelSchedule: (timer) => {
			const index = timers.indexOf(timer);
			if (index >= 0) timers.splice(index, 1);
		},
		...options,
	});
	return {
		ramp,
		runs,
		timers,
		advance(milliseconds) {
			now += milliseconds;
		},
		fire() {
			const timer = timers.shift();
			assert.ok(timer, 'a run must be pending');
			now += timer.milliseconds;
			timer.callback();
		},
	};
}

test('the default ramp is 1, 2, 3, 5, 10, 20 seconds', () => {
	assert.deepEqual([...DEFAULT_RAMP_INTERVALS_MS], [1_000, 2_000, 3_000, 5_000, 10_000, 20_000]);
});

test('the first request after quiet runs at once', () => {
	const { ramp, runs, timers } = harness();
	assert.equal(ramp.request(), true);
	assert.equal(runs.length, 1);
	assert.equal(timers.length, 0);
});

test('requests inside the floor collapse into one run at its end, and each such run widens the floor', () => {
	const { ramp, runs, timers, advance, fire } = harness({ intervalsMs: [100, 200, 400] });
	ramp.request();
	const waits = [];
	for (let i = 0; i < 4; i += 1) {
		advance(10);
		assert.equal(ramp.request(), false);
		assert.equal(ramp.request(), false, 'a second request inside the interval is absorbed');
		assert.equal(ramp.pending, true);
		assert.equal(timers.length, 1);
		waits.push(timers[0].milliseconds);
		fire();
	}
	assert.deepEqual(waits, [90, 190, 390, 390], 'widens to the ceiling and holds there');
	assert.equal(runs.length, 5, 'one run per interval however many requests arrived');
});

test('a quiet period at least as long as the current floor resets to the base and runs promptly', () => {
	const { ramp, runs, advance, fire, timers } = harness({ intervalsMs: [100, 200, 400] });
	ramp.request();
	advance(10); ramp.request(); fire();
	advance(10); ramp.request(); fire();
	assert.equal(runs.length, 3);
	advance(400);
	assert.equal(ramp.request(), true, 'quiet: prompt again');
	advance(10);
	ramp.request();
	assert.equal(timers[0].milliseconds, 90, 'and the floor is back at its base');
});

test('dispose cancels the pending run and refuses further requests', () => {
	const { ramp, runs, advance, timers } = harness();
	ramp.request();
	advance(10);
	ramp.request();
	assert.equal(timers.length, 1);
	ramp.dispose();
	assert.equal(timers.length, 0);
	assert.equal(ramp.pending, false);
	assert.equal(ramp.request(), false);
	assert.equal(runs.length, 1);
});

test('a run that throws does not stop the schedule', () => {
	let calls = 0;
	const ramp = createRampSchedule(() => {
		calls += 1;
		throw new Error('boom');
	}, { now: () => 0 });
	assert.doesNotThrow(() => ramp.request());
	assert.equal(calls, 1);
});

test('intervals must be positive and non-decreasing', () => {
	assert.throws(() => createRampSchedule(() => {}, { intervalsMs: [] }), RangeError);
	assert.throws(() => createRampSchedule(() => {}, { intervalsMs: [100, 50] }), RangeError);
	assert.throws(() => createRampSchedule(() => {}, { intervalsMs: [0] }), RangeError);
});
