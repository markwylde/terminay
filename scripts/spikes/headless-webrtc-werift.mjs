import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { RTCPeerConnection } from 'werift';

const { version: weriftVersion } = JSON.parse(
	await readFile(
		new URL('../package.json', import.meta.resolve('werift')),
		'utf8',
	),
);

const CHANNEL_LABELS = ['api', 'asset', 'terminal'];
const ORDERED_MESSAGE_COUNT = 32;
const ASSET_BYTES = 8 * 1024 * 1024;
const ASSET_CHUNK_BYTES = 48 * 1024;
const ASSET_HIGH_WATER_BYTES = 256 * 1024;
const ASSET_LOW_WATER_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, description, timeoutMs = TIMEOUT_MS) {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt >= timeoutMs) {
			throw new Error(`Timed out waiting for ${description}.`);
		}
		await delay(10);
	}
}

function asBuffer(value) {
	return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function dataChannelConfig() {
	return {
		iceAdditionalHostAddresses: ['127.0.0.1'],
		iceServers: [],
		iceUseIpv4: true,
		iceUseIpv6: false,
	};
}

async function sendBoundedAsset(channel, onChunk) {
	channel.bufferedAmountLowThreshold = ASSET_LOW_WATER_BYTES;

	let chunks = 0;
	let maxBufferedAmount = 0;
	let pressureWaits = 0;
	let sentBytes = 0;

	while (sentBytes < ASSET_BYTES) {
		if (channel.bufferedAmount > ASSET_HIGH_WATER_BYTES) {
			pressureWaits += 1;
			await channel.bufferedAmountLow.asPromise(TIMEOUT_MS);
		}

		const size = Math.min(ASSET_CHUNK_BYTES, ASSET_BYTES - sentBytes);
		const chunk = Buffer.alloc(size, chunks % 251);
		chunk.writeUInt32BE(chunks, 0);
		onChunk(chunk);
		channel.send(chunk);
		chunks += 1;
		sentBytes += size;
		maxBufferedAmount = Math.max(maxBufferedAmount, channel.bufferedAmount);
	}

	return {
		chunks,
		maxBufferedAmount,
		pressureWaits,
		sentBytes,
	};
}

async function runProof() {
	const startedAt = Date.now();
	const host = new RTCPeerConnection(dataChannelConfig());
	const client = new RTCPeerConnection(dataChannelConfig());
	const hostCandidates = [];
	const clientCandidates = [];
	const hostChannels = new Map();
	const clientChannels = new Map();
	const receivedAtHost = new Map(CHANNEL_LABELS.map((label) => [label, []]));
	const receivedAtClient = new Map(CHANNEL_LABELS.map((label) => [label, []]));
	const receivedAssetHash = createHash('sha256');
	let receivedAssetBytes = 0;
	let receivedAssetChunks = 0;

	host.onIceCandidate.subscribe((candidate) => {
		if (candidate) hostCandidates.push(candidate.toJSON());
	});
	client.onIceCandidate.subscribe((candidate) => {
		if (candidate) clientCandidates.push(candidate.toJSON());
	});

	client.onDataChannel.subscribe((channel) => {
		clientChannels.set(channel.label, channel);
		channel.onMessage.subscribe((message) => {
			if (typeof message === 'string') {
				receivedAtClient.get(channel.label)?.push(message);
				channel.send(
					`client:${channel.label}:${receivedAtClient.get(channel.label).length - 1}`,
				);
				return;
			}

			assert.equal(channel.label, 'asset');
			const chunk = asBuffer(message);
			assert.equal(chunk.readUInt32BE(0), receivedAssetChunks);
			receivedAssetChunks += 1;
			receivedAssetBytes += chunk.byteLength;
			receivedAssetHash.update(chunk);
		});
	});

	for (const label of CHANNEL_LABELS) {
		const channel = host.createDataChannel(label, { ordered: true });
		hostChannels.set(label, channel);
		channel.onMessage.subscribe((message) => {
			assert.equal(typeof message, 'string');
			receivedAtHost.get(label)?.push(message);
		});
	}

	const offer = await host.createOffer();
	assert.equal(offer.type, 'offer');
	await host.setLocalDescription(offer);
	await client.setRemoteDescription(host.localDescription);

	const answer = await client.createAnswer();
	assert.equal(answer.type, 'answer');
	await client.setLocalDescription(answer);
	await host.setRemoteDescription(client.localDescription);

	await waitFor(
		() =>
			host.connectionState === 'connected' &&
			client.connectionState === 'connected',
		'both displayless peers to connect',
	);
	await waitFor(
		() =>
			clientChannels.size === CHANNEL_LABELS.length &&
			[...hostChannels.values(), ...clientChannels.values()].every(
				(channel) => channel.readyState === 'open',
			),
		'all isolated data channels to open',
	);

	assert.ok(hostCandidates.length > 0);
	assert.ok(clientCandidates.length > 0);
	assert.match(host.localDescription.sdp, /a=candidate:/);
	assert.match(client.localDescription.sdp, /a=candidate:/);
	assert.deepEqual(
		[...clientChannels.keys()].sort(),
		[...CHANNEL_LABELS].sort(),
	);
	assert.ok(
		[...hostChannels.values(), ...clientChannels.values()].every(
			(channel) => channel.ordered,
		),
	);

	for (const label of CHANNEL_LABELS) {
		const channel = hostChannels.get(label);
		for (let sequence = 0; sequence < ORDERED_MESSAGE_COUNT; sequence += 1) {
			channel.send(`host:${label}:${sequence}`);
		}
	}

	await waitFor(
		() =>
			CHANNEL_LABELS.every(
				(label) =>
					receivedAtHost.get(label).length === ORDERED_MESSAGE_COUNT &&
					receivedAtClient.get(label).length === ORDERED_MESSAGE_COUNT,
			),
		'ordered bidirectional channel messages',
	);

	for (const label of CHANNEL_LABELS) {
		assert.deepEqual(
			receivedAtClient.get(label),
			Array.from(
				{ length: ORDERED_MESSAGE_COUNT },
				(_, sequence) => `host:${label}:${sequence}`,
			),
		);
		assert.deepEqual(
			receivedAtHost.get(label),
			Array.from(
				{ length: ORDERED_MESSAGE_COUNT },
				(_, sequence) => `client:${label}:${sequence}`,
			),
		);
	}

	const sentAssetHash = createHash('sha256');
	const assetStartedAt = Date.now();
	const assetMetrics = await sendBoundedAsset(
		hostChannels.get('asset'),
		(chunk) => sentAssetHash.update(chunk),
	);
	await waitFor(
		() => receivedAssetBytes === ASSET_BYTES,
		'bounded asset transfer',
	);
	const assetDurationMs = Date.now() - assetStartedAt;

	assert.equal(receivedAssetChunks, assetMetrics.chunks);
	assert.equal(receivedAssetBytes, assetMetrics.sentBytes);
	assert.equal(receivedAssetHash.digest('hex'), sentAssetHash.digest('hex'));
	assert.ok(assetMetrics.pressureWaits > 0);
	assert.ok(
		assetMetrics.maxBufferedAmount <=
			ASSET_HIGH_WATER_BYTES + ASSET_CHUNK_BYTES,
		`buffered amount ${assetMetrics.maxBufferedAmount} exceeded the configured bound`,
	);

	const closeStartedAt = Date.now();
	await Promise.all([host.close(), client.close()]);
	await waitFor(
		() =>
			host.connectionState === 'closed' &&
			client.connectionState === 'closed' &&
			[...hostChannels.values(), ...clientChannels.values()].every(
				(channel) => channel.readyState === 'closed',
			),
		'peers and channels to close',
	);
	await waitFor(
		() =>
			process
				.getActiveResourcesInfo()
				.every((resource) => resource === 'PipeWrap'),
		'werift network sockets and timers to release',
		3_000,
	);

	return {
		activeResourcesAfterClose: process.getActiveResourcesInfo(),
		answerBytes: client.localDescription.sdp.length,
		asset: {
			bytes: assetMetrics.sentBytes,
			chunkBytes: ASSET_CHUNK_BYTES,
			chunks: assetMetrics.chunks,
			durationMs: assetDurationMs,
			highWaterBytes: ASSET_HIGH_WATER_BYTES,
			lowWaterBytes: ASSET_LOW_WATER_BYTES,
			maxBufferedAmount: assetMetrics.maxBufferedAmount,
			pressureWaits: assetMetrics.pressureWaits,
		},
		channels: CHANNEL_LABELS,
		clientIceCandidates: clientCandidates.length,
		closeDurationMs: Date.now() - closeStartedAt,
		durationMs: Date.now() - startedAt,
		hostIceCandidates: hostCandidates.length,
		nodeVersion: process.version,
		offerBytes: host.localDescription.sdp.length,
		orderedMessagesPerDirectionPerChannel: ORDERED_MESSAGE_COUNT,
		platform: `${process.platform}-${process.arch}`,
		weriftVersion,
	};
}

try {
	const result = await runProof();
	console.log(JSON.stringify(result));
} catch (error) {
	console.error(error);
	process.exitCode = 1;
}
