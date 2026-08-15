import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-session-host-'));
const output = join(directory, 'contract.mjs');
await build({ bundle: true, entryPoints: ['src/web/sessionTransportHost.ts'], format: 'esm', outfile: output, platform: 'browser' });
const contract = await import(output);
test.after(async () => rm(directory, { force: true, recursive: true }));

function endpoint() {
	return {
		bufferedBytes: 0,
		close: async () => {},
		incoming: { async *[Symbol.asyncIterator]() {} },
		onStateChange: () => () => {},
		open: async () => {},
		queuedBytes: 0,
		send: async () => {},
		state: 'open',
		waitForWritable: async () => {},
	};
}

function install(overrides = {}) {
	globalThis.window = {
		location: { origin: 'https://room.terminay.com' },
		__TERMINAY_SESSION_TRANSPORT__: {
			version: 1,
			sessionId: 'room',
			origin: 'https://room.terminay.com',
			prepareWorkspace: async () => ({}),
			postJson: async () => ({}),
			acquireApplicationEndpoint: async () => ({ generation: 2, endpoint: endpoint() }),
			registerApplication() {},
			connect: async () => endpoint(),
			enroll: async () => ({}),
			...overrides,
		},
	};
}

test('accepts and returns only a runtime-validated opaque endpoint', async () => {
	install();
	const transport = await contract.acquireHostedApplicationTransport('ticket');
	assert.equal(transport.state, 'open');
	assert.equal('channel' in transport, false);
});

test('production bootstrap installs one immutable host from the narrow hosted authority', async () => {
	const byteEndpoint = { send: async () => {}, subscribe: () => () => {} };
	globalThis.window = {
		location: { origin: 'https://room.terminay.com' },
		__TERMINAY_HOSTED_SESSION_AUTHORITY__: {
			serverId: 'server-a',
			hostContext: { serverId: 'server-a' },
			readBundle: async () => new Uint8Array([1, 2, 3]),
			byteEndpoint,
			sessionId: 'room',
			origin: 'https://room.terminay.com',
			postJson: async () => ({}),
			acquireApplicationEndpoint: async () => ({ generation: 1, endpoint: endpoint() }),
			registerApplication() {},
			connect: async () => endpoint(),
			enroll: async () => ({}),
		},
	};
	const host = contract.bootstrapHostedBrowserSession();
	assert.equal(host, globalThis.window.__TERMINAY_SESSION_TRANSPORT__);
	assert.equal(Object.isFrozen(host), true);
	const prepared = await host.prepareWorkspace();
	assert.equal(prepared.expectedServerId, 'server-a');
	assert.deepEqual([...prepared.compressedArchive], [1, 2, 3]);
	assert.throws(() => { globalThis.window.__TERMINAY_SESSION_TRANSPORT__ = {}; }, /read only|assign/u);
});

test('rejects incompatible versions, origins, generations, and endpoint shapes', async () => {
	for (const overrides of [
		{ version: 2 },
		{ origin: 'https://sibling.terminay.com' },
		{ acquireApplicationEndpoint: async () => ({ generation: 0, endpoint: endpoint() }) },
		{ acquireApplicationEndpoint: async () => ({ generation: 1, endpoint: { send() {} } }) },
	]) {
		install(overrides);
		await assert.rejects(contract.acquireHostedApplicationTransport('ticket'), /incompatible/u);
	}
});

test('production sources contain no retired raw-channel globals or adapter', async () => {
	const sources = await Promise.all([
		readFile('src/remote/main.tsx', 'utf8'),
		readFile('src/remote/services/transport.ts', 'utf8'),
		readFile('src/web/main.tsx', 'utf8'),
		readFile('src/web/sessionTransportHost.ts', 'utf8'),
	]);
	for (const source of sources) {
		assert.doesNotMatch(source, /__TERMINAY_REMOTE_WEBRTC__|__TERMINAY_BROWSER_ENROLLMENT__|getChannel|RTCDataChannel/u);
	}
});

test('remote production entry consumes hosted authority before workspace preparation without reloading', async () => {
	const source = await readFile('src/remote/main.tsx', 'utf8');
	assert.match(source, /const sessionHost = bootstrapHostedBrowserSession\(\);[\s\S]*sessionHost\.prepareWorkspace\(\)/u);
	assert.match(source, /window\.history\.replaceState/u);
	assert.doesNotMatch(source, /window\.location\.replace\(preparedWorkspace\.entryUrl\)/u);
});

test('hosted fragment pairing classification uses the validated exact-origin host', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /sessionHost !== undefined &&[\s\S]*pairingUrl\.origin === sessionHost\.origin &&[\s\S]*has\('pairingToken'\)/u);
	assert.match(source, /searchParams\.get\('transport'\) === 'webrtc' \|\|[\s\S]*isHostedSessionPairing/u);
	assert.doesNotMatch(source, /__TERMINAY_REMOTE_WEBRTC__|__TERMINAY_BROWSER_ENROLLMENT__/u);
});

test('replacement activation verifies the stable profile and authenticated server identity', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /currentProfile\?\.origin !== profile\.origin[\s\S]*currentProfile\.archived === true/u);
	assert.match(source, /profile\.status !== 'connecting' &&[\s\S]*hello\.serverId !== profile\.serverId[\s\S]*Recovered server identity does not match the saved profile/u);
	assert.match(source, /profile\.status === 'connecting'[\s\S]*serverId: hello\.serverId[\s\S]*status: 'connected'/u);
	assert.match(source, /connectionController\.current!\.activate/u);
});
