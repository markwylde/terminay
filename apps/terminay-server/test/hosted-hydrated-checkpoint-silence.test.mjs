import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	APPLICATION_STALL_FAIL_GRACE_MS,
	applyHostedLaneDiagnostic,
	HostedPeerLifecycle,
	shouldFailHostedStall,
} from '../src/remote/hostedPeerLifecycle.ts';
import { createHostedStreamDiagnostics } from '../src/remote/hostedStreamDiagnostics.ts';

function livePeer() {
	return { connectionState: 'connected', iceConnectionState: 'connected' };
}

test('handshake inbound after a checkpoint dump does not fail a generation on a 4s outbound pause', () => {
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
	for (let i = 0; i < 184; i += 1) stream.noteOutbound(3_000);
	now = 5_134;
	stream.noteInbound(new Uint8Array(10));

	assert.equal(
		events.some((event) => event.stallClass === 'outbound-stalled'),
		true,
	);
	assert.equal(
		events.some(
			(event) =>
				event.stallClass === 'outbound-stalled' &&
				(event.firstOutboundAgeMs ?? 0) < APPLICATION_STALL_FAIL_GRACE_MS,
		),
		true,
	);
	assert.deepEqual(reasons, []);
	const stall = events.find((event) => event.stallClass === 'outbound-stalled');
	assert.equal(shouldFailHostedStall(stall), false);
});

test('five seconds of outbound silence does not close the peer', () => {
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
	now = 6_000;
	stream.noteInbound(new Uint8Array(10));

	assert.equal(
		events.some((event) => event.stallClass === 'outbound-stalled'),
		true,
	);
	assert.equal(peer.connectionState, 'connected');
	assert.deepEqual(reasons, []);
	assert.equal(shouldFailHostedStall({ stallClass: 'outbound-stalled' }), false);
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
