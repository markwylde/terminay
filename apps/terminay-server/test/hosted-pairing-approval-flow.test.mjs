import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
	assertAuthenticatedWebRtcTransportTranscript,
	deriveMatchCode,
	deviceJoinProofPayload,
	parseEnrollmentPushMessage,
	parsePendingEnrollmentResponse,
	verifyAuthenticatedWebRtcHostSignature,
	verifyAuthenticatedWebRtcPairingAuthenticator,
} from '@terminay/protocol';
import {
	approvalSocketPath,
	sendApprovalSocketRequest,
	startApprovalSocket,
} from '../dist/remote/approvalSocket.js';
import { createDirectSignalingRelay } from '../dist/remote/directSignalingRelay.js';
import { directSessionId } from '../dist/remote/directSessionId.js';
import { loadOrCreateDirectTlsCertificate } from '../dist/remote/directTlsCertificate.js';
import { createHostedHostKey } from '../dist/remote/hostedHostKey.js';
import { deriveHostedPairingSecrets } from '../dist/remote/hostedPairingSecrets.js';
import { startHostedPairingHost } from '../dist/remote/hostedPairingHost.js';
import { createServerRemoteExposure } from '../dist/remote/serverExposure.js';
import { loadSelectedSecureWeriftRuntime } from '../dist/remote/secureWeriftRuntime.js';

/**
 * Real loopback WebRTC between the hosted pairing host and a Werift client,
 * through an in-process relay that only forwards frames. It proves the
 * approval flow, the pre-ticket embargo, deferred live-peer replacement, and
 * device-join proof checks against the production host code.
 */

// Resolve from this file, not the cwd: turbo runs the workspace suite from
// apps/terminay-server while the staged runtime lives at the repository root.
const RUNTIME_ROOT = process.env.TERMINAY_WEBRTC_RUNTIME_ROOT
	? resolve(process.env.TERMINAY_WEBRTC_RUNTIME_ROOT)
	: fileURLToPath(new URL('../../../build/webrtc-runtime', import.meta.url));
const SESSION_ID = 'server123';
// The selected runtime artifact is staged for release and e2e lanes, not
// tracked. Without it this proof cannot run; say so instead of failing.
const runtimeStaged = existsSync(resolve(RUNTIME_ROOT, 'artifact', 'lib', 'index.mjs'));
const { RTCPeerConnection } = runtimeStaged ? await loadSelectedSecureWeriftRuntime(RUNTIME_ROOT) : { RTCPeerConnection: undefined };
const LOOPBACK_PEER = {
	iceServers: [],
	iceAdditionalHostAddresses: ['127.0.0.1'],
	iceInterfaceAddresses: { udp4: '127.0.0.1' },
	iceUseIpv4: false,
	iceUseIpv6: false,
	maxMessageSize: 1024 * 1024,
};

function deviceKey() {
	return generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
}

/** A data-blind relay: it never parses transcripts, only routes by type. */
async function startRelay() {
	const http = createServer();
	const server = new WebSocketServer({ server: http, path: '/signal' });
	const state = { pairingHost: undefined, deviceHost: undefined, pairingClient: undefined, deviceClient: undefined, log: [] };
	server.on('connection', (socket) => {
		socket.on('message', (raw) => {
			const message = JSON.parse(String(raw));
			state.log.push(message.type);
			switch (message.type) {
				case 'host-ready':
					state.pairingHost = socket;
					socket.send(JSON.stringify({ type: 'host-registered', roomId: message.roomId }));
					return;
				case 'device-host-ready':
					state.deviceHost = socket;
					socket.send(JSON.stringify({ type: 'device-host-registered', sessionId: message.sessionId }));
					return;
				case 'client-join':
					state.pairingClient = socket;
					state.pairingHost?.send(JSON.stringify(message));
					return;
				case 'answer':
				case 'ice':
					if (socket === state.pairingHost) state.pairingClient?.send(JSON.stringify(message));
					else state.pairingHost?.send(JSON.stringify(message));
					return;
				case 'offer':
					state.pairingClient?.send(JSON.stringify(message));
					return;
				case 'device-join':
					state.deviceClient = socket;
					state.deviceHost?.send(JSON.stringify(message));
					return;
				case 'device-offer':
				case 'device-ice':
					if (socket === state.deviceHost) state.deviceClient?.send(JSON.stringify(message));
					else state.deviceHost?.send(JSON.stringify(message));
					return;
				case 'device-answer':
					state.deviceHost?.send(JSON.stringify(message));
					return;
				default:
					return;
			}
		});
	});
	await new Promise((resolveListen) => http.listen(0, '127.0.0.1', resolveListen));
	const port = http.address().port;
	return {
		port,
		state,
		close: async () => {
			for (const client of server.clients) client.terminate();
			await new Promise((resolveClose) => server.close(() => http.close(resolveClose)));
		},
	};
}

