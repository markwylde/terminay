import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { TerminalResourceSampler, createProcessTableReader } =
	await importBundled('../electron/diagnostics/terminalResources.ts');

/** pid 100 is the shell; 101 and 102 are its descendants; 200 is unrelated. */
function createReader(overrides = {}) {
	return {
		diskAvailable: true,
		read: async () =>
			new Map([
				[1, { pid: 1, ppid: 0, cpuPercent: 0, rssBytes: 0 }],
				[
					100,
					{
						pid: 100,
						ppid: 1,
						cpuPercent: 2,
						rssBytes: 1_000,
						diskReadBytes: 1_000,
						diskWriteBytes: 500,
					},
				],
				[
					101,
					{
						pid: 101,
						ppid: 100,
						cpuPercent: 8,
						rssBytes: 3_000,
						diskReadBytes: 4_000,
						diskWriteBytes: 1_500,
					},
				],
				[
					102,
					{
						pid: 102,
						ppid: 101,
						cpuPercent: 1.5,
						rssBytes: 500,
						diskReadBytes: 0,
						diskWriteBytes: 0,
					},
				],
				[200, { pid: 200, ppid: 1, cpuPercent: 90, rssBytes: 9_999 }],
			]),
		...overrides,
	};
}

function createClock() {
	let now = 10_000;
	return { now: () => now, advance: (ms) => (now += ms) };
}

test('a local session sums its whole process tree and excludes strangers', async () => {
	const sampler = new TerminalResourceSampler({
		reader: createReader(),
		now: createClock().now,
	});
	const snapshot = await sampler.sample([
		{ sessionId: 's1', status: 'running', pid: 100 },
	]);
	const usage = snapshot.sessions.s1;

	assert.equal(usage.available, true);
	assert.equal(usage.cpuPercent, 11.5, 'pid 200 must not be counted');
	assert.equal(usage.rssBytes, 4_500);
	assert.equal(usage.processCount, 3);
	// The first sample has no previous counter, so no rate is invented.
	assert.equal(usage.diskReadBytesPerSecond, undefined);
});

test('disk is reported as a rate between samples', async () => {
	const clock = createClock();
	let readBytes = 5_000;
	const sampler = new TerminalResourceSampler({
		now: clock.now,
		reader: {
			diskAvailable: true,
			read: async () =>
				new Map([
					[
						100,
						{
							pid: 100,
							ppid: 1,
							cpuPercent: 0,
							rssBytes: 0,
							diskReadBytes: readBytes,
							diskWriteBytes: 0,
						},
					],
				]),
		},
	});
	const sessions = [{ sessionId: 's1', status: 'running', pid: 100 }];

	await sampler.sample(sessions);
	clock.advance(2_000);
	readBytes = 9_000;
	const second = await sampler.sample(sessions);

	assert.equal(second.sessions.s1.diskReadBytesPerSecond, 2_000);
});

test('a running session with no local pid is a remote environment', async () => {
	const sampler = new TerminalResourceSampler({ reader: createReader() });
	const snapshot = await sampler.sample([
		{ sessionId: 'ssh', status: 'running' },
	]);
	assert.deepEqual(snapshot.sessions.ssh, {
		available: false,
		reason: 'remote-environment',
	});
});

test('a non-running session is reported as such, not as zero usage', async () => {
	const sampler = new TerminalResourceSampler({ reader: createReader() });
	const snapshot = await sampler.sample([
		{ sessionId: 'done', status: 'exited', pid: 100 },
	]);
	assert.deepEqual(snapshot.sessions.done, {
		available: false,
		reason: 'not-running',
	});
});

test('an unreadable table reports unreadable, never a stale value', async () => {
	const clock = createClock();
	let fail = false;
	const sampler = new TerminalResourceSampler({
		now: clock.now,
		reader: {
			diskAvailable: true,
			read: async () => {
				if (fail) throw new Error('process table unavailable');
				return new Map([
					[100, { pid: 100, ppid: 1, cpuPercent: 7, rssBytes: 2_000 }],
				]);
			},
		},
	});
	const sessions = [{ sessionId: 's1', status: 'running', pid: 100 }];

	const first = await sampler.sample(sessions);
	assert.equal(first.sessions.s1.available, true);

	fail = true;
	clock.advance(1_000);
	const second = await sampler.sample(sessions);
	assert.deepEqual(second.sessions.s1, {
		available: false,
		reason: 'unreadable',
	});
});

test('a pid missing from the table reports unreadable', async () => {
	const sampler = new TerminalResourceSampler({ reader: createReader() });
	const snapshot = await sampler.sample([
		{ sessionId: 'gone', status: 'running', pid: 4_242 },
	]);
	assert.deepEqual(snapshot.sessions.gone, {
		available: false,
		reason: 'unreadable',
	});
});

test('a slow reader is bounded by the tick deadline', async () => {
	const sampler = new TerminalResourceSampler({
		deadlineMs: 20,
		reader: {
			diskAvailable: false,
			read: (signal) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(new Error('aborted')));
				}),
		},
	});
	const snapshot = await sampler.sample([
		{ sessionId: 's1', status: 'running', pid: 100 },
	]);
	assert.deepEqual(snapshot.sessions.s1, {
		available: false,
		reason: 'unreadable',
	});
});

test('a usage record carries only the permitted fields', async () => {
	const sampler = new TerminalResourceSampler({ reader: createReader() });
	const snapshot = await sampler.sample([
		{ sessionId: 's1', status: 'running', pid: 100 },
	]);
	assert.deepEqual(Object.keys(snapshot.sessions.s1).sort(), [
		'available',
		'cpuPercent',
		'processCount',
		'rssBytes',
	]);
	assert.deepEqual(Object.keys(snapshot).sort(), [
		'at',
		'diskAvailable',
		'sessions',
	]);
});

test('disk availability reflects the platform reader', async () => {
	const darwin = createProcessTableReader('darwin');
	const linux = createProcessTableReader('linux');
	assert.equal(darwin.diskAvailable, false, 'macOS has no per-process counter');
	assert.equal(linux.diskAvailable, true);
	assert.equal(createProcessTableReader('win32'), undefined);
});

test('the sampler never reads a title, command line, cwd, or environment', async () => {
	const source = await readFile(
		new URL('../electron/diagnostics/terminalResources.ts', import.meta.url),
		'utf8',
	);
	for (const forbidden of [
		'/cmdline',
		'/environ',
		'/cwd',
		'comm=',
		'args=',
		'command=',
	]) {
		assert.ok(
			!source.includes(forbidden),
			`terminalResources.ts must not read ${forbidden}`,
		);
	}
	// The macOS reader requests exactly the four permitted columns.
	assert.ok(source.includes("'-Ao', 'pid=,ppid=,pcpu=,rss='"));
	// No project-environment adapter is consulted.
	assert.ok(!source.includes('projectEnvironment'));
	assert.ok(!source.includes('adapter'));
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-terminal-resources-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'terminalResources.mjs');
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
