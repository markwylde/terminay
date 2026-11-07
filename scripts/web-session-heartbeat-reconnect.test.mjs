import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FEATURE_CAPABILITIES } from '@terminay/protocol';
import {
	createSessionHeartbeat,
	SESSION_RESUME_PROBE_DEADLINE_MS,
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
	// Liveness is proven per connection now: a window holds one heartbeat and
	// one recovery loop for each server it is attached to.
	const [session, registry, attempt] = await Promise.all([
		readFile(new URL('../src/web/main.tsx', import.meta.url), 'utf8'),
		readFile(
			new URL('../src/shared/connections/connectionRegistry.ts', import.meta.url),
			'utf8',
		),
		readFile(
			new URL('../src/web/sessionConnectAttempt.ts', import.meta.url),
			'utf8',
		),
	]);
	assert.match(registry, /createSessionHeartbeat/u);
	assert.match(registry, /connection\.ping/u);
	// The server arms its inbound-silence reaper only for a client that promises
	// to keep proving liveness. The promise is made through the capability
	// registry now, so a renamed capability cannot silently stop making it.
	assert.match(registry, /FEATURE_CAPABILITIES\.heartbeat/u);
	assert.equal(FEATURE_CAPABILITIES.heartbeat, 'connection.heartbeat');
	assert.match(registry, /onLost[\s\S]*recoverFromClose\(/u);
	assert.match(registry, /this\.error = 'Connection lost/u);
	assert.match(session, /Reconnecting/u);
	assert.match(session, /session-workspace--reconnecting/u);
	// Quiet output is not a liveness signal anywhere in the session client.
	for (const source of [session, registry, attempt]) {
		assert.doesNotMatch(source, /stallClass|SilenceWatch|shouldRecoverFromSilence/u);
	}
});

/** A probe that is only ever settled by its own deadline. */
const unanswered = (signal) =>
	new Promise((_resolve, reject) => {
		signal.addEventListener('abort', () => reject(new Error('no answer')), {
			once: true,
		});
	});

function suspendableHeartbeat(clock, ping, lost) {
	return createSessionHeartbeat({
		ping,
		onLost: (snapshot) => lost.push(snapshot),
		intervalMs: 100,
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
}

test('a probe whose deadline came due while the document was frozen is not a miss', async () => {
	const clock = createClock();
	const lost = [];
	let probes = 0;
	// The transport is healthy throughout; only the first probe is caught by
	// the freeze, so nothing reads its answer before its deadline.
	const heartbeat = suspendableHeartbeat(
		clock,
		(signal) => {
			probes += 1;
			return probes === 1 ? unanswered(signal) : Promise.resolve();
		},
		lost,
	);
	heartbeat.start();
	await clock.advance(100);
	assert.equal(probes, 1, 'a probe is outstanding when the lid closes');

	// Ten minutes pass in one step: the deadline's timer fires on thaw.
	await clock.advance(600_000);

	assert.equal(heartbeat.snapshot().missed, 0, 'sleep is not a missed probe');
	assert.equal(probes, 2, 'liveness is proven again immediately on thaw');
	for (let beat = 0; beat < 4; beat += 1) await clock.advance(100);
	assert.deepEqual(lost, [], 'an answering connection is not replaced');
	heartbeat.stop();
});

test('a transport that died during a freeze is retired by the probes that follow', async () => {
	const clock = createClock();
	const lost = [];
	const heartbeat = suspendableHeartbeat(clock, unanswered, lost);
	heartbeat.start();
	await clock.advance(100);
	await clock.advance(600_000);
	assert.deepEqual(lost, [], 'the frozen probe alone retires nothing');

	// Each probe from here runs its full deadline while the document is awake.
	await clock.advance(100);
	assert.deepEqual(lost, [], 'one on-time miss is not yet a failure');
	await clock.advance(100);
	await clock.advance(100);
	assert.equal(lost.length, 1, 'the miss limit of on-time probes retires it');
	assert.equal(lost[0].missed, 2);
	heartbeat.stop();
});

/**
 * The reported failure: back in the PWA after a minute away, nothing happens
 * for ten seconds or more. The phone killed the transport while the app was
 * suspended, but the peer still says `connected` and every lane is `open`, so
 * the only thing that can notice is a probe. With the steady-state deadline
 * and miss limit, that took two full intervals after the user came back.
 */
test('a transport that died while hidden is retired by one fast resume probe', async () => {
	const clock = createClock();
	const lost = [];
	// Production cadence: these are the numbers the user lives with.
	const heartbeat = createSessionHeartbeat({
		ping: unanswered,
		onLost: (snapshot) => lost.push({ at: clock.now, ...snapshot }),
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();
	await clock.advance(4_000);
	const resumedAt = clock.now;
	heartbeat.probeNow({
		deadlineMs: SESSION_RESUME_PROBE_DEADLINE_MS,
		decisive: true,
	});
	await clock.advance(SESSION_RESUME_PROBE_DEADLINE_MS);

	assert.equal(lost.length, 1, 'one missed resume probe retires the generation');
	assert.equal(
		lost[0].at - resumedAt <= 1_500,
		true,
		`loss was declared ${lost[0].at - resumedAt}ms after resume`,
	);
	heartbeat.stop();
});

test('a resume probe that is answered keeps the generation and the cadence', async () => {
	const clock = createClock();
	const lost = [];
	const samples = [];
	let pings = 0;
	const heartbeat = createSessionHeartbeat({
		ping: async () => {
			pings += 1;
		},
		onLost: (snapshot) => lost.push(snapshot),
		onSample: (snapshot) => samples.push(snapshot),
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();
	await clock.advance(3_000);
	heartbeat.probeNow({
		deadlineMs: SESSION_RESUME_PROBE_DEADLINE_MS,
		decisive: true,
	});
	await clock.advance(1);
	assert.equal(pings, 1);
	assert.equal(samples.at(-1).missed, 0);
	// The next steady-state beat is one interval after the resume probe.
	await clock.advance(10_000);
	assert.equal(pings, 2);
	assert.deepEqual(lost, []);
	heartbeat.stop();
});

test('a resume probe supersedes a probe still waiting out its frozen deadline', async () => {
	const clock = createClock();
	const lost = [];
	let probes = 0;
	const heartbeat = createSessionHeartbeat({
		// The first probe was sent just before the freeze and is never answered;
		// the transport is otherwise healthy.
		ping: (signal) => {
			probes += 1;
			return probes === 1 ? unanswered(signal) : Promise.resolve();
		},
		onLost: (snapshot) => lost.push(snapshot),
		now: () => clock.now,
		setTimeout: (callback, delayMs) => clock.setTimeout(callback, delayMs),
		clearTimeout: (handle) => clock.clearTimeout(handle),
	});
	heartbeat.start();
	await clock.advance(10_000);
	assert.equal(probes, 1);
	heartbeat.probeNow({
		deadlineMs: SESSION_RESUME_PROBE_DEADLINE_MS,
		decisive: true,
	});
	await clock.advance(1);
	// The stale probe's deadline later fires: it must count for nothing.
	await clock.advance(10_000);
	assert.deepEqual(lost, [], 'a superseded probe neither misses nor retires');
	assert.equal(heartbeat.snapshot().missed, 0);
	heartbeat.stop();
});