const startedAtAll = Date.now();
function mark(label) { process.stderr.write(`[flow +${Date.now() - startedAtAll}ms] ${label}\n`); }
function waitFor(predicate, label, timeoutMs = 60_000) {
	mark(`wait: ${label}`);
	return new Promise((resolveWait, reject) => {
		const startedAt = Date.now();
		const tick = () => {
			if (predicate()) return resolveWait();
			if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
			setTimeout(tick, 25);
		};
		tick();
	});
}

/** Behave exactly like the browser shell: verify the transcript before setRemoteDescription. */
async function connectClient(relay, options) {
	// A direct endpoint is reached at its own origin over `wss` with its
	// self-signed certificate; the transcript, not TLS, authenticates it.
	const socket = new WebSocket(
		options.signalingUrl ?? `ws://127.0.0.1:${relay.port}/signal`,
		options.socketOptions,
	);
	const sessionId = options.sessionId ?? SESSION_ID;
	await once(socket, 'open');
	const clientNonce = randomBytes(32).toString('base64url');
	const peer = new RTCPeerConnection(LOOPBACK_PEER);
	const channels = new Map();
	peer.addEventListener('datachannel', (event) => channels.set(event.channel.label, event.channel));
	const remoteIce = [];
	let remoteSet = false;
	let offerVerified;
	const rejected = [];
	peer.addEventListener('icecandidate', (event) => {
		const candidate = event.candidate?.toJSON?.() ?? event.candidate;
		if (!candidate?.candidate || socket.readyState !== WebSocket.OPEN) return;
		socket.send(JSON.stringify({
			type: options.mode === 'pairing' ? 'ice' : 'device-ice',
			roomId: options.roomId,
			deviceId: options.deviceId,
			sessionId,
			candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? '0' },
		}));
	});
	socket.on('message', (raw) => {
		void (async () => {
			const message = JSON.parse(String(raw));
			if (message.type === 'offer' || message.type === 'device-offer') {
				const proof = message.authenticatedTransport;
				const sdp = message.sdp.sdp;
				const transcript = await assertAuthenticatedWebRtcTransportTranscript(proof.transcript, {
					scope: options.mode === 'pairing' ? 'pairing' : 'reconnect',
					scopeId: options.mode === 'pairing' ? options.roomId : options.deviceId,
					sessionOrigin: options.sessionOrigin,
					serverId: options.serverId,
					clientNonce,
					sdp,
				});
				if (options.mode === 'pairing') {
					await verifyAuthenticatedWebRtcPairingAuthenticator(options.pairingSecret, transcript, proof.pairingAuthenticator);
				}
				await verifyAuthenticatedWebRtcHostSignature(transcript, proof.hostSignature);
				if (options.pinnedHostKey !== undefined) assert.equal(transcript.hostPublicKey, options.pinnedHostKey);
				offerVerified = transcript;
				await peer.setRemoteDescription({ type: 'offer', sdp });
				remoteSet = true;
				const answer = await peer.createAnswer();
				await peer.setLocalDescription(answer);
				socket.send(JSON.stringify({
					type: options.mode === 'pairing' ? 'answer' : 'device-answer',
					roomId: options.roomId,
					deviceId: options.deviceId,
					sessionId,
					sdp: { type: 'answer', sdp: peer.localDescription.sdp },
				}));
				for (const candidate of remoteIce.splice(0)) await peer.addIceCandidate(candidate);
				return;
			}
			if (message.type === 'ice' || message.type === 'device-ice') {
				if (remoteSet) await peer.addIceCandidate(message.candidate);
				else remoteIce.push(message.candidate);
			}
		})().catch((error) => rejected.push(error));
	});
	socket.send(JSON.stringify({
		authenticatedTransportVersion: 2,
		type: options.mode === 'pairing' ? 'client-join' : 'device-join',
		roomId: options.roomId,
		deviceId: options.deviceId,
		sessionId,
		clientNonce,
		...(options.deviceProof === undefined ? {} : { deviceProof: options.deviceProof(clientNonce) }),
	}));
	const api = {
		clientNonce,
		peer,
		channels,
		rejected,
		socket,
		get transcript() {
			return offerVerified;
		},
		async open() {
			await waitFor(
				() => ['api', 'control', 'application'].every((label) => channels.get(label)?.readyState === 'open'),
				'client data channels to open',
			);
		},
		request(pathname, body) {
			const id = randomBytes(6).toString('hex');
			const channel = channels.get('api');
			return new Promise((resolveRequest, reject) => {
				const listener = (event) => {
					const response = JSON.parse(String(event.data));
					if (response.type !== 'api-response' || response.id !== id) return;
					channel.removeEventListener('message', listener);
					if (response.ok) resolveRequest(response.body);
					else reject(new Error(response.error));
				};
				channel.addEventListener('message', listener);
				channel.send(JSON.stringify({ type: 'api-request', id, pathname, body }));
			});
		},
		nextPush() {
			const channel = channels.get('api');
			return new Promise((resolvePush) => {
				const listener = (event) => {
					const message = JSON.parse(String(event.data));
					if (message.type !== 'enrollment-approved' && message.type !== 'enrollment-denied') return;
					channel.removeEventListener('message', listener);
					resolvePush(parseEnrollmentPushMessage(message));
				};
				channel.addEventListener('message', listener);
			});
		},
		authenticate(ticket) {
			const id = randomBytes(6).toString('hex');
			const channel = channels.get('control');
			return new Promise((resolveAuth) => {
				const listener = (event) => {
					const response = JSON.parse(String(event.data));
					if (response.type !== 'application-authenticated' || response.id !== id) return;
					channel.removeEventListener('message', listener);
					resolveAuth(response.ok);
				};
				channel.addEventListener('message', listener);
				channel.send(JSON.stringify({ type: 'application-auth', id, ticket }));
			});
		},
		close() {
			socket.close();
			try { peer.close(); } catch { /* best effort */ }
		},
	};
	return api;
}

