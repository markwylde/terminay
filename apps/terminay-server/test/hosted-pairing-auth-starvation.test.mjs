import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { deriveMatchCode } from '@terminay/protocol';
import { WebSocketServer } from 'ws';
import { createHostedHostKey } from '../dist/remote/hostedHostKey.js';
import { startHostedPairingHost } from '../dist/remote/hostedPairingHost.js';
import { deriveHostedPairingSecrets } from '../dist/remote/hostedPairingSecrets.js';
import { createServerRemoteExposure } from '../dist/remote/serverExposure.js';

/**
 * Application authentication must never wait on handshake signaling.
 *
 * The fake runtime's `addIceCandidate` never settles, which is what a real
 * trickle candidate arriving after DTLS is up can look like. With the reply
 * queued behind that work the client times out after 15 s and reports
 * "Terminay did not authenticate the workspace in time". Here a reply queued
 * behind it never arrives at all, however long the machine takes: the tests
 * wait for the reply itself, never for a time budget.
 */

const SESSION_ID = 'session123';

function deviceKey() {
	return generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
}

/** Minimal in-memory data channel with the surface the host uses. */
function fakeChannel(label, changed) {
	const listeners = new Map();
	return {
		label,
		readyState: 'open',
		bufferedAmount: 0,
		sent: [],
		addEventListener(type, listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(listener);
			if (type === 'open') listener({});
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		close() {
			this.readyState = 'closed';
			for (const listener of listeners.get('close') ?? []) listener({});
		},
		send(data) {
			this.sent.push(String(data));
			changed();
		},
		/** Deliver a client frame to the host's listeners for this lane. */
		receive(value) {
			for (const listener of listeners.get('message') ?? [])
				listener({ data: value });
		},
	};
}

function fakeRuntime(state) {
	return {
		RTCPeerConnection: class FakePeer {
			constructor() {
				this.connectionState = 'connected';
				this.iceConnectionState = 'connected';
				this.localDescription = { sdp: 'v=0\r\n', type: 'offer' };
				this.channels = new Map();
				state.peers.push(this);
			}
			addEventListener() {}
			// Never settles: the host must not make anything a client waits on
			// depend on this promise.
			addIceCandidate() {
				state.iceCalls += 1;
				state.changed();
				return new Promise(() => {});
			}
			close() {}
			createDataChannel(label) {
				const channel = fakeChannel(label, state.changed);
				this.channels.set(label, channel);
				state.channels.set(label, channel);
				state.changed();
				return channel;
			}
			async createOffer() {
				return {
					sdp: `v=0\r\na=fingerprint:sha-256 ${'AA:'.repeat(31)}AA\r\n`,
					type: 'offer',
				};
			}
			async setLocalDescription() {}
			async setRemoteDescription() {}
		},
	};
}

/** Route frames by type; the client half lives in the test. */
async function startRelay(state) {
	const http = createServer();
	const server = new WebSocketServer({ server: http, path: '/signal' });
	server.on('connection', (socket) => {
		socket.on('message', (raw) => {
			const message = JSON.parse(String(raw));
			if (message.type === 'host-ready') {
				state.pairingHost = socket;
				socket.send(
					JSON.stringify({ roomId: message.roomId, type: 'host-registered' }),
				);
				return;
			}
			if (message.type === 'device-host-ready') {
				socket.send(
					JSON.stringify({
						sessionId: message.sessionId,
						type: 'device-host-registered',
					}),
				);
				return;
			}
			state.hostSignals.push(message);
		});
	});
	await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
	return {
		port: http.address().port,
		send: (message) => state.pairingHost?.send(JSON.stringify(message)),
		close: async () => {
			for (const client of server.clients) client.terminate();
			await new Promise((resolve) => server.close(() => http.close(resolve)));
		},
	};
}

/**
 * Resolves with what `predicate` returns once it is truthy, re-checked on every
 * change the fakes and the exposure report.
 */
function until(state, predicate) {
	return new Promise((resolveWait) => {
		const check = () => {
			const value = predicate();
			if (!value) return;
			state.checks.delete(check);
			resolveWait(value);
		};
		state.checks.add(check);
		check();
	});
}

function lastReply(channel, id) {
	return channel.sent
		.map((frame) => JSON.parse(frame))
		.find(
			(message) =>
				message.type === 'application-authenticated' && message.id === id,
		);
}

async function startHost(t, overrides = {}) {
	const state = {
		channels: new Map(),
		checks: new Set(),
		changed: () => {
			for (const check of [...state.checks]) check();
		},
		hostSignals: [],
		iceCalls: 0,
		peers: [],
		pairingHost: undefined,
	};
	const relay = await startRelay(state);
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin,
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const handoff = exposure.start();
	exposure.onApprovalRequested(() => state.changed());
	const hostKey = createHostedHostKey();
	const accepted = [];
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = {
				connectionId: `connection-${accepted.length + 1}`,
				closed: false,
				start: async () => undefined,
				close: async () => {
					connection.closed = true;
				},
			};
			accepted.push(connection);
			state.changed();
			return connection;
		},
		handoff,
		hostKey,
		loadRuntime: async () => fakeRuntime(state),
		persistDevices: () => undefined,
		remote: exposure,
		serverId: 'server-a',
		signal: { connectHost: '127.0.0.1' },
		webrtcRuntimeRoot: '/unused-by-the-fake-runtime',
		iceServers: [],
		...overrides,
	});
	t.after(async () => {
		await host.close();
		await exposure.shutdown();
		await relay.close();
	});
	const secrets = deriveHostedPairingSecrets(
		new URL(handoff.pairingUrl).hash.slice(1),
	);
	return { accepted, exposure, handoff, host, hostKey, relay, secrets, state };
}

