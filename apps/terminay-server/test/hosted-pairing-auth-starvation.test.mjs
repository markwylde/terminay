import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { deriveMatchCode } from '@terminay/protocol';
import { createHostedHostKey } from '../dist/remote/hostedHostKey.js';
import { deriveHostedPairingSecrets } from '../dist/remote/hostedPairingSecrets.js';
import { startHostedPairingHost } from '../dist/remote/hostedPairingHost.js';
import { createServerRemoteExposure } from '../dist/remote/serverExposure.js';

/**
 * Application authentication must never wait on handshake signaling.
 *
 * The fake runtime's `addIceCandidate` never settles, which is what a real
 * trickle candidate arriving after DTLS is up can look like. With the reply
 * queued behind that work the client times out after 15 s and reports
 * "Terminay did not authenticate the workspace in time"; the assertions here
 * use a 2 s budget so the starvation is a fast, deterministic failure.
 */

const SESSION_ID = 'session123';
const REPLY_BUDGET_MS = 2_000;

function deviceKey() {
	return generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
}

/** Minimal in-memory data channel with the surface the host uses. */
function fakeChannel(label) {
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
		},
		/** Deliver a client frame to the host's listeners for this lane. */
		receive(value) {
			for (const listener of listeners.get('message') ?? []) listener({ data: value });
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
				return new Promise(() => {});
			}
			close() {}
			createDataChannel(label) {
				const channel = fakeChannel(label);
				this.channels.set(label, channel);
				state.channels.set(label, channel);
				return channel;
			}
			async createOffer() {
				return { sdp: `v=0\r\na=fingerprint:sha-256 ${'AA:'.repeat(31)}AA\r\n`, type: 'offer' };
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
				socket.send(JSON.stringify({ roomId: message.roomId, type: 'host-registered' }));
				return;
			}
			if (message.type === 'device-host-ready') {
				socket.send(JSON.stringify({ sessionId: message.sessionId, type: 'device-host-registered' }));
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

function waitFor(predicate, label, timeoutMs = 10_000) {
	return new Promise((resolveWait, reject) => {
		const startedAt = Date.now();
		const tick = () => {
			const value = predicate();
			if (value) return resolveWait(value);
			if (Date.now() - startedAt > timeoutMs) return reject(new Error(`timed out waiting for ${label}`));
			setTimeout(tick, 10);
		};
		tick();
	});
}

function lastReply(channel, id) {
	return channel.sent
		.map((frame) => JSON.parse(frame))
		.find((message) => message.type === 'application-authenticated' && message.id === id);
}

async function startHost(t, overrides = {}) {
	const state = { channels: new Map(), hostSignals: [], iceCalls: 0, peers: [], pairingHost: undefined };
	const relay = await startRelay(state);
	const sessionOrigin = `http://${SESSION_ID}.localhost:${relay.port}`;
	const exposure = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin,
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});
	const handoff = exposure.start();
	const hostKey = createHostedHostKey();
	const accepted = [];
	const host = await startHostedPairingHost({
		acceptApplication: () => {
			const connection = {
				connectionId: `connection-${accepted.length + 1}`,
				closed: false,
				start: async () => undefined,
				close: async () => { connection.closed = true; },
			};
			accepted.push(connection);
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
	const secrets = deriveHostedPairingSecrets(new URL(handoff.pairingUrl).hash.slice(1));
	return { accepted, exposure, handoff, host, hostKey, relay, secrets, state };
}

/** Join, enroll, get approved, and return the peer's consumed-once ticket. */
async function approvedTicket(context, clientNonce) {
	const { exposure, handoff, relay, secrets, state } = context;
	relay.send({ authenticatedTransportVersion: 2, clientNonce, roomId: secrets.pairingRoomId, type: 'client-join' });
	const api = await waitFor(() => state.channels.get('api'), 'the api lane');
	const control = await waitFor(() => state.channels.get('control'), 'the control lane');
	const key = deviceKey();
	api.receive(JSON.stringify({
		body: {
			deviceName: 'Phone',
			pairingSessionId: handoff.pairingSessionId,
			pairingToken: secrets.pairingToken,
			publicKeyPem: key.publicKey,
		},
		id: 'enroll-1',
		pathname: '/api/devices/enroll',
		type: 'api-request',
	}));
	const pending = await waitFor(() => exposure.listPendingApprovals()[0], 'the pending approval');
	assert.equal(pending.matchCode, await deriveMatchCode({
		clientNonce,
		devicePublicKeyPem: key.publicKey,
		hostPublicKey: context.hostKey.publicKey,
		pairingSecret: secrets.qrSecret,
	}));
	const approved = exposure.approveEnrollment(pending.approvalId);
	return { api, control, ticket: approved.ticket };
}

test('application authentication is answered while an ICE candidate never settles', async (t) => {
	const context = await startHost(t);
	const clientNonce = Buffer.alloc(32, 0x55).toString('base64url');
	const { control, ticket } = await approvedTicket(context, clientNonce);

	// The client keeps trickling after its lanes opened, exactly as a browser
	// does, and then authenticates.
	context.relay.send({ candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host', sdpMid: '0' }, roomId: context.secrets.pairingRoomId, type: 'ice' });
	await waitFor(() => context.state.iceCalls > 0, 'the host to start applying the candidate');
	control.receive(JSON.stringify({ id: 'auth-1', ticket, type: 'application-auth' }));

	const reply = await waitFor(() => lastReply(control, 'auth-1'), 'the application-authenticated reply', REPLY_BUDGET_MS);
	assert.equal(reply.ok, true);
	await waitFor(() => context.accepted.length === 1, 'the workspace to attach', REPLY_BUDGET_MS);
});

test('a stalled handshake for another peer does not delay authentication', async (t) => {
	const context = await startHost(t);
	const firstNonce = Buffer.alloc(32, 0x55).toString('base64url');
	const { control, ticket } = await approvedTicket(context, firstNonce);

	// A second join starts a fresh handshake, and its candidate never settles.
	context.relay.send({ authenticatedTransportVersion: 2, clientNonce: Buffer.alloc(32, 0x66).toString('base64url'), roomId: context.secrets.pairingRoomId, type: 'client-join' });
	context.relay.send({ candidate: { candidate: 'candidate:2 1 udp 1 127.0.0.1 2 typ host', sdpMid: '0' }, roomId: context.secrets.pairingRoomId, type: 'ice' });
	await waitFor(() => context.state.iceCalls > 0, 'the host to start applying the candidate');

	control.receive(JSON.stringify({ id: 'auth-2', ticket, type: 'application-auth' }));
	const reply = await waitFor(() => lastReply(control, 'auth-2'), 'the application-authenticated reply', REPLY_BUDGET_MS);
	assert.equal(reply.ok, true);
});
