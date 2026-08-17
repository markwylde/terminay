import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	DEFAULT_SCTP_MAX_MESSAGE_BYTES,
	UI_ARCHIVE_CHUNK_BYTES,
	UI_ARCHIVE_FRAME_HEADER_BYTES,
	archiveChunkBytes,
	bindUiArchiveChannels,
	messagePayloadBytes,
	safeChannelSend,
} from '../dist/remote/uiArchiveTransfer.js';

const CRASH_ARCHIVE_BYTES = 4_523_291;

test('hosted pairing host chunks the UI archive instead of sending it as one SCTP message', async () => {
	const source = await readFile(
		new URL('../src/remote/hostedPairingHost.ts', import.meta.url),
		'utf8',
	);
	assert.match(source, /bindUiArchiveChannels\(/u);
	assert.match(source, /channels\.asset!,\s*channels\.assets!/u);
	assert.doesNotMatch(source, /chunks:\s*1/u);
	assert.doesNotMatch(source, /chunkBytes:\s*archive\.bytes\.byteLength/u);
	assert.match(source, /safeChannelSend/u);
});

test('safeChannelSend rejects an oversized payload before the native DataChannel send', () => {
	let nativeSends = 0;
	const channel = createChannel({
		send() {
			nativeSends += 1;
		},
	});
	assert.throws(
		() => safeChannelSend(channel, new Uint8Array(CRASH_ARCHIVE_BYTES)),
		/4523291 bytes; negotiated SCTP max is 262144/u,
	);
	assert.equal(nativeSends, 0);
});

test('a multi-megabyte UI archive is sent as 64 KiB chunks with a window of four', async () => {
	const archive = { bundleId: 'crash-size-archive', bytes: new Uint8Array(CRASH_ARCHIVE_BYTES) };
	const channel = createAutoAckChannel();
	bindUiArchiveChannels([channel], archive);
	channel.dispatchMessage(
		JSON.stringify({ archiveFormatVersion: 1, id: 'bundle', type: 'asset:get-bundle' }),
	);
	await waitFor(() => controlMessages(channel).some((message) => message.type === 'asset:bundle-complete'));

	const start = controlMessages(channel).find((message) => message.type === 'asset:bundle-start');
	const expectedChunks = Math.ceil(CRASH_ARCHIVE_BYTES / UI_ARCHIVE_CHUNK_BYTES);
	assert.equal(start?.chunkBytes, UI_ARCHIVE_CHUNK_BYTES);
	assert.equal(start?.chunks, expectedChunks);
	assert.equal(start?.compressedBytes, CRASH_ARCHIVE_BYTES);
	assert.deepEqual(binaryChunkIndexes(channel), Array.from({ length: expectedChunks }, (_, index) => index));
	assert.equal(channel.maxOutstanding <= 4, true);
	assert.equal(
		channel.sent.every((payload) => messagePayloadBytes(payload) <= UI_ARCHIVE_CHUNK_BYTES + UI_ARCHIVE_FRAME_HEADER_BYTES),
		true,
	);
	assert.equal(
		channel.sent.every((payload) => messagePayloadBytes(payload) <= DEFAULT_SCTP_MAX_MESSAGE_BYTES),
		true,
	);
});

test('a native max-message-size throw becomes asset:bundle-error and does not reject unhandled', async () => {
	const rejections = [];
	const onRejection = (error) => {
		rejections.push(error);
	};
	process.on('unhandledRejection', onRejection);
	try {
		const channel = createChannel({
			send(data) {
				if (typeof data !== 'string') {
					throw new Error(`max-message-size exceeded: ${data.byteLength} > 262144`);
				}
			},
		});
		bindUiArchiveChannels([channel], {
			bundleId: 'throwing-archive',
			bytes: new Uint8Array(UI_ARCHIVE_CHUNK_BYTES),
		});
		channel.dispatchMessage(
			JSON.stringify({ archiveFormatVersion: 1, id: 'bundle', type: 'asset:get-bundle' }),
		);
		await waitFor(() => controlMessages(channel).some((message) => message.type === 'asset:bundle-error'));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(rejections.length, 0);
		assert.deepEqual(controlMessages(channel).at(-1), {
			code: 'internal',
			id: 'bundle',
			message: 'WebRTC data-channel send failed: max-message-size exceeded: 65544 > 262144',
			type: 'asset:bundle-error',
		});
	} finally {
		process.off('unhandledRejection', onRejection);
	}
});

test('archive chunk size drops to the negotiated SCTP max when it is below 64 KiB', () => {
	const channel = createChannel({ maxMessageSize: 16 * 1024 });
	assert.equal(archiveChunkBytes(channel), 16 * 1024 - UI_ARCHIVE_FRAME_HEADER_BYTES);
});

test('an in-flight archive transfer reports cancelled when the peer cancels it', async () => {
	const archive = { bundleId: 'cancel-archive', bytes: new Uint8Array(10 * UI_ARCHIVE_CHUNK_BYTES) };
	const channel = createChannel();
	bindUiArchiveChannels([channel], archive);
	channel.dispatchMessage(
		JSON.stringify({ archiveFormatVersion: 1, id: 'cancel-bundle', type: 'asset:get-bundle' }),
	);
	await waitFor(() => binaryChunkIndexes(channel).length === 4);
	channel.dispatchMessage(JSON.stringify({ id: 'cancel-bundle', type: 'asset:bundle-cancel' }));
	await waitFor(() => controlMessages(channel).some((message) => message.type === 'asset:bundle-error'));
	assert.equal(binaryChunkIndexes(channel).length, 4);
	assert.match(
		controlMessages(channel).find((message) => message.type === 'asset:bundle-error')?.message ?? '',
		/cancelled/u,
	);
});

function createChannel(overrides = {}) {
	const listeners = new Set();
	return {
		label: 'asset',
		readyState: 'open',
		sent: [],
		maxOutstanding: 0,
		...overrides,
		addEventListener(type, listener) {
			if (type === 'message') listeners.add(listener);
		},
		removeEventListener(_type, listener) {
			listeners.delete(listener);
		},
		send(data) {
			this.sent.push(data);
			overrides.send?.call(this, data);
		},
		dispatchMessage(data) {
			for (const listener of [...listeners]) listener({ data });
		},
	};
}

function createAutoAckChannel() {
	const channel = createChannel({
		send(data) {
			if (!(data instanceof Uint8Array)) {
				const message = JSON.parse(data);
				if (message.type === 'asset:bundle-start') this.bundleId = message.id;
				return;
			}
			this.outstanding = (this.outstanding ?? 0) + 1;
			this.maxOutstanding = Math.max(this.maxOutstanding, this.outstanding);
			const index = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, false);
			queueMicrotask(() => {
				this.outstanding -= 1;
				this.dispatchMessage(
					JSON.stringify({ id: this.bundleId, index, type: 'asset:bundle-ack' }),
				);
			});
		},
	});
	channel.outstanding = 0;
	return channel;
}

function controlMessages(channel) {
	return channel.sent
		.filter((payload) => typeof payload === 'string')
		.map((payload) => JSON.parse(payload));
}

function binaryChunkIndexes(channel) {
	return channel.sent
		.filter((payload) => payload instanceof Uint8Array)
		.map((payload) => new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(4, false));
}

async function waitFor(predicate, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('Timed out waiting for archive transfer.');
		await new Promise((resolve) => setImmediate(resolve));
	}
}
