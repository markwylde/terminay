#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSelectedSecureWeriftRuntime } from '../apps/terminay-server/dist/remote/secureWeriftRuntime.js';

const CHANNEL_LABELS = ['api', 'asset', 'control', 'terminal'];
const FRAME_BYTES = 4 * 1024;
const CHANNEL_HIGH_WATER_BYTES = 256 * 1024;
const APPLICATION_QUEUE_LIMIT = 128;
const RESOURCE_CLEANUP_TIMEOUT_MS = 15_000;
const RESOURCE_QUIESCENCE_MS = 500;
const RESOURCE_POLL_INTERVAL_MS = 25;
const NETWORK_OR_TIMER_RESOURCE = /UDP|Socket|Timeout/iu;

const delay = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, description, timeoutMs = 20_000) {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt >= timeoutMs) {
			throw new Error(`Timed out waiting for ${description}.`);
		}
		await delay(10);
	}
}

export function selectedResourceCounts(resources) {
	const counts = new Map();
	for (const name of resources) {
		if (!NETWORK_OR_TIMER_RESOURCE.test(name)) continue;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return counts;
}

export function selectedResourceGrowth(resourcesBefore, resourcesAfter) {
	const before = selectedResourceCounts(resourcesBefore);
	const after = selectedResourceCounts(resourcesAfter);
	return [...after]
		.map(([name, count]) => [name, count - (before.get(name) ?? 0)])
		.filter(([, count]) => count > 0);
}

async function waitForSelectedResourcesToClose(resourcesBefore) {
	const startedAt = Date.now();
	let quiescentSince = null;
	let resourcesAfter = process.getActiveResourcesInfo();
	while (Date.now() - startedAt < RESOURCE_CLEANUP_TIMEOUT_MS) {
		resourcesAfter = process.getActiveResourcesInfo();
		if (selectedResourceGrowth(resourcesBefore, resourcesAfter).length === 0) {
			quiescentSince ??= Date.now();
			if (Date.now() - quiescentSince >= RESOURCE_QUIESCENCE_MS) {
				return resourcesAfter;
			}
		} else {
			quiescentSince = null;
		}
		await delay(RESOURCE_POLL_INTERVAL_MS);
	}
	const growth = Object.fromEntries(
		selectedResourceGrowth(resourcesBefore, resourcesAfter),
	);
	throw new Error(
		`Timed out waiting for selected Werift network and timer resources to close; remaining growth: ${JSON.stringify(growth)}.`,
	);
}

function positiveInteger(value, name, fallback) {
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new TypeError(`${name} must be a positive integer`);
	}
	return parsed;
}

function parseArguments(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag?.startsWith('--') || value === undefined) {
			throw new Error('every task20 WebRTC load option requires a value');
		}
		values.set(flag, value);
	}
	const runtimeRoot = values.get('--runtime-root');
	if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) {
		throw new TypeError(
			'--runtime-root must be an absolute selected-runtime directory',
		);
	}
	const mode = values.get('--mode') ?? 'direct';
	if (mode !== 'direct' && mode !== 'turn') {
		throw new TypeError('--mode must be direct or turn');
	}
	return {
		durationMs: positiveInteger(
			values.get('--duration-ms'),
			'--duration-ms',
			15_000,
		),
		maxCpuMs: positiveInteger(
			values.get('--max-cpu-ms'),
			'--max-cpu-ms',
			30_000,
		),
		maxRssGrowthBytes: positiveInteger(
			values.get('--max-rss-growth-bytes'),
			'--max-rss-growth-bytes',
			512 * 1024 * 1024,
		),
		mode,
		peerPairs: positiveInteger(values.get('--peer-pairs'), '--peer-pairs', 6),
		runtimeRoot,
		turnConfigPath: values.get('--turn-config'),
		turnPort: values.get('--turn-port'),
	};
}

async function iceConfiguration(options, pairIndex) {
	const direct = {
		iceAdditionalHostAddresses: ['127.0.0.1'],
		iceServers: [],
		iceUseIpv4: true,
		iceUseIpv6: false,
	};
	if (options.mode === 'direct') return direct;
	if (!options.turnConfigPath || !options.turnPort) {
		throw new Error('TURN mode requires --turn-config and --turn-port');
	}
	const port = positiveInteger(options.turnPort, '--turn-port');
	if (port > 65_535) throw new TypeError('--turn-port must be at most 65535');
	const config = await readFile(options.turnConfigPath, 'utf8');
	const secret = /^static-auth-secret=(.+)$/mu.exec(config)?.[1]?.trim();
	if (!secret)
		throw new Error('TURN config does not contain static-auth-secret');
	const credentialLifetimeSeconds = Math.max(
		15,
		Math.ceil(options.durationMs / 1_000) + 10,
	);
	const username = `${Math.floor(Date.now() / 1_000) + credentialLifetimeSeconds}:task20-load-${pairIndex}`;
	return {
		...direct,
		iceTransportPolicy: 'relay',
		iceServers: [
			{
				credential: createHmac('sha1', secret)
					.update(username)
					.digest('base64'),
				urls: `turn:127.0.0.1:${port}?transport=udp`,
				username,
			},
		],
	};
}

