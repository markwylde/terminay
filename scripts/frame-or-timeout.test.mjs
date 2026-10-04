import assert from 'node:assert/strict';
import test from 'node:test';
import {
	FRAME_FALLBACK_MS,
	requestFrameOrTimeout,
} from '../src/workspace/frameOrTimeout.ts';

function createHost() {
	const frames = new Map();
	const timers = new Map();
	let nextId = 1;
	return {
		frames,
		timers,
		host: {
			cancelAnimationFrame: (id) => frames.delete(id),
			clearTimeout: (id) => timers.delete(id),
			requestAnimationFrame: (callback) => {
				frames.set(nextId, callback);
				return nextId++;
			},
			setTimeout: (callback, delay) => {
				timers.set(nextId, { callback, delay });
				return nextId++;
			},
		},
	};
}

test('a visible window runs the work on its next frame, once', () => {
	const { frames, timers, host } = createHost();
	let runs = 0;
	requestFrameOrTimeout(() => {
		runs += 1;
	}, host);
	assert.equal(runs, 0);
	const [frame] = [...frames.values()];
	const [timer] = [...timers.values()];
	frame();
	assert.equal(runs, 1);
	assert.equal(timers.size, 0);
	timer.callback();
	assert.equal(runs, 1);
});

test('a covered window that gets no frame still runs the work from the timer', () => {
	const { frames, timers, host } = createHost();
	let runs = 0;
	requestFrameOrTimeout(() => {
		runs += 1;
	}, host);
	const [frame] = [...frames.values()];
	const [timer] = [...timers.values()];
	assert.equal(timer.delay, FRAME_FALLBACK_MS);
	timer.callback();
	assert.equal(runs, 1);
	assert.equal(frames.size, 0);
	frame();
	assert.equal(runs, 1);
});
