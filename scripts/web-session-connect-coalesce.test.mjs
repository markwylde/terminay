import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionConnectGate } from '../src/web/sessionConnectAttempt.ts';

test('first mount, recovery, and Retry share one in-flight attempt', () => {
	const gate = new SessionConnectGate();
	const first = gate.begin();
	assert.equal(first?.generation, 1);
	assert.equal(gate.begin(), undefined);
	assert.equal(gate.inFlight, true);
	gate.finish(first);
	assert.equal(gate.inFlight, false);
	const retry = gate.begin();
	assert.equal(retry?.generation, 2);
	assert.equal(gate.begin(), undefined);
});

test('closed from a retired generation does not start recovery', () => {
	const gate = new SessionConnectGate();
	const first = gate.begin();
	gate.finish(first);
	const second = gate.begin();
	gate.finish(second);
	assert.equal(gate.shouldRecoverFromClose(first), false);
	assert.equal(gate.shouldRecoverFromClose(second), true);
});

test('closed during an in-flight attempt is coalesced, not a competing join', () => {
	const gate = new SessionConnectGate();
	const attempt = gate.begin();
	assert.equal(gate.shouldRecoverFromClose(attempt), false);
	assert.equal(gate.begin(), undefined);
	gate.finish(attempt);
	assert.equal(gate.shouldRecoverFromClose(attempt), true);
});

test('a hung attempt expires then returns to retry-wait', async () => {
	const gate = new SessionConnectGate();
	const attempt = gate.begin();
	const timers = [];
	await assert.rejects(
		() =>
			gate.withDeadline(attempt, new Promise(() => undefined), {
				attemptTimeoutMs: 25,
				setTimeout: (callback, delayMs) => {
					assert.equal(delayMs, 25);
					timers.push(callback);
					callback();
					return callback;
				},
				clearTimeout: () => undefined,
			}),
		/timed out after 25ms/,
	);
	assert.equal(timers.length, 1);
	gate.finish(attempt);
	assert.equal(gate.inFlight, false);
	assert.equal(gate.begin()?.generation, 2);
});

test('finishing a retired attempt does not clear a newer in-flight connect', () => {
	const gate = new SessionConnectGate();
	const first = gate.begin();
	gate.finish(first);
	const second = gate.begin();
	gate.finish(first);
	assert.equal(gate.inFlight, true);
	assert.equal(gate.isCurrent(second), true);
	gate.finish(second);
	assert.equal(gate.inFlight, false);
});
