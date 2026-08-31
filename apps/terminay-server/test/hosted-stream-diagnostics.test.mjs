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
	stallClass,
} from '../src/remote/hostedStreamDiagnostics.ts';

test('inbound kind classifies bytes, blobs, and empty frames without reading payloads', () => {
	assert.equal(inboundKind(new Uint8Array([9, 9, 9])), 'bytes');
	assert.equal(inboundKind(new Blob([new Uint8Array([9])])), 'blob');
	assert.equal(inboundKind(''), 'empty');
	assert.equal(inboundKind('echo secret'), 'string');
});

test('host stall class uses first inbound time so later keys cannot hide a silent PTY', () => {
	assert.equal(
		stallClass({
			inboundFrames: 4,
			outboundFrames: 0,
			firstInboundAt: 1_000,
			lastInboundAt: 8_000,
			lastOutboundAt: null,
			now: 4_500,
			stallMs: 3_000,
		}),
		'no-outbound',
	);
	assert.equal(
		stallClass({
			inboundFrames: 4,
			outboundFrames: 2,
			firstInboundAt: 1_000,
			lastInboundAt: 8_000,
			lastOutboundAt: 2_000,
			now: 8_000,
			stallMs: 3_000,
		}),
		'outbound-stalled',
	);
	assert.equal(
		stallClass({
			inboundFrames: 1,
			outboundFrames: 0,
			firstInboundAt: 1_000,
			lastInboundAt: 1_000,
			lastOutboundAt: null,
			now: 2_000,
			stallMs: 3_000,
		}),
		undefined,
	);
});

test('application-lane events carry counters and stall class, never frame bytes', () => {
	let now = 1_000;
	const events = [];
	const stream = createHostedStreamDiagnostics({
		emit: (event) => events.push(event),
		now: () => now,
		stallMs: 3_000,
		summaryMs: 60_000,
		setIntervalFn: () => 1,
		clearIntervalFn: () => undefined,
	});
	stream.noteInbound(new Uint8Array([1, 2, 3, 4]));
	now = 2_000;
	stream.noteInbound(new Uint8Array([5, 6]));
	now = 5_000;
	stream.noteInbound(new Uint8Array([7]));
	const stall = events.filter((event) => event.stallClass === 'no-outbound');
	assert.equal(stall.length, 1);
	assert.equal(stall[0].inboundFrames, 3);
	assert.equal(stall[0].outboundFrames, 0);
	assert.equal(stall[0].inboundKind, 'bytes');
	assert.doesNotMatch(JSON.stringify(events), /1,2,3,4/u);
	assert.equal('payload' in stall[0], false);
	assert.equal('data' in stall[0], false);
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
		classifyPeerCloseReason('WebRTC application lane outbound-stalled.'),
		'outbound-stalled',
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
		stallClass: 'no-outbound',
		firstInboundAgeMs: 4_000,
		firstOutboundAgeMs: null,
		liveGenerationCount: 3,
		stallIgnored: true,
	});
	assert.equal(mapped.event, 'local-server.remote-webrtc.application-lane');
	assert.equal(mapped.source, 'remote-webrtc');
	assert.equal(mapped.fields.stallClass, 'no-outbound');
	assert.equal(mapped.fields.stallIgnored, true);
	assert.equal(mapped.fields.liveGenerationCount, 3);
	assert.equal(mapped.fields.firstInboundAgeMs, 4_000);
	assert.equal(mapped.severity, 'warning');
	assert.equal('pairingUrl' in mapped.fields, false);
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
			stallClass: 'no-outbound',
			inboundKind: 'blob',
		});
		const body = lines.join('');
		assert.match(body, /"component":"hosted-remote"/u);
		assert.match(body, /"stallClass":"no-outbound"/u);
		assert.doesNotMatch(body, /pairing\.terminay|wss:\/\//u);
		await readFile(sink, 'utf8').catch(() => '');
	} finally {
		process.stderr.write = original;
	}
});
