import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(process.cwd(), 'scripts', '.browser-webrtc-transport-'),
);
const outputFile = join(outputDirectory, 'browserWebRtcTransport.mjs');

await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/web/browserWebRtcTransport.ts'],
	external: ['@terminay/protocol'],
	format: 'esm',
	outfile: outputFile,
	platform: 'node',
});

const { createBrowserWebRtcTransport } = await import(outputFile);

test.after(async () => {
	await rm(outputDirectory, { recursive: true, force: true });
});

test('browser WebRTC closes the authenticated session when any traffic lane closes', async () => {
	const channels = createChannels();
	const transport = await createBrowserWebRtcTransport((name) =>
		channels.get(name),
	);
	const states = [];
	transport.onStateChange(() => {
		throw new Error('observer failure');
	});
	transport.onStateChange((state) => states.push(state));

	channels.get('assets').externalClose();

	assert.equal(transport.state, 'closed');
	assert.deepEqual(states, ['closed']);
	for (const channel of channels.values())
		assert.equal(channel.readyState, 'closed');
});

test('browser WebRTC fails when native state changes before its close callback', async () => {
	const channels = createChannels();
	const transport = await createBrowserWebRtcTransport((name) =>
		channels.get(name),
	);
	channels.get('application').readyState = 'closing';

	await assert.rejects(transport.send(new Uint8Array([1])), /closed/u);

	assert.equal(transport.state, 'failed');
	for (const channel of channels.values())
		assert.equal(channel.readyState, 'closed');
});

test('browser WebRTC observes synchronous native send failure', async () => {
	const channels = createChannels();
	const transport = await createBrowserWebRtcTransport((name) =>
		channels.get(name),
	);
	channels.get('application').sendError = new Error(
		'scripted RTC send failure',
	);

	await assert.rejects(
		transport.send(new Uint8Array([1])),
		/scripted RTC send failure/u,
	);

	assert.equal(transport.state, 'failed');
});

test('browser WebRTC backpressure wait is abortable without reusing a failed channel', async () => {
	const channels = createChannels();
	const transport = await createBrowserWebRtcTransport((name) =>
		channels.get(name),
	);
	channels.get('application').bufferedAmount = 16 * 1024 * 1024;
	const controller = new AbortController();
	const waiting = transport.waitForWritable(1, controller.signal);
	controller.abort(new Error('scripted RTC abort'));

	await assert.rejects(waiting, /scripted RTC abort/u);
	assert.equal(transport.state, 'open');
	await transport.close();
});

function createChannels() {
	return new Map(
		['control', 'application', 'terminal', 'assets'].map((label) => [
			label,
			new FakeRtcDataChannel(label),
		]),
	);
}

class FakeRtcDataChannel {
	binaryType = 'blob';
	readyState = 'open';
	bufferedAmount = 0;
	sendError = undefined;
	#listeners = new Map();

	constructor(label) {
		this.label = label;
	}

	addEventListener(type, listener) {
		const listeners = this.#listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	removeEventListener(type, listener) {
		this.#listeners.get(type)?.delete(listener);
	}

	send() {
		if (this.sendError !== undefined) throw this.sendError;
		if (this.readyState !== 'open') throw new Error('channel is not open');
	}

	close() {
		if (this.readyState === 'closed') return;
		this.readyState = 'closed';
		this.#emit('close', {});
	}

	externalClose() {
		this.close();
	}

	#emit(type, event) {
		for (const listener of [...(this.#listeners.get(type) ?? [])])
			listener(event);
	}
}
