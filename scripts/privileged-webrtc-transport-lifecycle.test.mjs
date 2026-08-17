import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-privileged-rtc-'));
const output = join(directory, 'rtcTransport.cjs');
await build({
	absWorkingDir: process.cwd(),
	alias: {
		'@terminay/protocol': join(process.cwd(), 'packages/protocol/src/index.ts'),
	},
	bundle: true,
	stdin: {
		contents:
			"export { createRtcDataChannelTransport, superviseApplicationConnection } from './electron/remote/rtcDataChannelTransport.ts'",
		loader: 'ts',
		resolveDir: process.cwd(),
	},
	format: 'cjs',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
	treeShaking: true,
});
const { createRtcDataChannelTransport, superviseApplicationConnection } =
	await import(pathToFileURL(output).href);

test.after(async () => rm(directory, { force: true, recursive: true }));

test('privileged WebRTC observes native send failure and rejects reuse', async () => {
	const channel = new FakeRtcDataChannel();
	const transport = createRtcDataChannelTransport(channel);
	const states = [];
	transport.onStateChange(() => {
		throw new Error('observer failure');
	});
	transport.onStateChange((state) => states.push(state));
	channel.sendError = new Error('scripted Werift send failure');

	await assert.rejects(
		transport.send(new Uint8Array([1])),
		/scripted Werift send failure/u,
	);
	await assert.rejects(transport.send(new Uint8Array([2])), /closed/u);

	assert.equal(transport.state, 'failed');
	assert.deepEqual(states, ['failed']);
	assert.equal(channel.closeCount, 1);
});

test('privileged WebRTC detects a half-closed native channel before send', async () => {
	const channel = new FakeRtcDataChannel();
	const transport = createRtcDataChannelTransport(channel);
	channel.readyState = 'closing';

	await assert.rejects(transport.send(new Uint8Array([1])), /closed/u);

	assert.equal(transport.state, 'failed');
	assert.equal(channel.closeCount, 1);
});

test('privileged WebRTC backpressure wait observes abort', async () => {
	const channel = new FakeRtcDataChannel();
	const transport = createRtcDataChannelTransport(channel);
	channel.bufferedAmount = 16 * 1024 * 1024;
	const controller = new AbortController();
	const waiting = transport.waitForWritable(1, controller.signal);
	controller.abort(new Error('scripted Werift abort'));

	await assert.rejects(waiting, /scripted Werift abort/u);
	assert.equal(transport.state, 'open');
	await transport.close();
});

test('privileged peer closes when its application protocol reader resolves', async () => {
	const events = [];
	await superviseApplicationConnection({
		connection: { start: async () => undefined },
		isCurrent: () => true,
		onRejected: (error) => events.push(['rejected', error]),
		onTerminal: () => events.push(['terminal']),
	});

	assert.deepEqual(events, [['terminal']]);
});

test('privileged peer reports and closes when its application protocol reader rejects', async () => {
	const failure = new Error('scripted protocol failure');
	const events = [];
	await superviseApplicationConnection({
		connection: {
			start: async () => {
				throw failure;
			},
		},
		isCurrent: () => true,
		onRejected: (error) => events.push(['rejected', error]),
		onTerminal: () => events.push(['terminal']),
	});

	assert.deepEqual(events, [['rejected', failure], ['terminal']]);
});

test('privileged peer still closes when failure reporting itself throws', async () => {
	let closed = false;
	await assert.rejects(
		superviseApplicationConnection({
			connection: { start: async () => Promise.reject(undefined) },
			isCurrent: () => true,
			onRejected: () => {
				throw new Error('scripted status failure');
			},
			onTerminal: () => {
				closed = true;
			},
		}),
		/scripted status failure/u,
	);

	assert.equal(closed, true);
});

test('stale application protocol completion cannot close its replacement', async () => {
	let settle;
	let currentGeneration = 1;
	const events = [];
	const supervision = superviseApplicationConnection({
		connection: {
			start: () =>
				new Promise((resolve) => {
					settle = resolve;
				}),
		},
		isCurrent: () => currentGeneration === 1,
		onRejected: (error) => events.push(['rejected', error]),
		onTerminal: () => events.push(['terminal']),
	});

	currentGeneration = 2;
	settle();
	await supervision;

	assert.deepEqual(events, []);
});

class FakeRtcDataChannel {
	binaryType = 'blob';
	readyState = 'open';
	bufferedAmount = 0;
	sendError = undefined;
	closeCount = 0;
	#listeners = new Map();

	addEventListener(type, listener) {
		const listeners = this.#listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	send() {
		if (this.sendError !== undefined) throw this.sendError;
		if (this.readyState !== 'open') throw new Error('channel is not open');
	}

	close() {
		if (this.readyState === 'closed') return;
		this.closeCount += 1;
		this.readyState = 'closed';
		for (const listener of [...(this.#listeners.get('close') ?? [])])
			listener({});
	}
}
