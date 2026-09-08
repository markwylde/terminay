import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createRecoveryLoop,
	createSessionHeartbeat,
	isUnrecoverableConnectFailure,
	RECOVERY_BASE_DELAY_MS,
	RECOVERY_CEILING_DELAY_MS,
	RecoveryRetrySchedule,
} from '../src/web/sessionConnectAttempt.ts';

/**
 * A single failed recovery attempt is not an answer.
 *
 * The reported failure was a phone that never came back from a dropped,
 * intermittent, or backgrounded connection: one attempt failed, the session
 * cleared itself, and nothing else was ever tried. These cover the loop that
 * replaces that behaviour.
 */

/** Drives the schedule's timers by hand so no test waits on real time. */
function createClock() {
	let sequence = 0;
	const pending = new Map();
	return {
		get armed() {
			return pending.size;
		},
		setTimeout(callback, delayMs) {
			sequence += 1;
			pending.set(sequence, { callback, delayMs });
			return sequence;
		},
		clearTimeout(handle) {
			pending.delete(handle);
		},
		delays() {
			return [...pending.values()].map((timer) => timer.delayMs);
		},
		/** Fire every armed timer, oldest first. */
		fire() {
			const due = [...pending.entries()];
			pending.clear();
			for (const [, timer] of due) timer.callback();
			return due.length;
		},
	};
}

function createSchedule(overrides = {}) {
	const clock = createClock();
	const schedule = new RecoveryRetrySchedule({
		random: () => 0,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		...overrides,
	});
	return { clock, schedule };
}

test('recovery delays grow, hold at a ceiling, and stay inside their jitter bounds', () => {
	const { schedule } = createSchedule({ random: () => 0 });
	assert.equal(schedule.delayFor(1), RECOVERY_BASE_DELAY_MS);
	assert.equal(schedule.delayFor(2), RECOVERY_BASE_DELAY_MS * 2);
	assert.equal(schedule.delayFor(3), RECOVERY_BASE_DELAY_MS * 4);
	// Growth stops at the ceiling and stays there for a session that is out for
	// an hour rather than escalating without bound.
	assert.equal(schedule.delayFor(20), RECOVERY_CEILING_DELAY_MS);
	assert.equal(schedule.delayFor(200), RECOVERY_CEILING_DELAY_MS);

	// Jitter only ever subtracts, so a delay is never longer than its step and
	// never collapses to zero.
	for (const random of [0, 0.5, 0.999999]) {
		const jittered = new RecoveryRetrySchedule({ random: () => random });
		for (const failures of [1, 2, 5, 50]) {
			const step = Math.min(
				RECOVERY_CEILING_DELAY_MS,
				RECOVERY_BASE_DELAY_MS * 2 ** (failures - 1),
			);
			const delay = jittered.delayFor(failures);
			assert.ok(delay <= step, `${delay} <= ${step}`);
			assert.ok(delay >= step * 0.75, `${delay} >= ${step * 0.75}`);
		}
	}
});

test('a scheduled attempt runs when its delay elapses and then starts from the base delay again', () => {
	const { clock, schedule } = createSchedule();
	let runs = 0;
	assert.equal(schedule.arm(() => { runs += 1; }), RECOVERY_BASE_DELAY_MS);
	assert.equal(schedule.armed, true);
	clock.fire();
	assert.equal(runs, 1);
	assert.equal(schedule.armed, false);

	assert.equal(schedule.arm(() => { runs += 1; }), RECOVERY_BASE_DELAY_MS * 2);
	schedule.reset();
	assert.equal(schedule.armed, false);
	assert.equal(schedule.consecutiveFailures, 0);
	assert.equal(schedule.arm(() => { runs += 1; }), RECOVERY_BASE_DELAY_MS);
});

test('a superseded attempt is cancelled instead of run', () => {
	const { clock, schedule } = createSchedule();
	let runs = 0;
	let current = true;
	schedule.arm(
		() => { runs += 1; },
		() => current,
	);
	current = false;
	clock.fire();
	assert.equal(runs, 0);
	assert.equal(schedule.armed, false);
});

test('a delay that elapses while hidden holds its attempt until the document is shown', () => {
	let hidden = true;
	const { clock, schedule } = createSchedule({ isHidden: () => hidden });
	let runs = 0;
	schedule.arm(() => { runs += 1; });
	clock.fire();
	assert.equal(runs, 0, 'a frozen document cannot run an attempt');
	assert.equal(schedule.waitingForVisibility, true);

	hidden = false;
	assert.equal(schedule.resume(), true);
	assert.equal(runs, 1);
	assert.equal(schedule.waitingForVisibility, false);
	assert.equal(schedule.resume(), false, 'resume is idle with nothing held');
});

function createLoop(overrides = {}) {
	const clock = createClock();
	const events = [];
	let connected = false;
	const schedule = new RecoveryRetrySchedule({
		random: () => 0,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		...(overrides.isHidden === undefined ? {} : { isHidden: overrides.isHidden }),
	});
	const attempts = [];
	const loop = createRecoveryLoop({
		run: (attempt, runOptions) => {
			attempts.push({ attempt, runOptions });
			return overrides.run
				? overrides.run(attempt, runOptions)
				: Promise.reject(new Error('Session transport closed during connect.'));
		},
		recovering: () => connected,
		onAttemptStart: (context) => events.push({ type: 'start', ...context }),
		onAttemptFailed: (context) => events.push({ type: 'failed', ...context }),
		schedule,
		attemptClock: {
			attemptTimeoutMs: 20_000,
			setTimeout: () => 0,
			clearTimeout: () => undefined,
		},
	});
	return {
		attempts,
		clock,
		events,
		loop,
		schedule,
		connect() { connected = true; },
	};
}

