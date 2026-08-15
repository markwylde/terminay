import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-webrtc-bootstrap-'));
const output = join(directory, 'desktopWebRtcBootstrap.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/desktopWebRtcBootstrap.ts'],
	external: ['ws'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { createDesktopBootstrappedWebRtcTransport } = await import(
	pathToFileURL(output).href
);
test.after(async () => rm(directory, { force: true, recursive: true }));

const NOW = 1_000_000;
const bootstrap = () => ({
	schemaVersion: 1,
	protocolVersion: 'v1',
	role: 'offerer',
	serverId: 'server-a',
	deviceId: 'device-a',
	peerId: 'peer-a',
	sessionOrigin: 'https://session.example',
	signalingUrl: 'wss://session.example/signal',
	expiresAt: NOW + 60_000,
	iceServers: [],
});

class FakeSocket extends EventEmitter {
	readyState = 0;
	sent = [];
	closed = [];
	send(raw) {
		this.sent.push(JSON.parse(raw));
	}
	close(code, reason) {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.closed.push({ code, reason });
		this.emit('close');
	}
	open() {
		this.readyState = 1;
		this.emit('open');
	}
}

function fakeTransport() {
	let stateListener = () => {};
	return {
		state: 'open',
		incoming: { async *[Symbol.asyncIterator]() {} },
		bufferedBytes: 0,
		queuedBytes: 0,
		async open() {},
		async send() {},
		async waitForWritable() {},
		async close() {
			stateListener('closed');
		},
		onStateChange(listener) {
			stateListener = listener;
			return () => {
				stateListener = () => {};
			};
		},
	};
}

test('relay-bound bootstrap selects WebRTC and owns signaling cleanup', async () => {
	const socket = new FakeSocket();
	let receivedOptions;
	const pending = createDesktopBootstrappedWebRtcTransport({
		bootstrap: bootstrap(),
		expectedOrigin: 'https://session.example',
		now: () => NOW,
		openSocket(url, origin) {
			assert.equal(url, 'wss://session.example/signal');
			assert.equal(origin, 'https://session.example');
			queueMicrotask(() => socket.open());
			return socket;
		},
		async createTransport(options) {
			receivedOptions = options;
			const encoded = await options.signaling.encode({
				type: 'answer',
				sdp: 'answer-sdp',
			});
			assert.deepEqual(await options.signaling.decode(encoded), {
				type: 'answer',
				sdp: 'answer-sdp',
			});
			assert.throws(() => options.signaling.decode(encoded), /replay/u);
			const widened = await options.signaling.encode({
				type: 'answer',
				sdp: 'answer-sdp',
				extra: 'signed-but-not-allowed',
			});
			assert.throws(() => options.signaling.decode(widened), /invalid fields/u);
			await options.signaling.send(encoded);
			return fakeTransport();
		},
	});
	const transport = await pending;
	assert.equal(receivedOptions.serverId, 'server-a');
	assert.equal(receivedOptions.peerId, 'peer-a');
	assert.equal(socket.sent.length, 1);
	await transport.close();
	assert.equal(socket.closed.length, 1);
});

test('cross-origin bootstrap fails before socket or runtime allocation', async () => {
	let socketCalls = 0;
	let runtimeCalls = 0;
	await assert.rejects(
		() =>
			createDesktopBootstrappedWebRtcTransport({
				bootstrap: bootstrap(),
				expectedOrigin: 'https://other.example',
				now: () => NOW,
				openSocket() {
					socketCalls += 1;
					return new FakeSocket();
				},
				async createTransport() {
					runtimeCalls += 1;
					return fakeTransport();
				},
			}),
		/another origin/u,
	);
	assert.equal(socketCalls, 0);
	assert.equal(runtimeCalls, 0);
});

test('runtime allocation failure closes relay signaling', async () => {
	const socket = new FakeSocket();
	await assert.rejects(
		() =>
			createDesktopBootstrappedWebRtcTransport({
				bootstrap: bootstrap(),
				expectedOrigin: 'https://session.example',
				now: () => NOW,
				openSocket() {
					queueMicrotask(() => socket.open());
					return socket;
				},
				async createTransport() {
					throw new Error('approved native runtime unavailable');
				},
			}),
		/approved native runtime unavailable/u,
	);
	assert.equal(socket.closed.length, 1);
});

test('stalled socket opening is bounded and closes before runtime allocation', async () => {
	const socket = new FakeSocket();
	let runtimeCalls = 0;
	await assert.rejects(
		() =>
			createDesktopBootstrappedWebRtcTransport({
				bootstrap: bootstrap(),
				expectedOrigin: 'https://session.example',
				now: () => NOW,
				socketOpenTimeoutMs: 5,
				openSocket() {
					return socket;
				},
				async createTransport() {
					runtimeCalls += 1;
					return fakeTransport();
				},
			}),
		/timed out before opening/u,
	);
	assert.equal(runtimeCalls, 0);
	assert.equal(socket.closed.length, 1);
});
