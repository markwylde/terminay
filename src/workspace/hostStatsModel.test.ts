import assert from 'node:assert/strict';
import test from 'node:test';
import type { HostStatsSample } from '@terminay/protocol';
import {
	appendHostStatsSample,
	formatHostStatsRate,
	hostStatsItems,
	hostStatsSparklinePoints,
} from './hostStatsModel.ts';

const sample = (at: number, overrides: Partial<HostStatsSample> = {}): HostStatsSample => ({
	at,
	intervalMs: 5000,
	cpu: { percent: 42.4, cores: 8 },
	memory: { usedBytes: 6 * 1024 ** 3, totalBytes: 16 * 1024 ** 3 },
	network: { receivedBytesPerSecond: 1024 * 1024, sentBytesPerSecond: 200 * 1024 },
	disk: { readBytesPerSecond: 0, writtenBytesPerSecond: 512 },
	...overrides,
});

test('history is bounded, newest last', () => {
	let history: HostStatsSample[] = [];
	for (let at = 0; at < 40; at += 1) history = appendHostStatsSample(history, sample(at), 30);
	assert.equal(history.length, 30);
	assert.equal(history[0]?.at, 10);
	assert.equal(history.at(-1)?.at, 39);
});

test('placeholders before the first sample', () => {
	const items = hostStatsItems([]);
	assert.deepEqual(
		items.map((item) => [item.label, item.figure]),
		[
			['CPU', null],
			['MEM', null],
			['NET', null],
			['DISK', null],
		],
	);
});

test('figures and tooltip detail for each metric', () => {
	const items = hostStatsItems([sample(1)], 'Host');
	const by = Object.fromEntries(items.map((item) => [item.metric, item]));
	assert.equal(by.cpu?.figure, '42%');
	assert.equal(by.cpu?.detail, 'Host CPU 42% of 8 cores');
	assert.equal(by.memory?.figure, '38%');
	assert.equal(by.memory?.detail, 'Host Memory 38%: 6.0 GB used of 16.0 GB');
	assert.equal(by.network?.figure, '1.2 MB/s');
	assert.equal(by.network?.detail, 'Host Network: 1.0 MB/s received, 200 KB/s sent');
	assert.equal(by.disk?.figure, '512 B/s');
	assert.equal(by.disk?.detail, 'Host Disk I/O: 0 B/s read, 512 B/s written');
	assert.equal(by.cpu?.max, 100);
});

test('an unavailable metric is left out, not shown as zero', () => {
	const items = hostStatsItems([sample(1, { disk: null, network: null })]);
	assert.deepEqual(
		items.map((item) => item.metric),
		['cpu', 'memory'],
	);
});

test('rate graphs scale to the busiest sample in view', () => {
	const items = hostStatsItems([
		sample(1, { network: { receivedBytesPerSecond: 10_000, sentBytesPerSecond: 0 } }),
		sample(2, { network: { receivedBytesPerSecond: 40_000, sentBytesPerSecond: 0 } }),
	]);
	const network = items.find((item) => item.metric === 'network');
	assert.deepEqual(network?.values, [10_000, 40_000]);
	assert.equal(network?.max, 40_000);
});

test('rates read in short human units', () => {
	assert.equal(formatHostStatsRate(0), '0 B/s');
	assert.equal(formatHostStatsRate(1536), '1.5 KB/s');
	assert.equal(formatHostStatsRate(5 * 1024 ** 2), '5.0 MB/s');
});

test('sparkline points sit newest at the right, scaled to the graph', () => {
	assert.equal(hostStatsSparklinePoints([], 100, 30, 10), '');
	assert.equal(hostStatsSparklinePoints([0, 100], 100, 30, 10, 4), '20,9.5 30,0.5');
	assert.equal(hostStatsSparklinePoints([200], 100, 30, 10, 4), '30,0.5');
});
