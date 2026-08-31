import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	classifySessionApplicationSilence,
	createSessionSilenceWatch,
	SessionConnectGate,
} from '../src/web/sessionConnectAttempt.ts';

test('a ready web session recovers when the application lane stalls without a closed event', () => {
	const gate = new SessionConnectGate();
	const attempt = gate.begin();
	gate.finish(attempt);
	assert.equal(gate.shouldRecoverFromClose(attempt), true);
	assert.equal(gate.shouldRecoverFromSilence(attempt, 'inbound-stalled'), true);
	assert.equal(gate.shouldRecoverFromSilence(attempt, 'no-inbound'), true);
});

test('web workspace reconnects and surfaces an error on application silence, not only on closed', async () => {
	const source = await readFile(
		new URL('../src/web/main.tsx', import.meta.url),
		'utf8',
	);
	assert.match(source, /shouldRecoverFromSilence/u);
	assert.match(
		source,
		/shouldRecoverFromSilence\([\s\S]*recoverConnection\(\)/u,
	);
	assert.match(source, /setError\(/u);
	assert.match(source, /Terminal stream stalled/u);
	assert.match(source, /logSessionLane/u);
	assert.match(source, /Reconnecting/u);
	assert.match(source, /session-workspace--reconnecting/u);
});

test('client stall class is inbound-stalled while keys leave and PTY does not return', () => {
	assert.equal(
		classifySessionApplicationSilence({
			inboundFrames: 4,
			outboundFrames: 8,
			lastInboundAt: 1_000,
			lastOutboundAt: 8_000,
			now: 8_000,
			stallMs: 3_000,
		}),
		'inbound-stalled',
	);
	assert.equal(
		classifySessionApplicationSilence({
			inboundFrames: 0,
			outboundFrames: 2,
			lastInboundAt: null,
			lastOutboundAt: 1_000,
			now: 5_000,
			stallMs: 3_000,
		}),
		'no-inbound',
	);
	assert.equal(
		classifySessionApplicationSilence({
			inboundFrames: 4,
			outboundFrames: 4,
			lastInboundAt: 8_000,
			lastOutboundAt: 2_000,
			now: 8_000,
			stallMs: 3_000,
		}),
		undefined,
	);
});

test('silence watch notifies once after outbound continues without inbound', () => {
	const stalls = [];
	let now = 0;
	const timers = [];
	const watch = createSessionSilenceWatch({
		onSilence: (stallClass) => stalls.push(stallClass),
		now: () => now,
		stallMs: 3_000,
		setTimeout: (callback, delayMs) => {
			timers.push({ callback, delayMs });
			return timers.length;
		},
		clearTimeout: () => undefined,
	});
	watch.noteOutbound();
	now = 3_000;
	assert.ok(timers.length >= 1);
	for (const timer of [...timers]) timer.callback();
	assert.deepEqual(stalls, ['no-inbound']);
	watch.noteOutbound();
	assert.deepEqual(stalls, ['no-inbound']);
	watch.stop();
});

test('silence watch samples application-lane counters while the session stays open', () => {
	const samples = [];
	let now = 0;
	const timers = [];
	const watch = createSessionSilenceWatch({
		onSilence: () => undefined,
		onSample: (snapshot) => samples.push(snapshot),
		now: () => now,
		stallMs: 30_000,
		sampleMs: 10_000,
		setTimeout: (callback, delayMs) => {
			timers.push({ callback, delayMs });
			return timers.length;
		},
		clearTimeout: () => undefined,
	});
	watch.noteInbound();
	watch.noteOutbound();
	now = 10_000;
	const sample = timers.find((timer) => timer.delayMs === 10_000);
	sample?.callback();
	assert.equal(samples.length, 1);
	assert.equal(samples[0]?.inboundFrames, 1);
	assert.equal(samples[0]?.outboundFrames, 1);
	watch.stop();
});

test('silence recovery is ignored while a connect is still in flight', () => {
	const gate = new SessionConnectGate();
	const attempt = gate.begin();
	assert.equal(
		gate.shouldRecoverFromSilence(attempt, 'inbound-stalled'),
		false,
	);
	gate.finish(attempt);
	assert.equal(gate.shouldRecoverFromSilence(attempt, undefined), false);
});
