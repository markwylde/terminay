import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
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

const RUNTIME_ROOT = resolve(process.cwd(), 'build/webrtc-runtime');
const SESSION_ID = 'server123';
const { RTCPeerConnection } = await loadSelectedSecureWeriftRuntime(RUNTIME_ROOT);
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
	const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/signal`);
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
			sessionId: SESSION_ID,
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
					sessionId: SESSION_ID,
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
		sessionId: SESSION_ID,
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

test('a device pairs only after the host approves its match code, and the ticket unlocks host context on that peer only', { timeout: 180_000 }, async (t) => {
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

	// The ticket is bound to this peer; consuming it opens the application and host context.
	assert.equal(await client.authenticate(approved.ticket), true);
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
