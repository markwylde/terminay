import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CLIENT_SERVER_COMPATIBILITY,
	FEATURE_CAPABILITIES,
	HOST_STATS_CAPABILITY,
	clampHostStatsIntervalSeconds,
	parseHostStatsSample,
} from '../dist/index.js';

test('host stats is an optional feature capability', () => {
	assert.equal(FEATURE_CAPABILITIES.hostStats, HOST_STATS_CAPABILITY);
	assert.equal(CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.includes(HOST_STATS_CAPABILITY), true);
	assert.equal(CLIENT_SERVER_COMPATIBILITY.requiredCapabilities.includes(HOST_STATS_CAPABILITY), false);
});

test('an interval is whole seconds from 1 to 3600, defaulting to 5', () => {
	assert.equal(clampHostStatsIntervalSeconds(5), 5);
	assert.equal(clampHostStatsIntervalSeconds(0), 1);
	assert.equal(clampHostStatsIntervalSeconds(-4), 1);
	assert.equal(clampHostStatsIntervalSeconds(2.6), 3);
	assert.equal(clampHostStatsIntervalSeconds(99999), 3600);
	assert.equal(clampHostStatsIntervalSeconds('7'), 7);
	assert.equal(clampHostStatsIntervalSeconds(Number.NaN), 5);
	assert.equal(clampHostStatsIntervalSeconds(undefined), 5);
});

test('a sample is read defensively, keeping unavailable metrics null', () => {
	const sample = parseHostStatsSample({
		at: 1000,
		intervalMs: 5000,
		cpu: { percent: 140, cores: 8 },
		memory: { usedBytes: 20, totalBytes: 10 },
		network: { receivedBytesPerSecond: 3, sentBytesPerSecond: 4 },
		disk: null,
	});
	assert.deepEqual(sample, {
		at: 1000,
		intervalMs: 5000,
		cpu: { percent: 100, cores: 8 },
		memory: { usedBytes: 10, totalBytes: 10 },
		network: { receivedBytesPerSecond: 3, sentBytesPerSecond: 4 },
		disk: null,
	});
	assert.equal(parseHostStatsSample(null), null);
	assert.equal(parseHostStatsSample({ at: 'x', intervalMs: 1 }), null);
	assert.equal(parseHostStatsSample({ at: 1, intervalMs: 1, memory: { usedBytes: 1, totalBytes: 0 } }).memory, null);
});
