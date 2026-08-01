import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHostedDesktopSignaling } from '../dist/remote/hostedSignalingRegistrar.js';

const NOW = 1_000_000;
const request = Object.freeze({
	serverId: 'server-a',
	deviceId: 'device-a',
	peerId: 'peer-a',
	sessionOrigin: 'https://session.example',
	expiresAt: NOW + 60_000,
});

const valid = () => ({
	schemaVersion: 1,
	protocolVersion: 'v1',
	role: 'offerer',
	serverId: request.serverId,
	deviceId: request.deviceId,
	peerId: request.peerId,
	sessionOrigin: request.sessionOrigin,
	signalingUrl: 'wss://session.example/signal',
	signalingAuthToken: 'hosted_signaling_token_123456',
	expiresAt: NOW + 30_000,
	iceServers: [{ urls: ['stun:stun.example:3478'] }],
});

test('accepts only a hosted-minted bootstrap bound to reconnect admission', async () => {
	let received;
	const bootstrap = await registerHostedDesktopSignaling(
		{
			register: (candidate) => {
				received = candidate;
				return valid();
			},
		},
		request,
		{ now: () => NOW },
	);
	assert.deepEqual(received, request);
	assert.equal(Object.isFrozen(received), true);
	assert.equal(bootstrap.signalingUrl, 'wss://session.example/signal');
});

test('rejects identity, origin, expiry, credential, and cancellation mismatches', async () => {
	for (const candidate of [
		{ ...valid(), serverId: 'server-b' },
		{ ...valid(), deviceId: 'device-b' },
		{ ...valid(), peerId: 'peer-b' },
		{ ...valid(), sessionOrigin: 'https://other.example' },
		{ ...valid(), expiresAt: request.expiresAt + 1 },
		{ ...valid(), signalingAuthToken: 'short' },
		{ ...valid(), signalingUrl: 'wss://session.example/signaling' },
	]) {
		await assert.rejects(() =>
			registerHostedDesktopSignaling({ register: () => candidate }, request, {
				now: () => NOW,
			}),
		);
	}
	const controller = new AbortController();
	controller.abort(new Error('revoked'));
	let calls = 0;
	await assert.rejects(
		() =>
			registerHostedDesktopSignaling(
				{
					register: () => {
						calls += 1;
						return valid();
					},
				},
				request,
				{ now: () => NOW, signal: controller.signal },
			),
		/revoked/u,
	);
	assert.equal(calls, 0);
});
