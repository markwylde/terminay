import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const dependencyRoot = process.env.TERMINAY_NODE_DATACHANNEL_SPIKE_ROOT;
if (!dependencyRoot) {
	throw new Error('TERMINAY_NODE_DATACHANNEL_SPIKE_ROOT is required.');
}

const requireFromSpike = createRequire(
	path.join(dependencyRoot, 'package.json'),
);
const { PeerConnection, cleanup, getLibraryVersion, setSctpSettings } =
	requireFromSpike('node-datachannel');
const { version: packageVersion } = JSON.parse(
	readFileSync(
		path.join(
			dependencyRoot,
			'node_modules',
			'node-datachannel',
			'package.json',
		),
		'utf8',
	),
);

const CHANNEL_LABELS = ['api', 'asset', 'terminal'];
const TIMEOUT_MS = 30_000;
const ORDERED_MESSAGES = 1_000;
const BINARY_BYTES = 16 * 1024 * 1024;
const BINARY_CHUNK_BYTES = 64 * 1024;
const MAX_IN_FLIGHT_CHUNKS = Number.parseInt(
	process.env.TERMINAY_SPIKE_MAX_IN_FLIGHT_CHUNKS ?? '2',
	10,
);
const ACK_WINDOW_BYTES = MAX_IN_FLIGHT_CHUNKS * BINARY_CHUNK_BYTES;
const NATIVE_HIGH_WATER_BYTES = Math.max(
	128 * 1024,
	ACK_WINDOW_BYTES + BINARY_CHUNK_BYTES,
);
const NATIVE_LOW_WATER_BYTES = 32 * 1024;

setSctpSettings({
	sendBufferSize: 32 * 1024,
});

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, reject, resolve };
}

function withTimeout(promise, label, timeoutMs = TIMEOUT_MS) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

function normalizeBinary(message) {
	if (Buffer.isBuffer(message)) {
		return message;
	}
	if (message instanceof Uint8Array) {
		return Buffer.from(message.buffer, message.byteOffset, message.byteLength);
	}
	if (message instanceof ArrayBuffer) {
		return Buffer.from(message);
	}
	return null;
}

