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
	bundle: true,
	stdin: {
		contents:
			"export { createRtcDataChannelTransport } from './electron/remote/privilegedWebRtcExposure.ts'",
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
const { createRtcDataChannelTransport } = await import(
	pathToFileURL(output).href
);

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
