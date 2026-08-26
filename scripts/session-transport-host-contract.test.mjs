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
			authenticatedTransportVersion: 1,
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
			authenticatedTransportVersion: 1,
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
	assert.equal(host.hostName, undefined);
	const prepared = await host.prepareWorkspace();
	assert.equal(prepared.expectedServerId, 'server-a');
	assert.deepEqual([...prepared.compressedArchive], [1, 2, 3]);
	assert.throws(() => { globalThis.window.__TERMINAY_SESSION_TRANSPORT__ = {}; }, /read only|assign/u);
});

test('production bootstrap copies a non-secret connection hostname onto the session host', async () => {
	const byteEndpoint = { send: async () => {}, subscribe: () => () => {} };
	globalThis.window = {
		location: { origin: 'https://room.terminay.com' },
		__TERMINAY_HOSTED_SESSION_AUTHORITY__: {
			authenticatedTransportVersion: 1,
			serverId: 'server-a',
			hostName: 'Studio-Mac',
			hostContext: { serverId: 'server-a' },
			readBundle: async () => new Uint8Array([1, 2, 3]),
			byteEndpoint,
			sessionId: 'room',
			origin: 'https://room.terminay.com',
			connect: async () => endpoint(),
		},
	};
	const host = contract.bootstrapHostedBrowserSession();
	assert.equal(host.hostName, 'Studio-Mac');
});

test('rejects incompatible versions, origins, and missing capabilities', async () => {
	for (const overrides of [
		{ version: 2 },
		{ authenticatedTransportVersion: 2 },
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
	const serverEntry = await readFile('src/web/serverEntry.ts', 'utf8');
	const source = await readFile('src/remote/main.tsx', 'utf8');
	assert.match(
		serverEntry,
		/const root = document\.getElementById\('web-root'\);[\s\S]*bootstrapHostedBrowserSession\(\);[\s\S]*import\('\.\.\/remote\/main'\)/u,
	);
	assert.match(source, /const sessionHost = bootstrapHostedBrowserSession\(\);[\s\S]*sessionHost\.prepareWorkspace\(\)/u);
	assert.match(source, /\/remote-app\/ is a Cache Storage path/u);
	assert.doesNotMatch(source, /window\.history\.replaceState/u);
	assert.doesNotMatch(source, /window\.location\.replace\(preparedWorkspace\.entryUrl\)/u);
});

test('the workspace never parses pairing credentials or performs browser enrollment', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /transport = await sessionHost\.connect/u);
	assert.doesNotMatch(source, /deviceEnrollment|loadBrowserDeviceIdentity|authenticateDevice/u);
});

test('the workspace labels its connection from the session hostname, not the opaque origin', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /label = sessionHost\.hostName\?\.trim\(\) \|\| 'Remote'/u);
	assert.doesNotMatch(source, /label = new URL\(origin\)\.host/u);
	assert.match(source, /serverId: hello\.serverId/u);
});

test('browser disconnect returns to the manager list instead of closing into a retry shell', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(source, /leaveManagerSession\(\)/u);
	assert.match(source, /if \(leaveManagerSession\(\)\) return;/u);
});

test('leaveManagerSession posts shell.back when framed and assigns the manager URL otherwise', () => {
	const posted = [];
	const assigned = [];
	const parent = {
		postMessage(message, origin) {
			posted.push({ message, origin });
		},
	};
	const framed = {
		parent,
		location: {
			assign(url) {
				assigned.push(url);
			},
		},
	};
	assert.equal(
		contract.leaveManagerSession(
			{ managerUrl: 'https://app.terminay.com/' },
			framed,
		),
		true,
	);
	assert.deepEqual(posted, [
		{
			message: { type: 'shell.back', v: 1 },
			origin: 'https://app.terminay.com',
		},
	]);
	assert.deepEqual(assigned, []);

	const top = {
		location: {
			assign(url) {
				assigned.push(url);
			},
		},
	};
	top.parent = top;
	assert.equal(
		contract.leaveManagerSession(
			{ managerUrl: 'https://app.terminay.com/' },
			top,
		),
		true,
	);
	assert.deepEqual(assigned, ['https://app.terminay.com/']);

	let called = 0;
	assert.equal(
		contract.leaveManagerSession(
			{
				leaveManager() {
					called += 1;
				},
				managerUrl: 'https://app.terminay.com/',
			},
			framed,
		),
		true,
	);
	assert.equal(called, 1);
	assert.equal(posted.length, 1);
});

test('canLeaveManagerSession is true only when a manager return path exists', () => {
	assert.equal(contract.canLeaveManagerSession({}), false);
	assert.equal(contract.canLeaveManagerSession({ managerUrl: '' }), false);
	assert.equal(
		contract.canLeaveManagerSession({
			managerUrl: 'https://app.terminay.com/',
		}),
		true,
	);
	assert.equal(
		contract.canLeaveManagerSession({
			leaveManager() {},
		}),
		true,
	);

	globalThis.window = { location: { origin: 'https://room.terminay.com' } };
	assert.equal(contract.canLeaveManagerSession(), false);
});

test('Desktop composition withholds Switch connections unless a manager session exists', async () => {
	const workspace = await readFile(
		'src/web/ConnectedWebRendererWorkspace.tsx',
		'utf8',
	);
	assert.match(workspace, /canLeaveManagerSession\(\)/u);
	assert.match(
		workspace,
		/hostContext === undefined && canLeaveManagerSession\(\)/u,
	);
	assert.doesNotMatch(workspace, /onSwitchConnections:\s*onBack/u);
});