/** Join, enroll, get approved, and return the peer's consumed-once ticket. */
async function approvedTicket(context, clientNonce, beforeApproval) {
	const { exposure, handoff, relay, secrets, state } = context;
	relay.send({
		authenticatedTransportVersion: 2,
		clientNonce,
		roomId: secrets.pairingRoomId,
		type: 'client-join',
	});
	const api = await until(state, () => state.channels.get('api'));
	const control = await until(state, () => state.channels.get('control'));
	const key = deviceKey();
	api.receive(
		JSON.stringify({
			body: {
				deviceName: 'Phone',
				pairingSessionId: handoff.pairingSessionId,
				pairingToken: secrets.pairingToken,
				publicKeyPem: key.publicKey,
			},
			id: 'enroll-1',
			pathname: '/api/devices/enroll',
			type: 'api-request',
		}),
	);
	const pending = await until(state, () => exposure.listPendingApprovals()[0]);
	assert.equal(
		pending.matchCode,
		await deriveMatchCode({
			clientNonce,
			devicePublicKeyPem: key.publicKey,
			hostPublicKey: context.hostKey.publicKey,
			pairingSecret: secrets.qrSecret,
		}),
	);
	await beforeApproval?.();
	const approved = exposure.approveEnrollment(pending.approvalId);
	return { api, control, ticket: approved.ticket };
}

test('application authentication is answered while an ICE candidate never settles', async (t) => {
	const context = await startHost(t);
	const clientNonce = Buffer.alloc(32, 0x55).toString('base64url');
	// A client may still be trickling when approval consumes and rotates its
	// one-time room. Start the stalled candidate while that signaling room is
	// live, then prove auth does not queue behind it after approval.
	const { control, ticket } = await approvedTicket(
		context,
		clientNonce,
		async () => {
			context.relay.send({
				candidate: {
					candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host',
					sdpMid: '0',
				},
				roomId: context.secrets.pairingRoomId,
				type: 'ice',
			});
			await until(context.state, () => context.state.iceCalls > 0);
		},
	);
	control.receive(
		JSON.stringify({ id: 'auth-1', ticket, type: 'application-auth' }),
	);

	const reply = await until(context.state, () => lastReply(control, 'auth-1'));
	assert.equal(reply.ok, true);
	await until(context.state, () => context.accepted.length === 1);
});

test('a stalled handshake in a fresh pairing room does not delay another peer authentication', async (t) => {
	const context = await startHost(t);
	const clientNonce = Buffer.alloc(32, 0x55).toString('base64url');
	const { control, ticket } = await approvedTicket(context, clientNonce);

	// Pairing consumes the previous room. Use the newly advertised room for a
	// second peer so this continues to exercise cross-peer ICE starvation rather
	// than attempting to rejoin a used link.
	await context.host.mintPairing();
	const handoff = context.exposure.pairingHandoff;
	assert.ok(handoff);
	const secrets = deriveHostedPairingSecrets(
		new URL(handoff.pairingUrl).hash.slice(1),
	);
	context.relay.send({
		authenticatedTransportVersion: 2,
		clientNonce: Buffer.alloc(32, 0x66).toString('base64url'),
		roomId: secrets.pairingRoomId,
		type: 'client-join',
	});
	context.relay.send({
		candidate: {
			candidate: 'candidate:2 1 udp 1 127.0.0.1 2 typ host',
			sdpMid: '0',
		},
		roomId: secrets.pairingRoomId,
		type: 'ice',
	});
	await until(context.state, () => context.state.iceCalls > 0);

	control.receive(
		JSON.stringify({
			id: 'auth-other-peer-stalled',
			ticket,
			type: 'application-auth',
		}),
	);
	const reply = await until(context.state, () =>
		lastReply(control, 'auth-other-peer-stalled'),
	);
	assert.equal(reply.ok, true);
});
