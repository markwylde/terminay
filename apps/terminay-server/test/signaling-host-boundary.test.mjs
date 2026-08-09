import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptSessionSignalingUpgrade } from '../dist/index.js';

const options = {
	managerOrigin: 'https://app.terminay.com',
	sessionOrigin: 'https://session-123.terminay.com',
};

test('only the isolated session host can accept the signaling WebSocket upgrade', () => {
	assert.deepEqual(
		acceptSessionSignalingUpgrade(
			{ host: 'SESSION-123.TERMINAY.COM', upgrade: 'WebSocket', url: '/signal' },
			options,
		),
		{ sessionOrigin: options.sessionOrigin, signalingPath: '/signal' },
	);
});

test('manager-only hosts and untrusted host routing cannot become signaling endpoints', () => {
	for (const request of [
		{ host: 'app.terminay.com', upgrade: 'websocket', url: '/signal' },
		{ host: 'attacker.example.test', upgrade: 'websocket', url: '/signal' },
		{ host: 'session-123.terminay.com', upgrade: 'websocket', url: '/other' },
		{ host: 'session-123.terminay.com', upgrade: 'h2c', url: '/signal' },
	]) {
		assert.throws(() => acceptSessionSignalingUpgrade(request, options));
	}
});

test('ambiguous or non-canonical Host framing cannot be normalized into a session relay', () => {
	for (const host of [
		' session-123.terminay.com',
		'session-123.terminay.com ',
		'session-123.terminay.com, attacker.example.test',
		'session-123.terminay.com\t',
		'session-123.terminay.com\u0000',
	]) {
		assert.throws(
			() => acceptSessionSignalingUpgrade({ host, upgrade: 'websocket', url: '/signal' }, options),
			/signaling upgrade host is invalid/,
		);
	}
});

test('the boundary refuses an unsafe configuration that collapses manager and session hosts', () => {
	assert.throws(
		() =>
			acceptSessionSignalingUpgrade(
				{ host: 'app.terminay.com', upgrade: 'websocket', url: '/signal' },
				{ managerOrigin: 'https://app.terminay.com', sessionOrigin: 'https://app.terminay.com' },
			),
		/manager and session origins must be distinct/,
	);
});
