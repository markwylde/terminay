import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * A path that answers slowly, or misses one consent check, must stay usable.
 *
 * Upstream werift sends each ICE consent check once, with no retransmission,
 * and gives up on it after 50 ms. On the first check that is not answered in
 * time it reports ICE `disconnected` and stops checking altogether, so nothing
 * can ever report the path `connected` again. Any path slower than 50 ms -
 * most of the internet, or loopback on a starved machine - is then reported
 * lost about five seconds after it connects, and Desktop ends the connection
 * fifteen seconds later. RFC 7675 retransmits consent checks and expires
 * consent only after 30 seconds without an answer.
 *
 * These tests run against the artifact the server will actually load. The
 * consent interval is driven by mocked timers, so each check happens when the
 * test says and nothing waits on a clock.
 */

const ARTIFACT = path.resolve('build/webrtc-runtime/artifact/lib/index.mjs');

async function loadRuntime() {
	return await import(pathToFileURL(ARTIFACT).href);
}

/** A connected ICE connection whose nominated pair answers as `answer` says. */
function connectedIce(t, runtime, answer) {
	const ice = new runtime.Connection(true, {});
	ice.localUsername = 'local';
	ice.remoteUsername = 'remote';
	ice.remotePassword = 'remote-password';
	const requests = [];
	ice.nominated = {
		id: 'nominated',
		localCandidate: new runtime.Candidate(
			'foundation',
			1,
			'udp',
			1,
			'127.0.0.1',
			40_000,
			'host',
		),
		remoteAddr: ['127.0.0.1', 40_001],
		consentRequestsSent: 0,
		requestsSent: 0,
		responsesReceived: 0,
		retransmissionsSent: 0,
		protocol: {
			request: async (_request, _addr, _key, retransmissions) => {
				requests.push(retransmissions);
				await answer(requests.length, retransmissions);
			},
		},
	};
	const states = [];
	ice.state = 'connected';
	ice.stateChanged.subscribe((state) => states.push(state));
	t.mock.timers.enable({ apis: ['setTimeout'] });
	// The runtime imports node:timers/promises as an ES module, which sees the
	// mocked timers only once the builtin exports are synced.
	syncBuiltinESMExports();
	ice.queryConsent();
	/** Let the next consent check run, and everything it settles. */
	const nextCheck = async () => {
		// Past the longest randomized interval: 5 s x 1.2.
		t.mock.timers.tick(6_000);
		for (let turn = 0; turn < 10; turn += 1)
			await new Promise((resolveTurn) => setImmediate(resolveTurn));
	};
	const stop = () => {
		ice.queryConsentHandle?.resolve?.();
		ice.state = 'closed';
		t.mock.timers.reset();
		syncBuiltinESMExports();
	};
	return { nextCheck, requests, states, stop };
}

test('a consent check is retransmitted, so a slow answer keeps the path connected', async (t) => {
	const runtime = await loadRuntime().catch(() => undefined);
	if (runtime === undefined) {
		t.skip('the selected WebRTC runtime artifact is not staged');
		return;
	}
	// The answer arrives, but only to a retransmission of the check.
	const ice = connectedIce(t, runtime, async (_count, retransmissions) => {
		if (!(retransmissions > 0)) throw new Error('STUN transaction timed out');
	});
	try {
		await ice.nextCheck();
		await ice.nextCheck();
		assert.equal(ice.requests.length, 2, 'checking goes on');
		assert.equal(
			ice.requests.every((retransmissions) => retransmissions > 0),
			true,
		);
		assert.deepEqual(ice.states, [], 'the path was never reported lost');
	} finally {
		ice.stop();
	}
});

test('a missed consent check is not the end: the next answer reports the path connected again', async (t) => {
	const runtime = await loadRuntime().catch(() => undefined);
	if (runtime === undefined) {
		t.skip('the selected WebRTC runtime artifact is not staged');
		return;
	}
	const ice = connectedIce(t, runtime, async (count) => {
		if (count === 1) throw new Error('STUN transaction timed out');
	});
	try {
		await ice.nextCheck();
		assert.deepEqual(ice.states, ['disconnected'], 'the miss is reported');
		await ice.nextCheck();
		assert.deepEqual(
			ice.states,
			['disconnected', 'connected'],
			'consent checks continued after the miss and restored the path',
		);
	} finally {
		ice.stop();
	}
});
