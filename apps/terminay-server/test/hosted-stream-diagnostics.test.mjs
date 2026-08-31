import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hostedPairingDiagnosticEvent } from '../../../electron/remote/hostedPairingDiagnostics.ts';
import { createHostedDiagnosticLogger } from '../src/remote/hostedDiagnosticLog.ts';
import {
	classifyPeerCloseReason,
	createHostedStreamDiagnostics,
	inboundKind,
} from '../src/remote/hostedStreamDiagnostics.ts';

test('inbound kind classifies bytes, blobs, and empty frames without reading payloads', () => {
	assert.equal(inboundKind(new Uint8Array([9, 9, 9])), 'bytes');
	assert.equal(inboundKind(new Blob([new Uint8Array([9])])), 'blob');
	assert.equal(inboundKind(''), 'empty');
	assert.equal(inboundKind('echo secret'), 'string');
});

test('application-lane events carry counters, never frame bytes', () => {
	let now = 1_000;
	const events = [];
	const stream = createHostedStreamDiagnostics({
		emit: (event) => events.push(event),
		now: () => now,
		summaryMs: 60_000,
		setIntervalFn: () => 1,
		clearIntervalFn: () => undefined,
	});
	stream.noteInbound(new Uint8Array([1, 2, 3, 4]));
	now = 2_000;
	stream.noteInbound(new Uint8Array([5, 6]));
	now = 5_000;
	stream.noteInbound(new Uint8Array([7]));
	const lane = events.filter((event) => event.type === 'application-lane');
	assert.equal(lane.length, 1, 'only the first inbound frame reports a lane transition');
	assert.equal(lane[0].inboundFrames, 1);
	assert.equal(lane[0].inboundKind, 'bytes');
	assert.doesNotMatch(JSON.stringify(events), /1,2,3,4/u);
	assert.equal('payload' in lane[0], false);
	assert.equal('data' in lane[0], false);
	// Quiet output is not a liveness signal. Nothing classifies a stall.
	assert.equal(events.some((event) => 'stallClass' in event), false);
	stream.stop();
});

test('peer-closed classifies ICE grace expiry without echoing the raw reason', () => {
	assert.equal(
		classifyPeerCloseReason(
			'WebRTC recovery grace period expired (peer: disconnected, ICE: disconnected).',
		),
		'ice-grace-expired',
	);
	assert.equal(
		classifyPeerCloseReason('WebRTC peer replaced by a device rejoin.'),
		'replaced-by-rejoin',
	);
	assert.equal(
		classifyPeerCloseReason('WebRTC application heartbeat timed out.'),
		'heartbeat-timeout',
	);
	assert.equal(
		classifyPeerCloseReason('WebRTC application lane closed.'),
		'required-lane-closed',
	);
	const events = [];
	const stream = createHostedStreamDiagnostics({
		emit: (event) => events.push(event),
		setIntervalFn: () => 1,
		clearIntervalFn: () => undefined,
	});
	stream.peerClosed(
		'WebRTC recovery grace period expired (peer: disconnected, ICE: disconnected).',
	);
	assert.equal(events.at(-1).type, 'peer-closed');
	assert.equal(events.at(-1).reasonClass, 'ice-grace-expired');
	assert.equal('reason' in events.at(-1), false);
});

test('Desktop mapper keeps stream events payload-free and namespaced', () => {
	const mapped = hostedPairingDiagnosticEvent({
		type: 'application-lane',
		channel: 'application',
		inboundFrames: 3,
		outboundFrames: 0,
		inboundKind: 'bytes',
		firstInboundAgeMs: 4_000,
		firstOutboundAgeMs: null,
		liveGenerationCount: 1,
	});
	assert.equal(mapped.event, 'local-server.remote-webrtc.application-lane');
	assert.equal(mapped.source, 'remote-webrtc');
	assert.equal(mapped.fields.liveGenerationCount, 1);
	assert.equal(mapped.fields.firstInboundAgeMs, 4_000);
	// Lane counters are observation, not a fault: quiet output is normal and no
	// longer reported as a warning.
	assert.equal(mapped.severity, 'info');
	assert.equal('pairingUrl' in mapped.fields, false);
	assert.equal('stallClass' in mapped.fields, false);
	assert.equal('stallIgnored' in mapped.fields, false);
});

test('a required lane closing after it opened is reported as a hangup', () => {
	const events = [];
	const stream = createHostedStreamDiagnostics({
		emit: (event) => events.push(event),
		setIntervalFn: () => 1,
		clearIntervalFn: () => undefined,
	});
	stream.peerState('connected', 'connected');
	stream.channelState('control', 'closed', true);
	const closed = events.find((event) => event.channel === 'control');
	assert.equal(closed.hangup, true);
	assert.equal(closed.channelState, 'closed');
	const mapped = hostedPairingDiagnosticEvent(closed);
	assert.equal(mapped.severity, 'warning');
	assert.equal(mapped.fields.hangup, true);
	assert.equal(mapped.fields.channel, 'control');

	// A bootstrap lane closing after its transfer is normal and never a hangup.
	stream.channelState('asset', 'closed', false);
	const bootstrap = events.find((event) => event.channel === 'asset');
	assert.equal(bootstrap.hangup, false);
});

test('standalone logger writes JSON lines to stderr without pairing URLs', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-hosted-log-'));
	const sink = join(directory, 'server.jsonl');
	const lines = [];
	const original = process.stderr.write;
	process.stderr.write = (chunk) => {
		lines.push(String(chunk));
		return true;
	};
	try {
		const log = createHostedDiagnosticLogger(sink);
		log({
			type: 'application-lane',
			inboundFrames: 2,
			outboundFrames: 0,
			inboundKind: 'blob',
		});
		const body = lines.join('');
		assert.match(body, /"component":"hosted-remote"/u);
		assert.match(body, /"inboundKind":"blob"/u);
		assert.doesNotMatch(body, /pairing\.terminay|wss:\/\//u);
		await readFile(sink, 'utf8').catch(() => '');
	} finally {
		process.stderr.write = original;
	}
});