test('a device pairs only after the host approves its match code, and the ticket unlocks host context on that peer only', { skip: runtimeStaged ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`, timeout: 180_000 }, async (t) => {
	const relay = await startRelay();
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({ serverId: 'server-a', sessionOrigin, pairingUrlFormat: 'hosted-compact', cleanupIntervalMs: 0 });
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const connections = [];
	const persisted = [];
	const disconnected = [];
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = { connectionId: `connection-${connections.length + 1}`, closed: false, start: async () => undefined, close: async () => { connection.closed = true; } };
			connections.push(connection);
			return connection;
		},
		handoff,
		hostKey,
		persistDevices: (devices) => persisted.push(devices.length),
		remote: exposure,
		serverId: 'server-a',
		signal: { connectHost: '127.0.0.1' },
		webrtcRuntimeRoot: RUNTIME_ROOT,
		onPeerDisconnected: (connectionId) => disconnected.push(connectionId),
		iceServers: [],
	});
	t.after(async () => {
		await host.close();
		await exposure.shutdown();
		await relay.close();
	});
	const secrets = deriveHostedPairingSecrets(new URL(handoff.pairingUrl).hash.slice(1));
	const key = deviceKey();

	const client = await connectClient(relay, {
		mode: 'pairing',
		roomId: secrets.pairingRoomId,
		pairingSecret: secrets.qrSecret,
		sessionOrigin,
		serverId: 'server-a',
	});
	t.after(() => client.close());
	await client.open();
	mark('client open');
	assert.equal(client.rejected.length, 0);

	// Nothing but device endpoints answer before a ticket is consumed.
	await assert.rejects(client.request('/api/host-context', {}), /authenticated device/u);

	const pendingResponse = parsePendingEnrollmentResponse(await client.request('/api/devices/enroll', {
		deviceName: 'Phone',
		pairingSessionId: handoff.pairingSessionId,
		pairingToken: secrets.pairingToken,
		publicKeyPem: key.publicKey,
	}));
	assert.equal(exposure.devices.list().length, 0, 'enrollment waits for approval');
	const expectedCode = await deriveMatchCode({
		pairingSecret: secrets.qrSecret,
		clientNonce: client.clientNonce,
		hostPublicKey: hostKey.publicKey,
		devicePublicKeyPem: key.publicKey,
	});
	const [pending] = exposure.listPendingApprovals();
	assert.equal(pending.approvalId, pendingResponse.approvalId);
	assert.equal(pending.matchCode, expectedCode, 'host and device derive the same code');
	assert.equal(pending.deviceName, 'Phone');

	// A second device racing the same QR shows a different code and is refused while one is pending.
	await assert.rejects(client.request('/api/devices/enroll', {
		deviceName: 'Impostor', pairingSessionId: handoff.pairingSessionId, pairingToken: secrets.pairingToken, publicKeyPem: deviceKey().publicKey,
	}), /already waiting/u);

	const push = client.nextPush();
	exposure.approveEnrollment(pending.approvalId);
	const approved = await push;
	assert.equal(approved.type, 'enrollment-approved');
	assert.equal(approved.deviceName, 'Phone');
	assert.equal(exposure.devices.list().length, 1);
	assert.deepEqual(persisted, [1]);

	// A browser keeps trickling candidates after its lanes open. The reply to
	// application-auth must not wait behind that signaling work.
	client.socket.send(JSON.stringify({
		candidate: { candidate: 'candidate:9 1 udp 1 127.0.0.1 9 typ host', sdpMid: '0' },
		roomId: secrets.pairingRoomId,
		type: 'ice',
	}));
	// The ticket is bound to this peer; consuming it opens the application and host context.
	const authenticatedAt = Date.now();
	assert.equal(await client.authenticate(approved.ticket), true);
	assert.ok(Date.now() - authenticatedAt < 5_000, 'application auth is answered without waiting on signaling');
	await waitFor(() => connections.length === 1, 'application accepted');
	const context = await client.request('/api/host-context', {});
	assert.equal(context.serverId, 'server-a');
	assert.equal(relay.state.log.includes('client-join'), true);
	assert.equal(JSON.stringify(relay.state.log).includes(expectedCode), false, 'the relay never sees the match code');

	// Reconnect: device-join needs the device key proof; a bogus proof never produces an offer.
	const deviceId = approved.deviceId;
	const offersBefore = relay.state.log.filter((type) => type === 'device-offer').length;
	const bogus = await connectClient(relay, {
		mode: 'device', deviceId, sessionOrigin, serverId: 'server-a', pinnedHostKey: hostKey.publicKey,
		deviceProof: () => randomBytes(256).toString('base64url'),
	});
	t.after(() => bogus.close());
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
	assert.equal(relay.state.log.filter((type) => type === 'device-offer').length, offersBefore, 'no offer for a bad device proof');
	assert.equal(connections[0].closed, false, 'the live peer is untouched by an unauthenticated join');

	// A genuine device-join gets an offer, but the live peer is replaced only after the ticket is consumed.
	const proof = (nonce) => sign('sha256', Buffer.from(deviceJoinProofPayload({ sessionId: SESSION_ID, clientNonce: nonce })), {
		key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
	}).toString('base64url');
	const rejoin = await connectClient(relay, {
		mode: 'device', deviceId, sessionOrigin, serverId: 'server-a', pinnedHostKey: hostKey.publicKey, deviceProof: proof,
	});
	t.after(() => rejoin.close());
	mark('rejoin created');
	await rejoin.open();
	mark('rejoin open');
	assert.equal(rejoin.rejected.length, 0);
	assert.equal(connections[0].closed, false, 'still live while the rejoin is unauthenticated');
	await assert.rejects(rejoin.request('/api/host-context', {}), /authenticated device/u);
	const challenge = await rejoin.request('/api/devices/challenge', { deviceId });
	const signature = sign('sha256', Buffer.from(challenge.signingInput), { key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64url');
	const verified = await rejoin.request('/api/devices/verify', { deviceId, challengeId: challenge.challengeId, deviceSignature: signature });
	// The ticket was issued to the rejoin peer; the old peer cannot use it.
	assert.equal(await client.authenticate(verified.ticket), false);
	const challenge2 = await rejoin.request('/api/devices/challenge', { deviceId });
	const signature2 = sign('sha256', Buffer.from(challenge2.signingInput), { key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64url');
	const verified2 = await rejoin.request('/api/devices/verify', { deviceId, challengeId: challenge2.challengeId, deviceSignature: signature2 });
	assert.equal(await rejoin.authenticate(verified2.ticket), true);
	await waitFor(() => connections.length === 2 && connections[0].closed, 'the previous peer to be replaced after authentication');
	// The retired connection is reported (the channel close and the explicit
	// replacement report may both fire); the replacement never is.
	assert.deepEqual([...new Set(disconnected)], ['connection-1']);
	assert.equal(connections[1].closed, false, 'the replacement stays live');
	const context2 = await rejoin.request('/api/host-context', {});
	assert.equal(context2.serverId, 'server-a');
});

test('the data-root socket mints a fresh pairing room while a live peer keeps working', { skip: runtimeStaged ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`, timeout: 180_000 }, async (t) => {
	const relay = await startRelay();
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-pairing-rotate-'));
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({ serverId: 'server-a', sessionOrigin, pairingUrlFormat: 'hosted-compact', cleanupIntervalMs: 0 });
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const connections = [];
	let sharedHandoff = handoff;
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = { connectionId: `connection-${connections.length + 1}`, closed: false, start: async () => undefined, close: async () => { connection.closed = true; } };
			connections.push(connection);
			return connection;
		},
		handoff,
		hostKey,
		persistDevices: () => undefined,
		remote: exposure,
		serverId: 'server-a',
		signal: { connectHost: '127.0.0.1' },
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
		rotateHandoff: () => {
			sharedHandoff = exposure.rotate();
			return sharedHandoff;
		},
	});

	// The same authority the CLI composes onto the owner-only socket.
	const socketPath = approvalSocketPath(dataRoot);
	const socket = await startApprovalSocket({
		socketPath,
		authority: {
			listPendingApprovals: () => exposure.listPendingApprovals(),
			approveEnrollment: (approvalId) => exposure.approveEnrollment(approvalId),
			denyEnrollment: (approvalId) => exposure.denyEnrollment(approvalId),
			exposureModes: () => ['hosted'],
			pairingHandoffs: async (rotate) => {
				if (rotate) await host.mintPairing();
				return [{
					mode: 'hosted',
					pairingUrl: sharedHandoff.pairingUrl,
					pairingExpiresAt: sharedHandoff.pairingExpiresAt,
					serverId: 'server-a',
				}];
			},
		},
	});
	t.after(async () => {
		await socket.close();
		await host.close();
		await exposure.shutdown();
		await relay.close();
		await rm(dataRoot, { recursive: true, force: true });
	});

	// Pair a device and put it on the application lane.
	const secrets = deriveHostedPairingSecrets(new URL(handoff.pairingUrl).hash.slice(1));
	const key = deviceKey();
	const client = await connectClient(relay, {
		mode: 'pairing', roomId: secrets.pairingRoomId, pairingSecret: secrets.qrSecret, sessionOrigin, serverId: 'server-a',
	});
	t.after(() => client.close());
	await client.open();
	const push = client.nextPush();
	const pendingResponse = parsePendingEnrollmentResponse(await client.request('/api/devices/enroll', {
		deviceName: 'Phone',
		pairingSessionId: handoff.pairingSessionId,
		pairingToken: secrets.pairingToken,
		publicKeyPem: key.publicKey,
	}));
	exposure.approveEnrollment(pendingResponse.approvalId);
	const approved = await push;
	assert.equal(await client.authenticate(approved.ticket), true);
	await waitFor(() => connections.length === 1, 'the application lane to be accepted');
	assert.equal((await client.request('/api/host-context', {})).serverId, 'server-a');

	// A lookup without rotation reports the room the server actually registered.
	const current = await sendApprovalSocketRequest(socketPath, { op: 'pairing' });
	assert.deepEqual(current.exposure, ['hosted']);
	assert.equal(current.handoffs.length, 1);
	assert.equal(current.handoffs[0].mode, 'hosted');
	assert.equal(current.handoffs[0].serverId, 'server-a');

	const rotated = await sendApprovalSocketRequest(socketPath, { op: 'pairing', rotate: true });
	assert.notEqual(rotated.handoffs[0].pairingUrl, current.handoffs[0].pairingUrl);
	assert.notEqual(
		new URL(rotated.handoffs[0].pairingUrl).hash,
		new URL(current.handoffs[0].pairingUrl).hash,
		'a fresh room carries a fresh one-time fragment',
	);
	await waitFor(() => relay.state.log.filter((type) => type === 'host-ready').length >= 2, 'the replacement room to register');

	// The live peer is untouched by the rotation: its lane is still accepted and
	// still answers on the same connection.
	assert.equal(connections.length, 1);
	assert.equal(connections[0].closed, false);
	assert.equal((await client.request('/api/host-context', {})).serverId, 'server-a');

	// And the replacement room is the one a new device would join.
	const replacementSecrets = deriveHostedPairingSecrets(new URL(rotated.handoffs[0].pairingUrl).hash.slice(1));
	assert.notEqual(replacementSecrets.pairingRoomId, secrets.pairingRoomId);
});

