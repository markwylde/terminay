import assert from 'node:assert/strict';
import test from 'node:test';
import {
	runSleepNetworkProbe,
	SLEEP_NETWORK_PROFILE,
} from './task20-sleep-network.mjs';

const EXPECTED = {
	attemptsStarted: 2,
	attemptsWhileAsleep: null,
	attemptsWhileOffline: null,
	closedAttempts: [1],
	connected: true,
	maxPendingReconnects: 1,
	pendingReconnects: 0,
	recovered: true,
	staleCompletionAccepted: false,
	timeline: [
		'request:network-loss',
		'attempt:1',
		'close:1:offline',
		'request:offline-change-1',
		'request:offline-change-2',
		'request:offline-change-3',
		'sleep',
		'request:online-during-sleep',
		'wake',
		'attempt:2',
		'connected:2',
		'close:1:stale',
	],
};

test('sleep and network changes coalesce reconnects and recover with one fresh attempt', () => {
	assert.deepEqual(runSleepNetworkProbe(), EXPECTED);
});

test('offline and sleeping states allocate no connection attempt', () => {
	const result = runSleepNetworkProbe();
	assert.equal(result.attemptsWhileOffline, null);
	assert.equal(result.attemptsWhileAsleep, null);
	assert.equal(
		result.maxPendingReconnects,
		SLEEP_NETWORK_PROFILE.maxPendingReconnects,
	);
});

test('the transition probe is deterministic and rejects an unbounded admission profile', () => {
	assert.deepEqual(runSleepNetworkProbe(), runSleepNetworkProbe());
	assert.throws(
		() =>
			runSleepNetworkProbe({
				...SLEEP_NETWORK_PROFILE,
				maxPendingReconnects: 2,
			}),
		/admission must be exactly one/,
	);
	assert.throws(
		() => runSleepNetworkProbe({ ...SLEEP_NETWORK_PROFILE, maxAttempts: 1 }),
		/requires at least two attempts/,
	);
});
