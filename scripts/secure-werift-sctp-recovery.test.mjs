import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * Outbound delivery must always be able to recover.
 *
 * Upstream werift gates its transmit loop on the peer's advertised receive
 * window. When that window is zero and nothing is in flight, it sends nothing,
 * so no SACK can arrive to reopen the window, and the T3 timer has already
 * been cancelled because the sent queue drained. The association is then stuck
 * forever while ICE still reports `connected` and every lane reports `open` -
 * indistinguishable, to a user, from the frozen sessions this runtime is meant
 * to avoid. RFC 4960 6.1 rule A requires a zero-window probe; werift has none.
 *
 * These tests run against the artifact the server will actually load.
 */

const ARTIFACT = path.resolve('build/webrtc-runtime/artifact/lib/index.mjs');

async function loadRuntime() {
	return await import(pathToFileURL(ARTIFACT).href);
}

/** Reach the real SCTP association through a real peer connection. */
function association(runtime) {
	const peer = new runtime.RTCPeerConnection({});
	peer.createDataChannel('sctp-recovery-probe');
	return { peer, sctp: peer.sctpTransport.sctp };
}

test('a zero receive window with nothing in flight still transmits a probe', async (t) => {
	const runtime = await loadRuntime().catch(() => undefined);
	if (runtime === undefined) {
		t.skip('the selected WebRTC runtime artifact is not staged');
		return;
	}
	const { peer, sctp } = association(runtime);
	try {
		const sent = [];
		sctp.sendChunk = async (chunk) => {
			sent.push(chunk);
		};
		sctp.forwardTsnChunk = undefined;
		sctp.timer3Handle = undefined;
		sctp.timer3Start = () => {
			sctp.timer3Handle = 1;
		};
		sctp.timer3Restart = () => undefined;

		// The receiver has shut its window; the sender has nothing outstanding,
		// so nothing will arrive on its own to reopen it.
		sctp.peerAdvertisedRwnd = 0;
		sctp.flightSize = 0;
		sctp.cwnd = 4 * 1200;
		sctp.sentQueue = [];
		sctp.outboundQueue = [
			{ userData: Buffer.from('held'), bookSize: 4, sentCount: 0, tsn: 1, retransmit: false, misses: 0 },
		];

		await sctp.transmitOnce();

		assert.equal(sent.length, 1, 'exactly one chunk probes the closed window');
		assert.notEqual(sctp.timer3Handle, undefined, 'the probe arms T3 so a lost probe is retransmitted');
		assert.equal(sctp.flightSize > 0, true, 'the probe counts as in flight, so only one is outstanding');
	} finally {
		peer.close();
	}
});

test('an open receive window is unaffected by the probe path', async (t) => {
	const runtime = await loadRuntime().catch(() => undefined);
	if (runtime === undefined) {
		t.skip('the selected WebRTC runtime artifact is not staged');
		return;
	}
	const { peer, sctp } = association(runtime);
	try {
		const sent = [];
		sctp.sendChunk = async (chunk) => {
			sent.push(chunk);
		};
		sctp.forwardTsnChunk = undefined;
		sctp.timer3Handle = undefined;
		sctp.timer3Start = () => {
			sctp.timer3Handle = 1;
		};
		sctp.timer3Restart = () => undefined;
		sctp.peerAdvertisedRwnd = 64 * 1024;
		sctp.flightSize = 0;
		sctp.cwnd = 4 * 1200;
		sctp.sentQueue = [];
		sctp.outboundQueue = [
			{ userData: Buffer.from('one'), bookSize: 3, sentCount: 0, tsn: 1, retransmit: false, misses: 0 },
			{ userData: Buffer.from('two'), bookSize: 3, sentCount: 0, tsn: 2, retransmit: false, misses: 0 },
		];

		await sctp.transmitOnce();

		// Normal delivery drains the queue; the probe must not duplicate a chunk.
		assert.equal(sent.length, 2);
		assert.equal(sctp.outboundQueue.length, 0);
	} finally {
		peer.close();
	}
});

test('the data-channel flush is serialized against re-entrant sends', async () => {
	// datachannelSend calls dataChannelFlush without awaiting it, so a send
	// during an in-flight flush used to start a second loop over the same
	// shared queue. Two loops interleaving sends on one stream, and a trailing
	// unconditional queue reset, could drop concurrently queued frames.
	const bundle = await readFile(ARTIFACT, 'utf8').catch(() => undefined);
	if (bundle === undefined) return;
	assert.match(bundle, /dataChannelFlushing/u);
	assert.match(bundle, /dataChannelFlushRequested/u);
	assert.doesNotMatch(bundle, /\n\s*this\.dataChannelQueue = \[\];\n\s*\}\n\s*assertSendableMessageSize/u);
});