test('hosted and direct exposure share one host key and device registry, so a device paired one way reconnects the other',{ skip: runtimeStaged ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`, timeout: 240_000 }, async (t) => {
	const relay = await startRelay();
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-direct-identity-'));
	// The advertised direct origin must be the port the listener actually
	// answers on: the upgrade boundary compares the Host header with it.
	const idle = createServer();
	await new Promise((resolveListen) => idle.listen(0, '127.0.0.1', resolveListen));
	const directPort = idle.address().port;
	await new Promise((resolveClose) => idle.close(resolveClose));
	const directOrigin = `https://127.0.0.1:${directPort}`;
	const directRoom = directSessionId(directOrigin);

	const certificate = await loadOrCreateDirectTlsCertificate(dataRoot, directOrigin);
	const directRelay = createDirectSignalingRelay({
		sessionOrigin: directOrigin,
		managerOrigin: 'https://app.example.test',
	});
	const directListener = createHttpsServer({ cert: certificate.cert, key: certificate.key });
	directListener.on('upgrade', (request, socket, head) =>
		directRelay.handleUpgrade(request, socket, head),
	);
	await new Promise((resolveListen) => directListener.listen(directPort, '127.0.0.1', resolveListen));

	// One exposure, one host key: hosted and direct are two ways to reach the
	// same room on the same server, not two servers.
	const hostedOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({ serverId: 'server-a', sessionOrigin: hostedOrigin, pairingUrlFormat: 'hosted-compact', cleanupIntervalMs: 0 });
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const connections = [];
	const acceptApplication = () => {
		const connection = { connectionId: `connection-${connections.length + 1}`, closed: false, start: async () => undefined, close: async () => { connection.closed = true; } };
		connections.push(connection);
		return connection;
	};
	const common = {
		acceptApplication,
		hostKey,
		persistDevices: () => undefined,
		remote: exposure,
		serverId: 'server-a',
		webrtcRuntimeRoot: RUNTIME_ROOT,
		iceServers: [],
	};
	let hostedHandoff = handoff;
	const hostedHost = await startHostedPairingHost({
		...common,
		handoff,
		rotateHandoff: () => exposure.rotate(),
		onHandoff: (next) => {
			hostedHandoff = next;
		},
		signal: { connectHost: '127.0.0.1' },
	});
	const directPairingUrl = (() => {
		const advertised = new URL(handoff.pairingUrl);
		const url = new URL('/v1/', directOrigin);
		url.hash = advertised.hash;
		return url.toString();
	})();
	const directHost = await startHostedPairingHost({
		...common,
		handoff: { ...handoff, sessionOrigin: directOrigin, pairingUrl: directPairingUrl },
		sessionId: directRoom,
		signal: { connectHost: '127.0.0.1', insecureTls: true },
	});
	t.after(async () => {
		await directHost.close();
		await hostedHost.close();
		await exposure.shutdown();
		await directRelay.close();
		await new Promise((resolveClose) => directListener.close(resolveClose));
		await relay.close();
		await rm(dataRoot, { recursive: true, force: true });
	});

	const secrets = deriveHostedPairingSecrets(new URL(handoff.pairingUrl).hash.slice(1));
	const directSocket = {
		signalingUrl: `wss://127.0.0.1:${directPort}/signal`,
		socketOptions: { rejectUnauthorized: false, headers: { host: `127.0.0.1:${directPort}` } },
		sessionId: directRoom,
	};

	// Pair through the server's own endpoint.
	const key = deviceKey();
	const paired = await connectClient(relay, {
		...directSocket,
		mode: 'pairing',
		roomId: secrets.pairingRoomId,
		pairingSecret: secrets.qrSecret,
		sessionOrigin: directOrigin,
		serverId: 'server-a',
	});
	t.after(() => paired.close());
	await paired.open();
	assert.deepEqual(paired.rejected, []);
	assert.equal(paired.transcript.hostPublicKey, hostKey.publicKey);

	const pendingResponse = parsePendingEnrollmentResponse(await paired.request('/api/devices/enroll', {
		deviceName: 'Direct phone',
		pairingSessionId: handoff.pairingSessionId,
		pairingToken: secrets.pairingToken,
		publicKeyPem: key.publicKey,
	}));
	const [pending] = exposure.listPendingApprovals();
	assert.equal(pending.approvalId, pendingResponse.approvalId);
	assert.equal(
		pending.matchCode,
		await deriveMatchCode({
			pairingSecret: secrets.qrSecret,
			clientNonce: paired.clientNonce,
			hostPublicKey: hostKey.publicKey,
			devicePublicKeyPem: key.publicKey,
		}),
	);
	const push = paired.nextPush();
	exposure.approveEnrollment(pending.approvalId);
	const approved = await push;
	assert.equal(approved.type, 'enrollment-approved');
	const deviceId = approved.deviceId;
	assert.equal(exposure.devices.list().length, 1);

	// The same device reconnects through the hosted relay. It pins the host key
	// it saw over the direct endpoint, and never pairs again.
	const hostedProof = (nonce) => sign('sha256', Buffer.from(deviceJoinProofPayload({ sessionId: SESSION_ID, clientNonce: nonce })), {
		key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
	}).toString('base64url');
	const viaHosted = await connectClient(relay, {
		mode: 'device', deviceId, sessionOrigin: hostedOrigin, serverId: 'server-a',
		pinnedHostKey: hostKey.publicKey, deviceProof: hostedProof,
	});
	t.after(() => viaHosted.close());
	await viaHosted.open();
	assert.deepEqual(viaHosted.rejected, []);
	const hostedChallenge = await viaHosted.request('/api/devices/challenge', { deviceId });
	const hostedSignature = sign('sha256', Buffer.from(hostedChallenge.signingInput), { key: key.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64url');
	const hostedTicket = await viaHosted.request('/api/devices/verify', { deviceId, challengeId: hostedChallenge.challengeId, deviceSignature: hostedSignature });
	assert.equal(await viaHosted.authenticate(hostedTicket.ticket), true);
	assert.equal(exposure.devices.list().length, 1, 'reconnecting the other way enrolls nothing new');

	// The reverse: a device paired through the hosted relay reconnects through
	// the direct endpoint on the same registration.
	await hostedHost.mintPairing();
	const rotated = hostedHandoff;
	assert.notEqual(rotated.pairingSessionId, handoff.pairingSessionId);
	const rotatedSecrets = deriveHostedPairingSecrets(new URL(rotated.pairingUrl).hash.slice(1));
	await waitFor(() => relay.state.log.filter((type) => type === 'host-ready').length >= 2, 'the rotated room to register');
	const secondKey = deviceKey();
	const viaHostedPairing = await connectClient(relay, {
		mode: 'pairing',
		roomId: rotatedSecrets.pairingRoomId,
		pairingSecret: rotatedSecrets.qrSecret,
		sessionOrigin: hostedOrigin,
		serverId: 'server-a',
	});
	t.after(() => viaHostedPairing.close());
	await viaHostedPairing.open();
	const secondPending = parsePendingEnrollmentResponse(await viaHostedPairing.request('/api/devices/enroll', {
		deviceName: 'Hosted phone',
		pairingSessionId: rotated.pairingSessionId,
		pairingToken: rotatedSecrets.pairingToken,
		publicKeyPem: secondKey.publicKey,
	}));
	const secondPush = viaHostedPairing.nextPush();
	exposure.approveEnrollment(secondPending.approvalId);
	const secondApproved = await secondPush;
	const secondDeviceId = secondApproved.deviceId;
	assert.equal(exposure.devices.list().length, 2);

	const directProof = (nonce) => sign('sha256', Buffer.from(deviceJoinProofPayload({ sessionId: directRoom, clientNonce: nonce })), {
		key: secondKey.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
	}).toString('base64url');
	const viaDirect = await connectClient(relay, {
		...directSocket,
		mode: 'device', deviceId: secondDeviceId, sessionOrigin: directOrigin, serverId: 'server-a',
		pinnedHostKey: hostKey.publicKey, deviceProof: directProof,
	});
	t.after(() => viaDirect.close());
	await viaDirect.open();
	assert.deepEqual(viaDirect.rejected, []);
	const directChallenge = await viaDirect.request('/api/devices/challenge', { deviceId: secondDeviceId });
	const directSignature = sign('sha256', Buffer.from(directChallenge.signingInput), { key: secondKey.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64url');
	const directTicket = await viaDirect.request('/api/devices/verify', { deviceId: secondDeviceId, challengeId: directChallenge.challengeId, deviceSignature: directSignature });
	assert.equal(await viaDirect.authenticate(directTicket.ticket), true);
	assert.equal(exposure.devices.list().length, 2, 'no device paired twice');
});

test('a standalone server started with --expose hosted registers its rooms before readiness',{ skip: runtimeStaged ? false : `selected WebRTC runtime is not staged at ${RUNTIME_ROOT}`, timeout: 120_000 }, async (t) => {
	const relay = await startRelay();
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-expose-hosted-'));
	t.after(async () => {
		await relay.close();
		await rm(dataRoot, { recursive: true, force: true });
	});

	const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
	const child = spawn(
		process.execPath,
		[
			cli,
			'--data-root', dataRoot,
			'--project-root', dataRoot,
			'--server-id', 'exposed-server',
			'--endpoint', 'disabled',
			'--expose', 'hosted',
			'--hosted-domain', `localhost:${relay.port}`,
		],
		{
			env: {
				...process.env,
				TERMINAY_SIGNAL_CONNECT_HOST: '127.0.0.1',
				TERMINAY_WEBRTC_RUNTIME_ROOT: RUNTIME_ROOT,
				TERMINAY_AGENT_INTEGRATION: 'disabled',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	t.after(async () => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		child.kill('SIGTERM');
		await once(child, 'exit');
	});

	const readiness = await readFirstJsonLine(child);
	assert.equal(readiness.ready, true);
	assert.equal(readiness.serverId, 'exposed-server');

	// Both rooms must already be registered with the relay by the time readiness
	// advertises a pairing URL: the pairing room a device joins, and the signed
	// reconnect host a saved device joins.
	assert.ok(relay.state.log.includes('host-ready'), 'the pairing room must be registered before readiness');
	assert.ok(relay.state.log.includes('device-host-ready'), 'the reconnect host must be registered before readiness');

	// The advertised handoff is a hosted-compact link under the persisted
	// session origin, not the unroutable per-server placeholder.
	const pairingUrl = new URL(readiness.pairing.pairingUrl);
	const sessionOrigin = new URL(
		JSON.parse(await readFile(join(dataRoot, 'remote-session-origin.v1.json'), 'utf8')).origin,
	);
	assert.match(sessionOrigin.host, new RegExp(`^[a-f0-9]{32}\\.localhost:${relay.port}$`, 'u'));
	assert.equal(pairingUrl.searchParams.get('s'), sessionOrigin.hostname.split('.')[0]);
	assert.ok(pairingUrl.hash.length > 1, 'the pairing secret stays in the fragment');
	assert.equal(pairingUrl.search.includes(pairingUrl.hash.slice(1)), false);
});

function readFirstJsonLine(child) {
	return new Promise((resolveLine, reject) => {
		let output = '';
		let errors = '';
		const timeout = setTimeout(() => reject(new Error(`server did not become ready: ${output}${errors}`)), 60_000);
		const onExit = (code) => {
			clearTimeout(timeout);
			reject(new Error(`server exited before readiness (${code}): ${output}${errors}`));
		};
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk) => { errors += chunk; });
		child.once('exit', onExit);
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			output += chunk;
			const lineEnd = output.indexOf('\n');
			if (lineEnd === -1) return;
			clearTimeout(timeout);
			child.off('exit', onExit);
			try {
				resolveLine(JSON.parse(output.slice(0, lineEnd)));
			} catch (error) {
				reject(error);
			}
		});
	});
}
