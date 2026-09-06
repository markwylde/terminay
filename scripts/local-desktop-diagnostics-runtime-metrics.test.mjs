import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	DesktopRuntimeMetrics,
	RUNTIME_METRICS_INTERVAL_MS,
	RUNTIME_METRICS_RING_CAPACITY,
} = await importBundled('../electron/diagnostics/runtimeMetrics.ts');

function createClock() {
	let now = 1_000;
	const intervals = [];
	return {
		now: () => now,
		advance(ms) {
			now += ms;
		},
		setInterval(handler, ms) {
			const id = { handler, ms };
			intervals.push(id);
			return id;
		},
		clearInterval(id) {
			const index = intervals.indexOf(id);
			if (index >= 0) intervals.splice(index, 1);
		},
		tick(times = 1) {
			for (let count = 0; count < times; count += 1) {
				now += RUNTIME_METRICS_INTERVAL_MS;
				for (const interval of [...intervals]) interval.handler();
			}
		},
		count: () => intervals.length,
	};
}

function createApp(cpu = 12.5) {
	return {
		getAppMetrics: () => [
			{
				cpu: { idleWakeupsPerSecond: 3, percentCPUUsage: cpu },
				memory: { workingSetSize: 4_096 },
				name: 'Tab',
				pid: 101,
				serviceName: 'Network Service',
				type: 'Tab',
			},
			{
				cpu: { idleWakeupsPerSecond: 1, percentCPUUsage: 2 },
				memory: { workingSetSize: 2_048 },
				pid: 102,
				type: 'Browser',
			},
		],
	};
}

const memoryUsage = () => ({
	arrayBuffers: 0,
	external: 0,
	heapTotal: 40,
	heapUsed: 20,
	rss: 90,
});

function createMetrics(overrides = {}) {
	const clock = createClock();
	const metrics = new DesktopRuntimeMetrics({
		app: createApp(),
		clock,
		memoryUsage,
		createEventLoopDelay: () => ({
			enable() {},
			disable() {},
			reset() {},
			min: 1e6,
			mean: 2e6,
			max: 4e6,
			percentile: () => 3e6,
		}),
		...overrides,
	});
	return { clock, metrics };
}

test('nothing is sampled until a window subscribes', () => {
	const { clock, metrics } = createMetrics();
	assert.equal(metrics.isRunning(), false);
	clock.tick(3);
	assert.equal(metrics.samples().length, 0);

	const release = metrics.subscribe();
	assert.equal(metrics.isRunning(), true);
	clock.tick(2);
	assert.equal(metrics.samples().length, 2);
	release();
});

test('sampling stops when the last subscriber releases', () => {
	const { clock, metrics } = createMetrics();
	const first = metrics.subscribe();
	const second = metrics.subscribe();
	assert.equal(metrics.subscriberCount(), 2);

	first();
	assert.equal(metrics.isRunning(), true, 'one subscriber still holds it');

	second();
	assert.equal(metrics.isRunning(), false);
	assert.equal(clock.count(), 0, 'the interval was cleared');
	assert.equal(metrics.samples().length, 0, 'the ring is released');

	// Releasing twice must not underflow the refcount.
	second();
	assert.equal(metrics.subscriberCount(), 0);
});

test('the ring overwrites at capacity and keeps the newest samples', () => {
	const { clock, metrics } = createMetrics();
	const release = metrics.subscribe();
	clock.tick(RUNTIME_METRICS_RING_CAPACITY + 25);

	const samples = metrics.samples();
	assert.equal(samples.length, RUNTIME_METRICS_RING_CAPACITY);
	for (let index = 1; index < samples.length; index += 1) {
		assert.ok(
			samples[index].at > samples[index - 1].at,
			'samples are not oldest-first',
		);
	}
	release();
});

test('a sample carries only the permitted fields', () => {
	const { metrics } = createMetrics();
	const release = metrics.subscribe();
	const sample = metrics.sampleNow();

	assert.deepEqual(Object.keys(sample).sort(), [
		'at',
		'eventLoop',
		'heapTotalBytes',
		'heapUsedBytes',
		'maxCpuPercent',
		'processes',
		'rssBytes',
	]);
	assert.deepEqual(Object.keys(sample.processes[0]).sort(), [
		'cpuPercent',
		'idleWakeupsPerSecond',
		'memoryWorkingSetKiB',
		'name',
		'pid',
		'serviceName',
		'type',
	]);
	assert.deepEqual(Object.keys(sample.eventLoop).sort(), [
		'maxMs',
		'meanMs',
		'minMs',
		'p50Ms',
		'p99Ms',
	]);
	assert.equal(sample.maxCpuPercent, 12.5);
	release();
});

test('a failing subscriber callback does not stop sampling', () => {
	const { clock, metrics } = createMetrics({
		onSample: () => {
			throw new Error('subscriber exploded');
		},
	});
	const release = metrics.subscribe();
	clock.tick(3);
	assert.equal(metrics.samples().length, 3);
	release();
});

test('unreadable process metrics and memory degrade to an empty sample', () => {
	const { metrics } = createMetrics({
		app: {
			getAppMetrics: () => {
				throw new Error('metrics unavailable');
			},
		},
		memoryUsage: () => {
			throw new Error('memory unavailable');
		},
	});
	const release = metrics.subscribe();
	const sample = metrics.sampleNow();
	assert.deepEqual(sample.processes, []);
	assert.equal(sample.maxCpuPercent, 0);
	assert.equal(sample.rssBytes, 0);
	release();
});

test('the collector never traces, stacks, writes, or counts IPC channels', async () => {
	const source = await readFile(
		new URL('../electron/diagnostics/runtimeMetrics.ts', import.meta.url),
		'utf8',
	);
	for (const forbidden of [
		'contentTracing',
		'startRecording',
		'collectJavaScriptCallStack',
		'node:fs',
		'writeFile',
		'./service',
		'./preferences',
		'ipc-message',
		'DesktopDiagnostics',
	]) {
		assert.ok(
			!source.includes(forbidden),
			`runtimeMetrics.ts must not reference ${forbidden}`,
		);
	}
	// The only module it may import from is the shared measurement helper.
	const imports = [
		...source.matchAll(/^import[\s\S]*?from '([^']+)';$/gmu),
	].map((match) => match[1]);
	assert.deepEqual(imports, ['./processMetrics']);
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-runtime-metrics-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'runtimeMetrics.mjs');
	try {
		await build({
			bundle: true,
			entryPoints: [new URL(relativePath, import.meta.url).pathname],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
