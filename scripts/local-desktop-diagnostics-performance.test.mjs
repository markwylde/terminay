import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { DesktopPerformanceLogging } = await importBundled(
	'../electron/diagnostics/performance.ts',
);

function createClock() {
	let now = 1_000;
	const intervals = [];
	const timeouts = [];
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
		setTimeout(handler, ms) {
			const id = { handler, ms, at: now + ms };
			timeouts.push(id);
			return id;
		},
		clearTimeout(id) {
			const index = timeouts.indexOf(id);
			if (index >= 0) timeouts.splice(index, 1);
		},
		async flushIntervals() {
			for (const interval of [...intervals]) await interval.handler();
		},
		async flushTimeouts() {
			const due = timeouts.splice(0, timeouts.length);
			for (const timeout of due) await timeout.handler();
		},
	};
}

function createContents() {
	const contents = new EventEmitter();
	contents.id = 7;
	contents.isDestroyed = () => false;
	contents.mainFrame = {
		collectJavaScriptCallStack: async () =>
			'at renderAgentSidebar (renderer.js:10:2)',
	};
	contents.off = contents.removeListener.bind(contents);
	return contents;
}

test('performance logging stays off until enabled and then records samples and stacks', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-performance-'),
	);
	const records = [];
	const traces = [];
	const clock = createClock();
	const contents = createContents();
	const histogram = {
		min: 1e6,
		mean: 2e6,
		max: 80e6,
		enable() {},
		disable() {},
		reset() {},
		percentile(value) {
			return value === 99 ? 40e6 : 5e6;
		},
	};
	const logging = new DesktopPerformanceLogging({
		app: {
			getAppMetrics: () => [
				{
					cpu: { idleWakeupsPerSecond: 12, percentCPUUsage: 42.25 },
					memory: { workingSetSize: 8_192 },
					name: 'Tab',
					pid: 42,
					serviceName: 'Network Service',
					type: 'Tab',
				},
			],
		},
		clock,
		contentTracing: {
			startRecording: async (options) => {
				traces.push(['start', options.enable_argument_filter]);
			},
			stopRecording: async (outputPath) => {
				traces.push(['stop', outputPath]);
				return outputPath;
			},
		},
		cpuUsage: () => ({ user: 1_000, system: 200 }),
		createEventLoopDelay: () => histogram,
		diagnostics: {
			directory,
			launchId: 'launch-perf',
			record: async (input) => {
				records.push(input);
			},
		},
		listWebContents: () => [contents],
		memoryUsage: () => ({
			arrayBuffers: 1,
			external: 2,
			heapTotal: 3,
			heapUsed: 4,
			rss: 5,
		}),
		userDataDirectory: directory,
	});

	try {
		assert.equal(logging.isEnabled(), false);
		await logging.restore();
		assert.equal(logging.isEnabled(), false);
		assert.equal(records.length, 0);

		contents.emit('ipc-message', {}, 'file:get-info');
		assert.equal(await logging.setEnabled(true), true);
		assert.equal(logging.isEnabled(), true);
		assert.ok(
			records.some((event) => event.event === 'diagnostics.performance.enabled'),
		);
		const sample = records.find(
			(event) => event.event === 'diagnostics.performance.sample',
		);
		assert.equal(sample.fields.maxCpuPercent, 42.25);
		assert.equal(sample.fields.processes[0].type, 'Tab');
		assert.equal(sample.fields.eventLoop.maxMs, 80);
		assert.deepEqual(sample.fields.ipc, {});
		assert.ok(
			records.some(
				(event) => event.event === 'diagnostics.performance.stack-collected',
			),
		);
		assert.ok(
			records.some(
				(event) => event.event === 'diagnostics.performance.trace-started',
			),
		);
		contents.emit('ipc-message', {}, 'file:get-info');
		contents.emit('ipc-message-sync', {}, 'server-ui-host:request-action');
		clock.advance(5_000);
		await clock.flushIntervals();
		const later = records.filter(
			(event) => event.event === 'diagnostics.performance.sample',
		);
		assert.equal(later.length >= 2, true);
		assert.equal(later[1].fields.ipc.file, 1);
		assert.equal(later[1].fields.ipc['server-ui-host'], 1);
		await clock.flushTimeouts();
		assert.ok(
			records.some(
				(event) => event.event === 'diagnostics.performance.trace-completed',
			),
		);
		const completed = records.find(
			(event) => event.event === 'diagnostics.performance.trace-completed',
		);
		assert.match(
			completed.fields.filename,
			/^terminay-performance-trace-v1-\d+-launch-perf\.json$/u,
		);
		assert.equal(
			JSON.parse(
				await readFile(join(directory, 'diagnostics-preferences.v1.json'), 'utf8'),
			).performanceLogging,
			true,
		);

		assert.equal(await logging.setEnabled(false), false);
		assert.ok(
			records.some(
				(event) => event.event === 'diagnostics.performance.disabled',
			),
		);
		const before = records.length;
		clock.advance(5_000);
		await clock.flushIntervals();
		assert.equal(records.length, before);
	} finally {
		await logging.close();
		await rm(directory, { force: true, recursive: true });
	}
});

test('uninitialized event-loop histogram extrema are omitted rather than logged as huge delays', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-performance-loop-'),
	);
	const records = [];
	const logging = new DesktopPerformanceLogging({
		app: { getAppMetrics: () => [] },
		clock: createClock(),
		contentTracing: {
			startRecording: async () => undefined,
			stopRecording: async () => '',
		},
		createEventLoopDelay: () => ({
			min: 2 ** 63 - 1,
			mean: 0,
			max: 0,
			enable() {},
			disable() {},
			reset() {},
			percentile() {
				return 2 ** 63 - 1;
			},
		}),
		diagnostics: {
			directory,
			launchId: 'launch-loop',
			record: async (input) => {
				records.push(input);
			},
		},
		listWebContents: () => [],
		userDataDirectory: directory,
	});
	try {
		await logging.setEnabled(true);
		const sample = records.find(
			(event) => event.event === 'diagnostics.performance.sample',
		);
		assert.deepEqual(sample.fields.eventLoop, {
			maxMs: 0,
			meanMs: 0,
			minMs: 0,
			p50Ms: 0,
			p99Ms: 0,
		});
	} finally {
		await logging.close();
		await rm(directory, { force: true, recursive: true });
	}
});

test('restoring a persisted On preference starts the collector without a renderer', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-performance-restore-'),
	);
	const records = [];
	const { writeDiagnosticsPreferences } = await importBundled(
		'../electron/diagnostics/preferences.ts',
	);
	writeDiagnosticsPreferences(directory, {
		schemaVersion: 1,
		performanceLogging: true,
	});
	const logging = new DesktopPerformanceLogging({
		app: { getAppMetrics: () => [] },
		clock: createClock(),
		contentTracing: {
			startRecording: async () => undefined,
			stopRecording: async () => '',
		},
		createEventLoopDelay: () => ({
			min: 0,
			mean: 0,
			max: 0,
			enable() {},
			disable() {},
			reset() {},
			percentile() {
				return 0;
			},
		}),
		diagnostics: {
			directory,
			launchId: 'launch-restore',
			record: async (input) => {
				records.push(input);
			},
		},
		listWebContents: () => [],
		userDataDirectory: directory,
	});
	try {
		await logging.restore();
		assert.equal(logging.isEnabled(), true);
		assert.ok(
			records.some((event) => event.event === 'diagnostics.performance.enabled'),
		);
	} finally {
		await logging.close();
		await rm(directory, { force: true, recursive: true });
	}
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-performance-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'performance.mjs');
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
