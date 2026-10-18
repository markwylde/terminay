import assert from 'node:assert/strict';
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
 * These tests run against the artifact the server will actually load. Each
 * waits out real consent intervals, about five seconds apiece.
 */

const ARTIFACT = path.resolve('build/webrtc-runtime/artifact/lib/index.mjs');

async function loadRuntime() {
	return await import(pathToFileURL(ARTIFACT).href);
}

/** A connected ICE connection whose nominated pair answers as `answer` says. */
function connectedIce(runtime, answer) {
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
	ice.queryConsent();
	const stop = () => {
		ice.queryConsentHandle?.resolve?.();
		ice.state = 'closed';
	};
	return { requests, states, stop };
}

async function until(predicate, limitMs) {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > limitMs) return false;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	return true;
}

test('a consent check is retransmitted, so a slow answer keeps the path connected', async (t) => {
	const runtime = await loadRuntime().catch(() => undefined);
	if (runtime === undefined) {
		t.skip('the selected WebRTC runtime artifact is not staged');
		return;
	}
	// The answer arrives, but only to a retransmission of the check.
	const ice = connectedIce(runtime, async (_count, retransmissions) => {
		if (!(retransmissions > 0)) throw new Error('STUN transaction timed out');
	});
	try {
		assert.equal(await until(() => ice.requests.length >= 2, 15_000), true);
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
	const ice = connectedIce(runtime, async (count) => {
		if (count === 1) throw new Error('STUN transaction timed out');
	});
	try {
		assert.equal(
			await until(() => ice.states.includes('connected'), 15_000),
			true,
			'consent checks continued after the miss and restored the path',
		);
		assert.deepEqual(ice.states, ['disconnected', 'connected']);
	} finally {
		ice.stop();
	}
});
