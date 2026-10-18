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

/** A server lane whose byte stream the test ends, as a lost WebRTC path does.
 * `reading` settles when Desktop starts reading it, which it does right after
 * deciding what the document's endpoint is. */
function lane() {
	let end;
	const ended = new Promise((resolveEnded) => {
		end = resolveEnded;
	});
	let startedReading;
	const reading = new Promise((resolveReading) => {
		startedReading = resolveReading;
	});
	return {
		reading,
		lose: () => end(),
		open: async () => undefined,
		send: async () => undefined,
		close: async () => end(),
		onStateChange: () => () => undefined,
		incoming: {
			[Symbol.asyncIterator]: () => {
				startedReading();
				return {
					next: async () => {
						await ended;
						return { done: true, value: undefined };
					},
				};
			},
		},
	};
}

/** A list whose growth the test can wait on: `reach(n)` resolves once it
 * holds n entries. */
function observed() {
	const entries = [];
	const waiters = [];
	return {
		entries,
		push(entry) {
			entries.push(entry);
			for (const waiter of waiters.filter(({ count }) => entries.length >= count)) {
				waiters.splice(waiters.indexOf(waiter), 1);
				waiter.resolve();
			}
		},
		reach(count) {
			if (entries.length >= count) return Promise.resolve();
			return new Promise((resolveWait) => waiters.push({ count, resolve: resolveWait }));
		},
	};
}

// A window on a remote server loses its connection and the first attempt to
// reconnect fails. The window must not be left waiting on a reconnect nobody is
// making: Desktop tries again, and the document gets a live endpoint as soon
// as the new lane is live, without having to ask again.
test('a window whose first reconnect attempt fails is reconnected by a later one', async (t) => {
	// The pause before the next attempt is the test's to end.
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const endpoints = observed();
	const failureEdges = observed();
	const askForEndpoint = () =>
		ipcMain.emit('server-ui-host:replace-byte-endpoint', { sender });
	const sender = Object.assign(new EventEmitter(), {
		id: 7,
		postMessage: (channel, _payload, ports) => {
			if (channel !== 'server-ui-host:byte-endpoint') return;
			// The document asks for a live endpoint when its lane reports the
			// transport failed, as its recovery does.
			ports[0].on('message', ({ data }) => {
				if (data !== null) return;
				failureEdges.push(data);
				askForEndpoint();
			});
			ports[0].start();
			endpoints.push(ports[0]);
		},
	});
	const first = lane();
	const replacement = lane();
	const attempts = observed();
	const diagnostics = observed();
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender,
		launch: {
			context: { serverId: 'pop-os' },
			byteEndpointHandle: 'endpoint-1',
		},
		transport: first,
		reconnect: async () => {
			attempts.push('attempt');
			if (attempts.entries.length === 1) throw new Error('the server did not answer');
			return replacement;
		},
		diagnostic: (resource) => diagnostics.push(resource),
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await endpoints.reach(1);

		first.lose();
		await failureEdges.reach(1);
		await attempts.reach(1);
		// The failure is reported, and the next attempt armed, together. The
		// document asking again meanwhile is not handed the dead lane.
		await diagnostics.reach(1);
		assert.deepEqual(diagnostics.entries, ['remote-reconnect']);
		askForEndpoint();
		assert.equal(attempts.entries.length, 1);
		assert.equal(endpoints.entries.length, 1);

		// The first pause ends: Desktop tries again by itself, and hands the
		// document the new lane's endpoint before it starts reading that lane.
		t.mock.timers.tick(1_000);
		await attempts.reach(2);
		await replacement.reading;
		assert.equal(endpoints.entries.length, 2);
		assert.equal(attempts.entries.length, 2);
		assert.deepEqual(diagnostics.entries, ['remote-reconnect']);
	} finally {
		unbind();
		for (const endpoint of endpoints.entries) endpoint.close();
	}
});