async function selectedCandidatePair(peer) {
	const stats = await peer.getStats();
	const entries = [...stats.values()];
	const transport = entries.find(
		(entry) =>
			entry.type === 'transport' &&
			typeof entry.selectedCandidatePairId === 'string',
	);
	const pair =
		(transport ? stats.get(transport.selectedCandidatePairId) : undefined) ??
		entries.find(
			(entry) =>
				entry.type === 'candidate-pair' &&
				entry.nominated === true &&
				entry.state === 'succeeded',
		);
	if (!pair) throw new Error('selected Werift candidate pair is unavailable');
	const local = stats.get(pair.localCandidateId);
	const remote = stats.get(pair.remoteCandidateId);
	if (!local || !remote) {
		throw new Error('selected Werift candidate details are unavailable');
	}
	return {
		localType: local.candidateType,
		protocol: local.protocol,
		remoteType: remote.candidateType,
	};
}

function subscribe(target, listener) {
	if (target?.subscribe) return target.subscribe(listener);
	throw new TypeError('selected Werift event surface is unavailable');
}

async function createPair(RuntimePeer, configuration, pairIndex, metrics) {
	const left = new RuntimePeer({
		...configuration,
		maxMessageSize: 1024 * 1024,
	});
	const right = new RuntimePeer({
		...configuration,
		maxMessageSize: 1024 * 1024,
	});
	const leftChannels = new Map();
	const rightChannels = new Map();
	const receiveQueues = new Map(CHANNEL_LABELS.map((label) => [label, []]));
	const outstandingByLabel = new Map(CHANNEL_LABELS.map((label) => [label, 0]));
	const subscriptions = [];

	try {
		subscriptions.push(
			subscribe(right.onDataChannel, (channel) => {
				rightChannels.set(channel.label, channel);
				subscriptions.push(
					subscribe(channel.onMessage, (message) => {
						const queue = receiveQueues.get(channel.label);
						if (!queue)
							throw new Error(
								`unexpected selected-runtime channel ${channel.label}`,
							);
						if (queue.length >= APPLICATION_QUEUE_LIMIT)
							metrics.queueRejects += 1;
						else {
							queue.push(message);
							metrics.maxApplicationQueue = Math.max(
								metrics.maxApplicationQueue,
								queue.length,
							);
						}
					}),
				);
			}),
		);
		for (const label of CHANNEL_LABELS) {
			leftChannels.set(label, left.createDataChannel(label, { ordered: true }));
		}

		const offer = await left.createOffer();
		await left.setLocalDescription(offer);
		await right.setRemoteDescription(left.localDescription);
		const answer = await right.createAnswer();
		await right.setLocalDescription(answer);
		await left.setRemoteDescription(right.localDescription);
		await waitFor(
			() =>
				left.connectionState === 'connected' &&
				right.connectionState === 'connected',
			`selected Werift pair ${pairIndex} to connect`,
		);
		await waitFor(
			() =>
				rightChannels.size === CHANNEL_LABELS.length &&
				[...leftChannels.values(), ...rightChannels.values()].every(
					(channel) => channel.readyState === 'open',
				),
			`selected Werift pair ${pairIndex} channels to open`,
		);
		const route = await selectedCandidatePair(left);

		return {
			closed: false,
			left,
			leftChannels,
			outstandingByLabel,
			receiveQueues,
			right,
			rightChannels,
			route,
			subscriptions,
		};
	} catch (error) {
		for (const subscription of subscriptions.splice(0))
			subscription?.unSubscribe?.();
		// Werift can leave the Promise returned by close pending when ICE never
		// connected. Calling close is still the required synchronous teardown
		// trigger; do not let that advisory Promise hide the original bounded
		// setup failure or pin the release probe indefinitely.
		void Promise.resolve(left.close()).catch(() => undefined);
		void Promise.resolve(right.close()).catch(() => undefined);
		await delay(0);
		throw error;
	}
}

async function closePair(pair) {
	if (pair.closed) return;
	pair.closed = true;
	for (const subscription of pair.subscriptions.splice(0))
		subscription?.unSubscribe?.();
	await Promise.allSettled([pair.left.close(), pair.right.close()]);
}

