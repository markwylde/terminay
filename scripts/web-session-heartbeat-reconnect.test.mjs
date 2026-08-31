import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	createSessionHeartbeat,
	SessionConnectGate,
} from '../src/web/sessionConnectAttempt.ts';

/**
 * The browser workspace proves its connection is alive by asking it.
 *
 * A WebRTC generation can stop delivering while every lane still reports
 * `open`, so the earlier build tried to infer death from quiet PTY output.
 * That could not tell an idle shell from a dead transport, and the resulting
 * false positives were reverted across four commits. The probe replaces it.
 */

/** Drives the heartbeat's timers by hand so no test waits on real time. */
function createClock() {
	let sequence = 0;
	const pending = new Map();
	let now = 0;
	return {
		get now() {
			return now;
		},
		setTimeout(callback, delayMs) {
			sequence += 1;
			pending.set(sequence, { callback, at: now + delayMs });
			return sequence;
		},
		clearTimeout(handle) {
			pending.delete(handle);
		},
		/** Fire every timer that is due, oldest first. */
		async advance(ms) {
			now += ms;
			for (let guard = 0; guard < 64; guard += 1) {
				const due = [...pending.entries()]
					.filter(([, timer]) => timer.at <= now)
					.sort((left, right) => left[1].at - right[1].at);
				if (due.length === 0) break;
				for (const [handle, timer] of due) {
					pending.delete(handle);
					timer.callback();
				}
				await Promise.resolve();
				await Promise.resolve();
			}
		},
	};
}

test('a responsive connection keeps beating and is never reported lost', async () => {
	const clock = createClock();
	const lost = [];
	let pings = 0;
	const heartbeat = createSessionHeartbeat({
		ping: async () => {
			pings += 1;
		},
		onLost: (snapshot) => lost.push(snapshot),
		intervalMs: 100,
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();
	for (let beat = 0; beat < 5; beat += 1) await clock.advance(100);

	assert.equal(pings >= 4, true, 'the probe repeats on its interval');
	assert.deepEqual(lost, [], 'an answering connection is never retired');
	assert.equal(heartbeat.snapshot().missed, 0);
	heartbeat.stop();
});

test('two consecutive missed probes retire the generation exactly once', async () => {
	const clock = createClock();
	const lost = [];
	const heartbeat = createSessionHeartbeat({
		ping: () => Promise.reject(new Error('no answer')),
		onLost: (snapshot) => lost.push(snapshot),
		intervalMs: 100,
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();

	await clock.advance(100);
	assert.deepEqual(lost, [], 'one missed probe is not yet a failure');

	await clock.advance(100);
	assert.equal(lost.length, 1, 'the second consecutive miss retires the generation');
	assert.equal(lost[0].missed, 2);

	// Recovery owns the connection from here; the heartbeat must not fire again.
	await clock.advance(1_000);
	assert.equal(lost.length, 1);
	heartbeat.stop();
});

test('a single missed probe followed by an answer does not retire the generation', async () => {
	const clock = createClock();
	const lost = [];
	let attempt = 0;
	const heartbeat = createSessionHeartbeat({
		ping: async () => {
			attempt += 1;
			// One dropped probe is a blip, not a dead transport.
			if (attempt === 1) throw new Error('no answer');
		},
		onLost: (snapshot) => lost.push(snapshot),
		intervalMs: 100,
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();
	await clock.advance(100);
	await clock.advance(100);
	await clock.advance(100);

	assert.deepEqual(lost, []);
	assert.equal(heartbeat.snapshot().missed, 0, 'an answer clears the miss streak');
	heartbeat.stop();
});

test('a stopped heartbeat issues no further probes', async () => {
	const clock = createClock();
	let pings = 0;
	const heartbeat = createSessionHeartbeat({
		ping: async () => {
			pings += 1;
		},
		onLost: () => assert.fail('a stopped heartbeat must not report a loss'),
		intervalMs: 100,
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();
	await clock.advance(100);
	const delivered = pings;
	heartbeat.stop();
	await clock.advance(1_000);
	assert.equal(pings, delivered);
});

test('heartbeat recovery is ignored while a connect is still in flight', () => {
	const gate = new SessionConnectGate();
	const attempt = gate.begin();
	assert.equal(gate.shouldRecoverFromClose(attempt), false);
	gate.finish(attempt);
	assert.equal(gate.shouldRecoverFromClose(attempt), true);
});

test('the web workspace probes liveness and no longer infers it from traffic', async () => {
	const [session, attempt] = await Promise.all([
		readFile(new URL('../src/web/main.tsx', import.meta.url), 'utf8'),
		readFile(
			new URL('../src/web/sessionConnectAttempt.ts', import.meta.url),
			'utf8',
		),
	]);
	assert.match(session, /createSessionHeartbeat/u);
	assert.match(session, /connection\.ping/u);
	// The server arms its inbound-silence reaper only for a client that promises
	// to keep proving liveness.
	assert.match(session, /'connection\.heartbeat'/u);
	assert.match(session, /onLost[\s\S]*recoverConnection\(\)/u);
	assert.match(session, /setError\(/u);
	assert.match(session, /Reconnecting/u);
	assert.match(session, /session-workspace--reconnecting/u);
	// Quiet output is not a liveness signal anywhere in the session client.
	for (const source of [session, attempt]) {
		assert.doesNotMatch(source, /stallClass|SilenceWatch|shouldRecoverFromSilence/u);
	}
});
