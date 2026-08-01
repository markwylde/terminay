import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(tmpdir(), 'terminay-desktop-reconnect-enrollment-'),
);
const output = join(directory, 'desktopReconnectEnrollment.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/desktopReconnectEnrollment.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { enrollDesktopReconnectCredential } = await import(
	pathToFileURL(output).href
);
test.after(async () => {
	await rm(directory, { force: true, recursive: true });
});

test('Desktop enrolls a one-time standalone token into durable reconnect storage', async () => {
	const saved = [];
	const calls = [];
	const store = {
		createDeviceKey(origin) {
			assert.equal(origin, 'http://localhost:4317');
			return {
				keyRef: Object.freeze({ keyId: 'key-a' }),
				publicKeyPem: 'public-key-a',
			};
		},
		async saveEstablishedPairing(value) {
			saved.push(value);
		},
	};

	await enrollDesktopReconnectCredential({
		authToken: 'standalone-token-1234567890',
		clientId: 'desktop-profile-reconnect-a',
		deviceName: 'Terminay Desktop',
		fetch: async (url, init) => {
			calls.push([url, init]);
			assert.equal(
				init.headers.authorization,
				'Bearer standalone-token-1234567890',
			);
			assert.deepEqual(JSON.parse(init.body), {
				clientId: 'desktop-profile-reconnect-a',
			});
			return {
				ok: true,
				json: async () => ({
					grant: 'g'.repeat(43),
					handle: 'h'.repeat(43),
					signingOrigin: 'http://localhost:4317',
				}),
			};
		},
		now: () => new Date('2030-01-01T00:00:00.000Z'),
		origin: 'http://localhost:4317',
		store,
	});

	assert.deepEqual(
		calls.map(([url]) => url),
		['http://localhost:4317/protocol/reconnect/enroll'],
	);
	assert.equal(saved.length, 1);
	assert.deepEqual(saved[0].pairing, {
		deviceId: 'desktop-profile-reconnect-a',
		deviceName: 'Terminay Desktop',
		origin: 'http://localhost:4317',
		privateKey: { keyId: 'key-a' },
		publicKeyPem: 'public-key-a',
	});
	assert.deepEqual(saved[0].reconnectGrant, {
		expiresAt: null,
		grant: 'g'.repeat(43),
		handle: 'h'.repeat(43),
		issuedAt: '2030-01-01T00:00:00.000Z',
		origin: 'http://localhost:4317',
		protocolVersion: 'v1',
		sessionId: 'http://localhost:4317',
	});
});

test('Desktop reconnect enrollment rejects denied or malformed server responses without persisting', async () => {
	let writes = 0;
	const store = {
		createDeviceKey() {
			throw new Error('must not create a key');
		},
		async saveEstablishedPairing() {
			writes += 1;
		},
	};
	await assert.rejects(
		() =>
			enrollDesktopReconnectCredential({
				authToken: 'standalone-token-1234567890',
				clientId: 'desktop-profile-reconnect-a',
				deviceName: 'Terminay Desktop',
				fetch: async () => ({ ok: false, json: async () => ({}) }),
				origin: 'https://server.example',
				store,
			}),
		/denied/u,
	);
	await assert.rejects(
		() =>
			enrollDesktopReconnectCredential({
				authToken: 'standalone-token-1234567890',
				clientId: 'desktop-profile-reconnect-a',
				deviceName: 'Terminay Desktop',
				fetch: async () => ({
					ok: true,
					json: async () => ({ handle: 'short', grant: 'g'.repeat(43) }),
				}),
				origin: 'https://server.example',
				store,
			}),
		/invalid grant/u,
	);
	assert.equal(writes, 0);
});
