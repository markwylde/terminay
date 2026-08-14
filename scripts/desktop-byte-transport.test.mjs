import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(
	join(process.cwd(), 'scripts', '.desktop-byte-'),
);
const outputFile = join(outputDirectory, 'desktopByteTransport.mjs');
await build({
	absWorkingDir: process.cwd(),
	bundle: true,
	entryPoints: ['src/web/desktopByteTransport.ts'],
	external: ['@terminay/protocol'],
	format: 'esm',
	outfile: outputFile,
	platform: 'node',
});
const { acquireDesktopServerBootstrap } = await import(outputFile);

test.after(async () => rm(outputDirectory, { recursive: true, force: true }));

const context = Object.freeze({
	schemaVersion: 1,
	bootstrapVersion: 1,
	sourceId: 'desktop-source',
	windowId: 'window-1',
	serverId: 'server-local',
	profileId: 'local:embedded',
	bundleId: 'bundle_local_1234',
	applicationProtocolVersion: '1.0.0',
	hostKind: 'desktop',
	hostBridgeVersion: 1,
	byteEndpointVersion: 1,
	capabilities: {},
});

test('Desktop bootstrap carries bounded bidirectional bytes for the exact host context', async () => {
	const listeners = new Set();
	const sent = [];
	let replacements = 0;
	const bootstrap = await acquireDesktopServerBootstrap(
		{ getContext: async () => context },
		{
			version: 1,
			replaceEndpoint: async () => { replacements += 1; },
			send: async (frame) => sent.push([...frame]),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
	);
	assert.equal(replacements, 0);
	assert.equal(bootstrap.context, context);
	await bootstrap.transport.open();
	await bootstrap.transport.send(new Uint8Array([1, 2, 3]));
	assert.deepEqual(sent, [[1, 2, 3]]);
	const next = bootstrap.transport.incoming[Symbol.asyncIterator]().next();
	for (const listener of listeners) listener(new Uint8Array([4, 5]));
	assert.deepEqual(await next, { done: false, value: new Uint8Array([4, 5]) });
	await bootstrap.transport.close();
	assert.equal(listeners.size, 0);
});

test('normal bootstrap remains compatible with a currently loaded version-one preload', async () => {
	const bootstrap = await acquireDesktopServerBootstrap(
		{ getContext: async () => context },
		{
			version: 1,
			send: async () => {},
			subscribe: () => () => {},
		},
	);
	assert.equal(bootstrap?.context, context);
	await assert.rejects(
		acquireDesktopServerBootstrap(
			{ getContext: async () => context },
			{
				version: 1,
				send: async () => {},
				subscribe: () => () => {},
			},
			{ replaceEndpoint: true },
		),
		/requires restarting the Electron window/u,
	);
});

test('Desktop bootstrap fails closed for partial or non-Desktop bridges', async () => {
	await assert.rejects(
		acquireDesktopServerBootstrap(
			{ getContext: async () => context },
			undefined,
		),
		/incomplete/u,
	);
	await assert.rejects(
		acquireDesktopServerBootstrap(
			{ getContext: async () => ({ ...context, hostKind: 'browser' }) },
			{ version: 1, replaceEndpoint: async () => {}, send: async () => {}, subscribe: () => () => {} },
		),
		/wrong host kind/u,
	);
});

test('Desktop byte endpoint failure terminates pending reads', async () => {
	let listener;
	const bootstrap = await acquireDesktopServerBootstrap(
		{ getContext: async () => context },
		{
			version: 1,
			replaceEndpoint: async () => {},
			send: async () => {},
			subscribe: (next) => {
				listener = next;
				return () => {};
			},
		},
	);
	await bootstrap.transport.open();
	const pending = bootstrap.transport.incoming[Symbol.asyncIterator]().next();
	listener(null);
	await assert.rejects(pending, /byte endpoint failed/u);
	assert.equal(bootstrap.transport.state, 'failed');
});
