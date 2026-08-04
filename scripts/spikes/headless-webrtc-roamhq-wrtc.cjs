const crypto = require('node:crypto');

const wrtc = require('@roamhq/wrtc');

const API_MESSAGE_COUNT = 64;
const ASSET_BYTES = 8 * 1024 * 1024;
const ASSET_CHUNK_BYTES = 48 * 1024;
const BUFFER_HIGH_WATER = 256 * 1024;
const BUFFER_LOW_WATER = 64 * 1024;

function withTimeout(promise, timeoutMs, label) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`Timed out waiting for ${label}.`)),
				timeoutMs,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

function waitForEvent(target, eventName, timeoutMs = 10_000) {
	return withTimeout(
		new Promise((resolve, reject) => {
			const onEvent = (event) => {
				cleanup();
				resolve(event);
			};
			const onError = (event) => {
				cleanup();
				reject(
					new Error(
						`${eventName} failed: ${event?.message ?? event?.error ?? 'unknown error'}`,
					),
				);
			};
			const cleanup = () => {
				target.removeEventListener(eventName, onEvent);
				target.removeEventListener('error', onError);
			};

			target.addEventListener(eventName, onEvent);
			target.addEventListener('error', onError);
		}),
		timeoutMs,
		eventName,
	);
}

async function waitForBufferedAmount(channel, target, timeoutMs = 10_000) {
	const startedAt = Date.now();
	while (channel.bufferedAmount > target) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(
				`${channel.label} bufferedAmount did not drain below ${target}; ` +
					`last value was ${channel.bufferedAmount}.`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

function collectOrderedText(channel, prefix, count) {
	const received = [];
	return withTimeout(
		new Promise((resolve, reject) => {
			const onMessage = (event) => {
				if (
					typeof event.data !== 'string' ||
					!event.data.startsWith(`${prefix}:`)
				) {
					return;
				}

				const sequence = Number(event.data.slice(prefix.length + 1));
				if (sequence !== received.length) {
					channel.removeEventListener('message', onMessage);
					reject(
						new Error(
							`${prefix} expected message ${received.length}, received ${sequence}.`,
						),
					);
					return;
				}

				received.push(sequence);
				if (received.length === count) {
					channel.removeEventListener('message', onMessage);
					resolve(received.length);
				}
			};

			channel.addEventListener('message', onMessage);
		}),
		5_000,
		`${prefix} ordered messages`,
	);
}

function receiveBinary(channel, marker) {
	channel.binaryType = 'arraybuffer';
	const expectedChunks = Math.ceil(ASSET_BYTES / ASSET_CHUNK_BYTES);
	const hash = crypto.createHash('sha256');
	let bytes = 0;
	let expectedSequence = 0;

	return withTimeout(
		new Promise((resolve, reject) => {
			const onMessage = (event) => {
				if (typeof event.data === 'string') {
					return;
				}

				const frame = Buffer.from(event.data);
				if (frame.subarray(4, 8).toString('ascii') !== marker) {
					return;
				}

				const sequence = frame.readUInt32BE(0);
				if (sequence !== expectedSequence) {
					channel.removeEventListener('message', onMessage);
					reject(
						new Error(
							`${marker} expected binary chunk ${expectedSequence}, received ${sequence}.`,
						),
					);
					return;
				}

				expectedSequence += 1;
				bytes += frame.byteLength - 8;
				hash.update(frame.subarray(8));

				if (expectedSequence === expectedChunks) {
					channel.removeEventListener('message', onMessage);
					resolve({
						bytes,
						chunks: expectedSequence,
						sha256: hash.digest('hex'),
					});
				}
			};

			channel.addEventListener('message', onMessage);
		}),
		20_000,
		`${marker} binary receive`,
	);
}

async function sendBinary(channel, marker) {
	const hash = crypto.createHash('sha256');
	let backpressureWaits = 0;
	let bytes = 0;
	let maxBufferedAmount = 0;
	let sequence = 0;

	while (bytes < ASSET_BYTES) {
		if (channel.bufferedAmount > BUFFER_HIGH_WATER) {
			backpressureWaits += 1;
			await waitForBufferedAmount(channel, BUFFER_LOW_WATER);
		}

		const payloadSize = Math.min(ASSET_CHUNK_BYTES, ASSET_BYTES - bytes);
		const payload = Buffer.allocUnsafe(payloadSize);
		for (let index = 0; index < payloadSize; index += 1) {
			payload[index] = (sequence * 19 + index * 13) & 0xff;
		}

		const frame = Buffer.allocUnsafe(payloadSize + 8);
		frame.writeUInt32BE(sequence, 0);
		frame.write(marker, 4, 4, 'ascii');
		payload.copy(frame, 8);

		hash.update(payload);
		channel.send(frame);
		bytes += payloadSize;
		sequence += 1;
		maxBufferedAmount = Math.max(maxBufferedAmount, channel.bufferedAmount);
	}

	return {
		backpressureWaits,
		bytes,
		chunks: sequence,
		maxBufferedAmount,
		sha256: hash.digest('hex'),
	};
}

async function run() {
	const startedAt = Date.now();
	const left = new wrtc.RTCPeerConnection({ iceServers: [] });
	const right = new wrtc.RTCPeerConnection({ iceServers: [] });
	const labels = ['api', 'terminal', 'asset'];
	const leftChannels = Object.fromEntries(
		labels.map((label) => [
			label,
			left.createDataChannel(label, { ordered: true }),
		]),
	);
	const rightChannels = {};
	const iceCandidates = { left: 0, right: 0 };
	let resolveRightChannels;
	const rightChannelsReady = new Promise((resolve) => {
		resolveRightChannels = resolve;
	});

	left.addEventListener('icecandidate', (event) => {
		if (event.candidate) {
			iceCandidates.left += 1;
			void right.addIceCandidate(event.candidate);
		}
	});
	right.addEventListener('icecandidate', (event) => {
		if (event.candidate) {
			iceCandidates.right += 1;
			void left.addIceCandidate(event.candidate);
		}
	});
	right.addEventListener('datachannel', (event) => {
		rightChannels[event.channel.label] = event.channel;
		if (Object.keys(rightChannels).length === labels.length) {
			resolveRightChannels();
		}
	});

	try {
		const offer = await left.createOffer();
		await left.setLocalDescription(offer);
		await right.setRemoteDescription(offer);
		const answer = await right.createAnswer();
		await right.setLocalDescription(answer);
		await left.setRemoteDescription(answer);

		await withTimeout(
			Promise.all(
				labels.map((label) =>
					leftChannels[label].readyState === 'open'
						? undefined
						: waitForEvent(leftChannels[label], 'open'),
				),
			),
			10_000,
			'left data channels',
		);
		await withTimeout(rightChannelsReady, 10_000, 'right data channels');

		const textReceivers = [];
		for (const label of ['api', 'terminal']) {
			const leftToRight = collectOrderedText(
				rightChannels[label],
				`${label}-left-to-right`,
				API_MESSAGE_COUNT,
			);
			const rightToLeft = collectOrderedText(
				leftChannels[label],
				`${label}-right-to-left`,
				API_MESSAGE_COUNT,
			);

			for (let sequence = 0; sequence < API_MESSAGE_COUNT; sequence += 1) {
				leftChannels[label].send(`${label}-left-to-right:${sequence}`);
				rightChannels[label].send(`${label}-right-to-left:${sequence}`);
			}
			textReceivers.push(leftToRight, rightToLeft);
		}
		await Promise.all(textReceivers);

		const binaryStartedAt = Date.now();
		const leftToRightReceiver = receiveBinary(rightChannels.asset, 'L2R!');
		const leftToRightSender = await sendBinary(leftChannels.asset, 'L2R!');
		const leftToRightReceived = await leftToRightReceiver;

		const rightToLeftReceiver = receiveBinary(leftChannels.asset, 'R2L!');
		const rightToLeftSender = await sendBinary(rightChannels.asset, 'R2L!');
		const rightToLeftReceived = await rightToLeftReceiver;

		if (
			leftToRightSender.sha256 !== leftToRightReceived.sha256 ||
			rightToLeftSender.sha256 !== rightToLeftReceived.sha256
		) {
			throw new Error('Binary transfer SHA-256 mismatch.');
		}

		const dataChannelPrototype = Object.getPrototypeOf(leftChannels.asset);
		const backpressureApi = {
			bufferedAmountLowThreshold: Object.hasOwn(
				dataChannelPrototype,
				'bufferedAmountLowThreshold',
			),
			bufferedAmountLowEvent: Object.hasOwn(
				dataChannelPrototype,
				'onbufferedamountlow',
			),
		};

		for (const channel of [
			...Object.values(leftChannels),
			...Object.values(rightChannels),
		]) {
			channel.close();
		}
		left.close();
		right.close();
		await new Promise((resolve) => setTimeout(resolve, 250));

		const activeResources = process
			.getActiveResourcesInfo()
			.filter(
				(resource) =>
					resource !== 'PipeWrap' &&
					resource !== 'TTYWrap' &&
					resource !== 'Timeout',
			);

		console.log(
			JSON.stringify(
				{
					activeResourcesAfterClose: activeResources,
					backpressureApi,
					binary: {
						leftToRightReceived,
						leftToRightSender,
						rightToLeftReceived,
						rightToLeftSender,
						transferMs: Date.now() - binaryStartedAt,
					},
					closeStates: {
						channels: [
							...Object.values(leftChannels),
							...Object.values(rightChannels),
						].map((channel) => channel.readyState),
						left: left.connectionState,
						right: right.connectionState,
					},
					iceCandidates,
					node: process.version,
					orderedText: {
						channels: 2,
						messagesEachDirectionPerChannel: API_MESSAGE_COUNT,
					},
					platform: `${process.platform}-${process.arch}`,
					totalMs: Date.now() - startedAt,
					wrtc: require('@roamhq/wrtc/package.json').version,
				},
				null,
				2,
			),
		);
	} finally {
		for (const channel of [
			...Object.values(leftChannels),
			...Object.values(rightChannels),
		]) {
			if (channel.readyState !== 'closed') {
				channel.close();
			}
		}
		left.close();
		right.close();
	}
}

run().catch((error) => {
	console.error(error.stack ?? error);
	process.exitCode = 1;
});
