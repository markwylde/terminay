import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(process.cwd(), '.remote-endpoint-reconnect-test-'),
);
const electronStub = join(directory, 'electron-stub.mjs');
await writeFile(
	electronStub,
	`import { EventEmitter } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
export const ipcMain = new EventEmitter();
function port(native) {
	return {
		on: (name, listener) =>
			native.on(name, name === 'message' ? (data) => listener({ data }) : listener),
		start: () => native.start(),
		close: () => native.close(),
		postMessage: (value) => native.postMessage(value),
	};
}
export class MessageChannelMain {
	constructor() {
		const channel = new MessageChannel();
		this.port1 = port(channel.port1);
		this.port2 = port(channel.port2);
	}
}
`,
);
const outfile = join(directory, 'endpoint.mjs');
await build({
	entryPoints: ['electron/serverUiDocumentEndpoint.ts'],
	outfile,
	bundle: true,
	format: 'esm',
	platform: 'node',
	alias: {
		'@terminay/protocol': resolve('packages/protocol/src/index.ts'),
	},
	// The stub stays one module instance, shared with this test.
	plugins: [
		{
			name: 'electron-stub',
			setup(bundler) {
				bundler.onResolve({ filter: /^electron$/ }, () => ({
					path: pathToFileURL(electronStub).href,
					external: true,
				}));
			},
		},
	],
	logLevel: 'silent',
});
const { bindRemoteServerUiDocumentEndpoint } = await import(
	pathToFileURL(outfile).href
);
const { ipcMain } = await import(pathToFileURL(electronStub).href);

test.after(() => rm(directory, { force: true, recursive: true }));

/** A server lane whose byte stream the test ends, as a lost WebRTC path does. */
function lane() {
	let end;
	const ended = new Promise((resolveEnded) => {
		end = resolveEnded;
	});
	return {
		lose: () => end(),
		open: async () => undefined,
		send: async () => undefined,
		close: async () => end(),
		onStateChange: () => () => undefined,
		incoming: {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					await ended;
					return { done: true, value: undefined };
				},
			}),
		},
	};
}

async function until(condition, timeoutMs, message) {
	const startedAt = Date.now();
	while (!condition()) {
		if (Date.now() - startedAt > timeoutMs) assert.fail(message);
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
}

// A window on a remote server loses its connection and the first attempt to
// reconnect fails. The window must not be left waiting on a reconnect nobody is
// making: Desktop tries again, and the document gets a live endpoint.
test('a window whose first reconnect attempt fails is reconnected by a later one', async () => {
	const endpoints = [];
	const sender = Object.assign(new EventEmitter(), {
		id: 7,
		postMessage: (channel, _payload, ports) => {
			if (channel !== 'server-ui-host:byte-endpoint') return;
			endpoints.push(ports[0]);
			ports[0].on('message', () => undefined);
			ports[0].start();
		},
	});
	const first = lane();
	const replacement = lane();
	let attempts = 0;
	const diagnostics = [];
	let asking;
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender,
		launch: {
			context: { serverId: 'pop-os' },
			byteEndpointHandle: 'endpoint-1',
		},
		transport: first,
		reconnect: async () => {
			attempts += 1;
			if (attempts === 1) throw new Error('the server did not answer');
			return replacement;
		},
		diagnostic: (resource) => diagnostics.push(resource),
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await until(
			() => endpoints.length === 1,
			5_000,
			'the document was never given its first endpoint',
		);

		first.lose();
		// The document keeps asking for a live endpoint, as its recovery does.
		asking = setInterval(
			() => ipcMain.emit('server-ui-host:replace-byte-endpoint', { sender }),
			250,
		);
		await until(
			() => attempts === 1,
			5_000,
			'the lost connection was never reconnected',
		);
		assert.deepEqual(diagnostics, ['remote-reconnect']);

		await until(
			() => attempts >= 2,
			30_000,
			'after one failed reconnect the window was never reconnected again',
		);
		await until(
			() => endpoints.length === 2,
			5_000,
			'the reconnected lane was never handed to the document',
		);
	} finally {
		clearInterval(asking);
		unbind();
		for (const endpoint of endpoints) endpoint.close();
	}
});