test('a failed attempt schedules another one with no user action', async () => {
	const harness = createLoop();
	harness.loop.start();
	await settle();

	assert.equal(harness.attempts.length, 1);
	assert.deepEqual(harness.events, [
		{ type: 'start', recovering: false },
		{
			type: 'failed',
			message: 'Session transport closed during connect.',
			retrying: true,
		},
	]);
	assert.equal(harness.schedule.armed, true, 'the next attempt is already armed');

	harness.clock.fire();
	await settle();
	assert.equal(harness.attempts.length, 2);
});

test('recovery keeps retrying and stays reconnecting across repeated failures', async () => {
	const harness = createLoop();
	harness.connect();
	harness.loop.start();
	await settle();
	harness.clock.fire();
	await settle();
	harness.clock.fire();
	await settle();

	assert.equal(harness.attempts.length, 3);
	assert.deepEqual(
		harness.events.filter((event) => event.type === 'failed'),
		Array.from({ length: 3 }, () => ({
			type: 'failed',
			message: 'Session transport closed during connect.',
			retrying: true,
		})),
	);
	// Every start reports a recovering session, so the reconnecting state stays
	// visible instead of falling back to an idle "connection unavailable".
	assert.equal(
		harness.events
			.filter((event) => event.type === 'start')
			.every((event) => event.recovering),
		true,
	);
});

test('Retry attempts now instead of waiting out the backoff', async () => {
	const harness = createLoop();
	harness.loop.start();
	await settle();
	assert.equal(harness.schedule.armed, true);
	assert.deepEqual(harness.clock.delays(), [RECOVERY_BASE_DELAY_MS]);

	harness.loop.start();
	await settle();
	assert.equal(harness.attempts.length, 2, 'Retry started an attempt immediately');
	assert.equal(
		harness.clock.armed,
		1,
		'the superseded delay was cancelled, not left to fire twice',
	);
});

test('a succeeding attempt clears the backoff so the next failure starts over', async () => {
	let fail = true;
	const harness = createLoop({
		run: () =>
			fail
				? Promise.reject(new Error('Session transport closed during connect.'))
				: Promise.resolve(),
	});
	harness.loop.start();
	await settle();
	fail = false;
	harness.clock.fire();
	await settle();

	assert.equal(harness.schedule.consecutiveFailures, 0);
	assert.equal(harness.schedule.armed, false);
});

test('failures a retry cannot fix stop the loop and keep their terminal presentation', async () => {
	for (const message of [
		'This browser has not been paired with this Terminay server.',
		'Server host identity changed; explicit re-pairing is required.',
		'This device was revoked.',
		'Unknown device.',
	]) {
		assert.equal(isUnrecoverableConnectFailure(new Error(message)), true, message);
		const harness = createLoop({ run: () => Promise.reject(new Error(message)) });
		harness.loop.start();
		await settle();

		assert.deepEqual(
			harness.events.at(-1),
			{ type: 'failed', message, retrying: false },
			message,
		);
		assert.equal(harness.schedule.armed, false, message);
		assert.equal(harness.clock.armed, 0, message);
	}
});

test('a transport failure is retried rather than treated as needing a person', () => {
	for (const message of [
		'Session transport closed during connect.',
		'Session connect timed out after 20000ms.',
		'Terminay did not answer the signaling request in time.',
	]) {
		assert.equal(isUnrecoverableConnectFailure(new Error(message)), false, message);
	}
});

test('no attempt runs while the document is hidden, and one runs on becoming visible', async () => {
	let hidden = false;
	const harness = createLoop({ isHidden: () => hidden });
	harness.connect();
	harness.loop.start();
	await settle();
	assert.equal(harness.attempts.length, 1);

	hidden = true;
	harness.clock.fire();
	await settle();
	assert.equal(harness.attempts.length, 1, 'a hidden document runs no attempt');

	hidden = false;
	harness.loop.resume();
	await settle();
	assert.equal(harness.attempts.length, 2, 'becoming visible runs the held attempt');
});

test('probeNow asks immediately without advancing the heartbeat interval', async () => {
	const clock = createClock();
	let probes = 0;
	let lost = 0;
	const heartbeat = createSessionHeartbeat({
		ping: async () => {
			probes += 1;
			throw new Error('dead');
		},
		onLost: () => { lost += 1; },
		missLimit: 1,
		intervalMs: 10_000,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
	});
	heartbeat.start();
	assert.equal(probes, 0);

	heartbeat.probeNow();
	await settle();
	assert.equal(probes, 1, 'the probe ran without the interval elapsing');
	assert.equal(lost, 1, 'a failed probe reports the connection lost at once');
	heartbeat.stop();
});

test('an answered probe on becoming visible changes nothing', async () => {
	const clock = createClock();
	let probes = 0;
	let lost = 0;
	const heartbeat = createSessionHeartbeat({
		ping: async () => { probes += 1; },
		onLost: () => { lost += 1; },
		intervalMs: 10_000,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
	});
	heartbeat.start();
	heartbeat.probeNow();
	await settle();

	assert.equal(probes, 1);
	assert.equal(lost, 0);
	assert.equal(heartbeat.snapshot().missed, 0);
	heartbeat.stop();
});

/** Let the loop's awaited attempt settle without waiting on real time. */
async function settle() {
	for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
}