export async function runSelectedWeriftMultiPeerLoad(options) {
	const { RTCPeerConnection } = await loadSelectedSecureWeriftRuntime(
		options.runtimeRoot,
	);
	const resourcesBefore = process.getActiveResourcesInfo();
	const rssBefore = process.memoryUsage().rss;
	const cpuBefore = process.cpuUsage();
	const metrics = {
		bytesSent: 0,
		framesSent: 0,
		maxApplicationQueue: 0,
		maxBufferedAmount: 0,
		peerCrashes: 0,
		peerRecoveries: 0,
		queueRejects: 0,
	};
	const pairs = [];
	let crashReplacementRoute = null;
	try {
		pairs.push(
			...(await Promise.all(
				Array.from({ length: options.peerPairs }, async (_, index) =>
					createPair(
						RTCPeerConnection,
						await iceConfiguration(options, index),
						index,
						metrics,
					),
				),
			)),
		);
		if (options.mode === 'turn') {
			assert.ok(
				pairs.every(
					(pair) =>
						pair.route.localType === 'relay' &&
						pair.route.remoteType === 'relay',
				),
				'TURN load must select relay candidates for every pair',
			);
		}
		const startedAt = Date.now();
		let crashProven = false;
		while (Date.now() - startedAt < options.durationMs) {
			if (!crashProven && Date.now() - startedAt >= options.durationMs / 2) {
				await closePair(pairs[0]);
				metrics.peerCrashes += 1;
				const replacement = await createPair(
					RTCPeerConnection,
					await iceConfiguration(options, options.peerPairs),
					options.peerPairs,
					metrics,
				);
				if (options.mode === 'turn') {
					assert.equal(replacement.route.localType, 'relay');
					assert.equal(replacement.route.remoteType, 'relay');
				}
				pairs.push(replacement);
				crashReplacementRoute = replacement.route;
				metrics.peerRecoveries += 1;
				crashProven = true;
			}
			for (const pair of pairs) {
				if (pair.closed) continue;
				for (const [label, channel] of pair.leftChannels) {
					const queue = pair.receiveQueues.get(label);
					// The asset consumer is intentionally slower. Its explicit queue is
					// bounded independently from the native SCTP bufferedAmount bound.
					if (label !== 'asset' || metrics.framesSent % 4 === 0) {
						if (queue.shift() !== undefined) {
							pair.outstandingByLabel.set(
								label,
								pair.outstandingByLabel.get(label) - 1,
							);
						}
					}
					if (
						pair.outstandingByLabel.get(label) >= APPLICATION_QUEUE_LIMIT ||
						channel.bufferedAmount > CHANNEL_HIGH_WATER_BYTES
					)
						continue;
					const frame = Buffer.alloc(FRAME_BYTES, metrics.framesSent % 251);
					frame.writeUInt32BE(metrics.framesSent, 0);
					channel.send(frame);
					pair.outstandingByLabel.set(
						label,
						pair.outstandingByLabel.get(label) + 1,
					);
					metrics.framesSent += 1;
					metrics.bytesSent += frame.byteLength;
					metrics.maxBufferedAmount = Math.max(
						metrics.maxBufferedAmount,
						channel.bufferedAmount,
					);
				}
			}
			await delay(2);
		}
		assert.equal(
			crashProven,
			true,
			'one selected-runtime peer pair must crash during load',
		);
		assert.equal(metrics.peerCrashes, 1);
		assert.equal(metrics.peerRecoveries, 1);
		assert.ok(metrics.framesSent > options.peerPairs * CHANNEL_LABELS.length);
		assert.ok(metrics.maxApplicationQueue <= APPLICATION_QUEUE_LIMIT);
		assert.ok(
			metrics.maxBufferedAmount <= CHANNEL_HIGH_WATER_BYTES + FRAME_BYTES,
		);
	} finally {
		await Promise.all(pairs.map(closePair));
	}

	const resourcesAfter = await waitForSelectedResourcesToClose(resourcesBefore);
	const cpu = process.cpuUsage(cpuBefore);
	const cpuMs = (cpu.user + cpu.system) / 1_000;
	const rssGrowthBytes = Math.max(0, process.memoryUsage().rss - rssBefore);
	assert.ok(
		cpuMs <= options.maxCpuMs,
		`CPU ${cpuMs}ms exceeded ${options.maxCpuMs}ms`,
	);
	assert.ok(
		rssGrowthBytes <= options.maxRssGrowthBytes,
		`RSS growth ${rssGrowthBytes} exceeded ${options.maxRssGrowthBytes}`,
	);
	assert.deepEqual(selectedResourceGrowth(resourcesBefore, resourcesAfter), []);
	return {
		...metrics,
		channelsPerPair: CHANNEL_LABELS.length,
		crashReplacementRoute,
		cpuMs,
		durationMs: options.durationMs,
		mode: options.mode,
		peerPairs: options.peerPairs,
		platform: `${process.platform}-${process.arch}`,
		routes: pairs.map((pair) => pair.route),
		resourcesBefore,
		resourcesAfter,
		rssGrowthBytes,
		runtime: 'secure-werift',
	};
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) ===
		path.resolve(new URL(import.meta.url).pathname)
) {
	const result = await runSelectedWeriftMultiPeerLoad(
		parseArguments(process.argv.slice(2)),
	);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
