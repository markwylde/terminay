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
			connect: async () => endpoint(),
			...overrides,
		},
	};
}

test('accepts and returns only a runtime-validated opaque endpoint', async () => {
	install();
	const transport = await contract.getSessionTransportHost().connect({
		origin: 'https://room.terminay.com',
		onStateChange: () => {},
	});
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
			connect: async () => endpoint(),
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

test('rejects incompatible versions, origins, and missing capabilities', async () => {
	for (const overrides of [
		{ version: 2 },
		{ origin: 'https://sibling.terminay.com' },
		{ connect: undefined },
		{ prepareWorkspace: undefined },
	]) {
		install(overrides);
		assert.throws(() => contract.getSessionTransportHost(), /incompatible/u);
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

test('the workspace never parses pairing credentials or performs browser enrollment', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /transport = await sessionHost\.connect/u);
	assert.doesNotMatch(source, /deviceEnrollment|loadBrowserDeviceIdentity|authenticateDevice/u);
});

test('the workspace labels its connection from the bound session origin', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /origin = sessionHost\.origin[\s\S]*label = new URL\(origin\)\.host/u);
	assert.match(source, /serverId: hello\.serverId/u);
});
