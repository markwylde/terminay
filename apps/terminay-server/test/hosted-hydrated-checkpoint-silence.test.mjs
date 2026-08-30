import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	applyHostedLaneDiagnostic,
	HostedPeerLifecycle,
} from '../src/remote/hostedPeerLifecycle.ts';
import { createHostedStreamDiagnostics } from '../src/remote/hostedStreamDiagnostics.ts';

function livePeer() {
	return { connectionState: 'connected', iceConnectionState: 'connected' };
}

test('outbound-stalled after checkpoint hydrate fails the generation while the peer stays connected', () => {
	const reasons = [];
	const peer = livePeer();
	const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) =>
		reasons.push(reason),
	);
	let now = 0;
	const events = [];
	const stream = createHostedStreamDiagnostics({
		emit(event) {
			events.push(event);
			applyHostedLaneDiagnostic(lifecycle, event);
		},
		now: () => now,
		stallMs: 3_000,
		summaryMs: 60_000,
		setIntervalFn: () => 1,
		clearIntervalFn: () => undefined,
	});

	stream.peerState('connected', 'connected');
	now = 1_000;
	stream.noteInbound(new Uint8Array(477));
	stream.noteOutbound(363);
	now = 5_000;
	stream.noteInbound(new Uint8Array(10));

	assert.equal(
		events.some((event) => event.stallClass === 'outbound-stalled'),
		true,
	);
	assert.equal(peer.connectionState, 'connected');
	assert.notEqual(reasons.length, 0);
	assert.match(String(reasons[0]), /stall|application lane|outbound/iu);
});

test('required application lane close while the peer stays connected fails the generation', () => {
	const reasons = [];
	const peer = livePeer();
	const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) =>
		reasons.push(reason),
	);
	applyHostedLaneDiagnostic(lifecycle, {
		channel: 'application',
		channelState: 'closed',
	});
	assert.notEqual(reasons.length, 0);
	assert.match(String(reasons[0]), /application|lane/iu);
});

test('required control lane close while the peer stays connected fails the generation', () => {
	const reasons = [];
	const peer = livePeer();
	const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) =>
		reasons.push(reason),
	);
	applyHostedLaneDiagnostic(lifecycle, {
		channel: 'control',
		channelState: 'closed',
	});
	assert.notEqual(reasons.length, 0);
});

test('handshake-only api and asset channel close does not fail a live generation', () => {
	const reasons = [];
	const peer = livePeer();
	const lifecycle = new HostedPeerLifecycle(peer, 5_000, (reason) =>
		reasons.push(reason),
	);
	applyHostedLaneDiagnostic(lifecycle, {
		channel: 'api',
		channelState: 'closed',
	});
	applyHostedLaneDiagnostic(lifecycle, {
		channel: 'asset',
		channelState: 'closed',
	});
	applyHostedLaneDiagnostic(lifecycle, {
		channel: 'application',
		channelState: 'open',
	});
	assert.deepEqual(reasons, []);
});