async function runProof() {
	const startedAt = performance.now();
	const peerA = new PeerConnection('terminay-node-datachannel-a', {
		bindAddress: '127.0.0.1',
		iceServers: [],
	});
	const peerB = new PeerConnection('terminay-node-datachannel-b', {
		bindAddress: '127.0.0.1',
		iceServers: [],
	});
	const channelsA = new Map();
	const channelsB = new Map();
	const orderedAtA = new Map(CHANNEL_LABELS.map((label) => [label, []]));
	const orderedAtB = new Map(CHANNEL_LABELS.map((label) => [label, []]));
	const peerAConnected = deferred();
	const peerBConnected = deferred();
	const allRemoteChannels = deferred();
	const binaryDone = deferred();
	const binaryReceiverHash = createHash('sha256');
	const inFlightSequences = new Set();
	let binaryReceivedBytes = 0;
	let binaryReceivedChunks = 0;
	let nextAckSignal = deferred();

	peerA.onLocalDescription((sdp, type) => {
		peerB.setRemoteDescription(sdp, type);
	});
	peerB.onLocalDescription((sdp, type) => {
		peerA.setRemoteDescription(sdp, type);
	});
	peerA.onLocalCandidate((candidate, mid) => {
		peerB.addRemoteCandidate(candidate, mid);
	});
	peerB.onLocalCandidate((candidate, mid) => {
		peerA.addRemoteCandidate(candidate, mid);
	});
	peerA.onStateChange((state) => {
		if (state === 'connected') peerAConnected.resolve();
		if (state === 'failed') {
			peerAConnected.reject(new Error('Peer A failed.'));
		}
	});
	peerB.onStateChange((state) => {
		if (state === 'connected') peerBConnected.resolve();
		if (state === 'failed') {
			peerBConnected.reject(new Error('Peer B failed.'));
		}
	});

	peerB.onDataChannel((channel) => {
		channelsB.set(channel.getLabel(), channel);
		if (channelsB.size === CHANNEL_LABELS.length) {
			allRemoteChannels.resolve();
		}

		channel.onMessage((message) => {
			if (typeof message === 'string') {
				orderedAtB.get(channel.getLabel())?.push(message);
				channel.sendMessage(
					`b:${channel.getLabel()}:${
						orderedAtB.get(channel.getLabel()).length - 1
					}`,
				);
				return;
			}

			assert.equal(channel.getLabel(), 'asset');
			const frame = normalizeBinary(message);
			assert.ok(frame, 'Expected a binary frame.');
			assert.ok(frame.byteLength >= 4, 'Binary frame has no sequence header.');
			const sequence = frame.readUInt32BE(0);
			assert.equal(sequence, binaryReceivedChunks);
			const payload = frame.subarray(4);
			binaryReceivedChunks += 1;
			binaryReceivedBytes += payload.byteLength;
			binaryReceiverHash.update(payload);
			channel.sendMessage(`ack:${sequence}`);
			if (binaryReceivedBytes === BINARY_BYTES) {
				binaryDone.resolve();
			}
			if (binaryReceivedBytes > BINARY_BYTES) {
				binaryDone.reject(new Error('Received duplicate binary data.'));
			}
		});
	});

	for (const label of CHANNEL_LABELS) {
		const channel = peerA.createDataChannel(label, { ordered: true });
		channelsA.set(label, channel);
		channel.onMessage((message) => {
			assert.equal(typeof message, 'string');
			if (message.startsWith('ack:')) {
				const sequence = Number.parseInt(message.slice(4), 10);
				assert.ok(
					inFlightSequences.delete(sequence),
					`Received an unknown or duplicate acknowledgement ${sequence}.`,
				);
				nextAckSignal.resolve();
				nextAckSignal = deferred();
				return;
			}
			orderedAtA.get(label)?.push(message);
		});
	}

	await withTimeout(
		Promise.all([
			peerAConnected.promise,
			peerBConnected.promise,
			allRemoteChannels.promise,
		]),
		'peer and channel connection',
	);
	await withTimeout(
		(async () => {
			while (
				[...channelsA.values(), ...channelsB.values()].some(
					(channel) => !channel.isOpen(),
				)
			) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		})(),
		'all channels to open',
	);

	for (const label of CHANNEL_LABELS) {
		const channel = channelsA.get(label);
		for (let sequence = 0; sequence < ORDERED_MESSAGES; sequence += 1) {
			assert.equal(channel.sendMessage(`a:${label}:${sequence}`), true);
		}
	}

	await withTimeout(
		(async () => {
			while (
				CHANNEL_LABELS.some(
					(label) =>
						orderedAtA.get(label).length !== ORDERED_MESSAGES ||
						orderedAtB.get(label).length !== ORDERED_MESSAGES,
				)
			) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		})(),
		'ordered bidirectional messages',
	);

	for (const label of CHANNEL_LABELS) {
		assert.deepEqual(
			orderedAtA.get(label),
			Array.from(
				{ length: ORDERED_MESSAGES },
				(_, sequence) => `b:${label}:${sequence}`,
			),
		);
		assert.deepEqual(
			orderedAtB.get(label),
			Array.from(
				{ length: ORDERED_MESSAGES },
				(_, sequence) => `a:${label}:${sequence}`,
			),
		);
	}

	const assetChannel = channelsA.get('asset');
	const maxMessageSize = assetChannel.maxMessageSize();
	assert.ok(maxMessageSize >= BINARY_CHUNK_BYTES + 4);
	assetChannel.setBufferedAmountLowThreshold(NATIVE_LOW_WATER_BYTES);
	let nativeLowSignal = deferred();
	assetChannel.onBufferedAmountLow(() => nativeLowSignal.resolve());

	async function waitForNativeDrain(label) {
		if (assetChannel.bufferedAmount() > NATIVE_LOW_WATER_BYTES) {
			await withTimeout(nativeLowSignal.promise, label);
			nativeLowSignal = deferred();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 1));
	}

	const binarySenderHash = createHash('sha256');
	const reusablePayload = Buffer.allocUnsafe(BINARY_CHUNK_BYTES);
	let applicationPressureWaits = 0;
	let binarySentBytes = 0;
	let binarySequence = 0;
	let falseSendResults = 0;
	let maxBufferedAmount = 0;
	let maxInFlightBytes = 0;
	let nativePressureWaits = 0;

	while (binarySentBytes < BINARY_BYTES) {
		if (inFlightSequences.size >= MAX_IN_FLIGHT_CHUNKS) {
			applicationPressureWaits += 1;
			await withTimeout(nextAckSignal.promise, 'binary acknowledgement');
			continue;
		}

		const bufferedBefore = assetChannel.bufferedAmount();
		maxBufferedAmount = Math.max(maxBufferedAmount, bufferedBefore);
		if (bufferedBefore >= NATIVE_HIGH_WATER_BYTES) {
			nativePressureWaits += 1;
			await waitForNativeDrain('native buffered-amount-low');
			continue;
		}

		const payloadBytes = Math.min(
			BINARY_CHUNK_BYTES,
			BINARY_BYTES - binarySentBytes,
		);
		reusablePayload.fill(binarySequence % 251);
		const payload = reusablePayload.subarray(0, payloadBytes);
		const frame = Buffer.allocUnsafe(payload.byteLength + 4);
		frame.writeUInt32BE(binarySequence, 0);
		payload.copy(frame, 4);

		// A false return is a pressure signal, not proof that the frame was
		// rejected. Never retry this sequence solely because the Boolean is false.
		const sendResult = assetChannel.sendMessageBinary(frame);
		if (!sendResult) falseSendResults += 1;
		binarySenderHash.update(payload);
		inFlightSequences.add(binarySequence);
		binarySequence += 1;
		binarySentBytes += payload.byteLength;
		maxBufferedAmount = Math.max(
			maxBufferedAmount,
			assetChannel.bufferedAmount(),
		);
		maxInFlightBytes = Math.max(
			maxInFlightBytes,
			inFlightSequences.size * BINARY_CHUNK_BYTES,
		);
	}

	await withTimeout(
		Promise.all([
			binaryDone.promise,
			(async () => {
				while (inFlightSequences.size > 0) {
					await withTimeout(
						nextAckSignal.promise,
						'final binary acknowledgement',
					);
				}
			})(),
		]),
		'binary transfer and acknowledgements',
	);

	const sentDigest = binarySenderHash.digest('hex');
	const receivedDigest = binaryReceiverHash.digest('hex');
	assert.equal(binaryReceivedBytes, BINARY_BYTES);
	assert.equal(receivedDigest, sentDigest);
	assert.ok(applicationPressureWaits > 0);
	if (process.env.TERMINAY_SPIKE_EXPECT_FALSE_SEND === '1') {
		assert.ok(falseSendResults > 0);
	}
	assert.ok(maxInFlightBytes <= ACK_WINDOW_BYTES);
	assert.ok(
		maxBufferedAmount <= NATIVE_HIGH_WATER_BYTES + BINARY_CHUNK_BYTES + 4,
	);

	const closedA = [...channelsA.values()].map(() => deferred());
	const closedB = [...channelsB.values()].map(() => deferred());
	[...channelsA.values()].forEach((channel, index) => {
		channel.onClosed(() => closedA[index].resolve());
	});
	[...channelsB.values()].forEach((channel, index) => {
		channel.onClosed(() => closedB[index].resolve());
	});
	for (const channel of channelsA.values()) {
		channel.close();
	}
	await withTimeout(
		Promise.all([
			...closedA.map(({ promise }) => promise),
			...closedB.map(({ promise }) => promise),
		]),
		'channel closure',
	);

	peerA.close();
	peerB.close();
	cleanup();
	await new Promise((resolve) => setImmediate(resolve));

	const activeNonStdioHandles = process
		._getActiveHandles()
		.map((handle) => handle.constructor?.name ?? typeof handle)
		.filter((name) => name !== 'Socket');
	assert.deepEqual(activeNonStdioHandles, []);

	return {
		activeNonStdioHandles,
		ackWindowBytes: ACK_WINDOW_BYTES,
		applicationPressureWaits,
		binaryBytes: BINARY_BYTES,
		binaryDigest: sentDigest,
		channels: CHANNEL_LABELS,
		durationMs: Math.round(performance.now() - startedAt),
		falseSendResults,
		libdatachannelVersion: getLibraryVersion(),
		maxBufferedAmount,
		maxInFlightBytes,
		maxMessageSize,
		nativePressureWaits,
		nodeDatachannelVersion: packageVersion,
		nodeVersion: process.version,
		orderedMessagesPerDirectionPerChannel: ORDERED_MESSAGES,
		platform: `${process.platform}-${process.arch}`,
	};
}

try {
	console.log(JSON.stringify(await runProof()));
} catch (error) {
	try {
		cleanup();
	} catch {
		// Preserve the original proof failure.
	}
	console.error(error);
	process.exitCode = 1;
}
