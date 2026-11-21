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
const handlers = new Map();
ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
ipcMain.invoke = (channel, ...args) => handlers.get(channel)(...args);
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
			for (const waiter of waiters.filter(
				({ count }) => entries.length >= count,
			)) {
				waiters.splice(waiters.indexOf(waiter), 1);
				waiter.resolve();
			}
		},
		reach(count) {
			if (entries.length >= count) return Promise.resolve();
			return new Promise((resolveWait) =>
				waiters.push({ count, resolve: resolveWait }),
			);
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
			if (attempts.entries.length === 1)
				throw new Error('the server did not answer');
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

/** A remote window's sender whose main frame is or is not loading, recording
 * every document endpoint it is handed. */
function documentSender(id, endpoints, metadata = []) {
	const sender = Object.assign(new EventEmitter(), {
		id,
		mainFrame: {},
		mainFrameLoading: false,
		isLoadingMainFrame: () => sender.mainFrameLoading,
		postMessage: (channel, payload, ports) => {
			if (channel !== 'server-ui-host:byte-endpoint') return;
			metadata.push(payload);
			ports[0].start();
			endpoints.push(ports[0]);
		},
	});
	return sender;
}

// An app window's view is a frame inside the workspace document. Its loading
// is not the document reloading: the window keeps the lane it has, and is not
// left waiting for a document that never comes back to say it is ready.
test('a frame loading inside a remote window keeps its lane', async () => {
	const endpoints = observed();
	const sender = documentSender(8, endpoints);
	const current = lane();
	let closed = false;
	const close = current.close;
	current.close = async () => {
		closed = true;
		await close();
	};
	const attempts = observed();
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender,
		launch: {
			context: { serverId: 'pop-os' },
			byteEndpointHandle: 'endpoint-2',
		},
		transport: current,
		reconnect: async () => {
			attempts.push('attempt');
			return lane();
		},
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await endpoints.reach(1);

		// An iframe starts loading; the workspace document does not.
		sender.emit('did-start-loading');
		await new Promise((resolveTurn) => setImmediate(resolveTurn));
		assert.equal(closed, false, 'the lane was closed for a frame load');
		assert.deepEqual(attempts.entries, []);
		assert.equal(endpoints.entries.length, 1);
	} finally {
		unbind();
		for (const endpoint of endpoints.entries) endpoint.close();
	}
});

// A reload of the workspace document itself still starts a fresh lane, handed
// to the new document once it says it is ready.
test('a remote window reloading its document gets a fresh lane', async () => {
	const endpoints = observed();
	const sender = documentSender(9, endpoints);
	const replacement = lane();
	const attempts = observed();
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender,
		launch: {
			context: { serverId: 'pop-os' },
			byteEndpointHandle: 'endpoint-3',
		},
		transport: lane(),
		reconnect: async () => {
			attempts.push('attempt');
			return replacement;
		},
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await endpoints.reach(1);

		sender.mainFrameLoading = true;
		sender.emit('did-start-loading');
		await attempts.reach(1);
		sender.mainFrameLoading = false;
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await replacement.reading;
		assert.equal(endpoints.entries.length, 2);
	} finally {
		unbind();
		for (const endpoint of endpoints.entries) endpoint.close();
	}
});

function requestRecovery(
	sender,
	generation,
	manual,
	senderFrame = sender.mainFrame,
) {
	return ipcMain.invoke(
		'server-ui-host:recover-remote-endpoint',
		{ sender, senderFrame },
		generation,
		manual,
	);
}

test('a silent open lane is replaced, Retry skips backoff, and concurrent requests join', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const endpoints = observed();
	const metadata = [];
	const sender = documentSender(10, endpoints, metadata);
	const started = observed();
	const current = lane();
	const replacement = lane();
	const diagnostics = observed();
	let complete;
	const inFlight = new Promise((resolve) => {
		complete = resolve;
	});
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender,
		launch: {
			context: { serverId: 'remote' },
			byteEndpointHandle: 'endpoint-4',
		},
		transport: current,
		reconnect: () => {
			started.push('start');
			if (started.entries.length === 1) throw new Error('unavailable');
			return inFlight;
		},
		onRecovery: (event) => diagnostics.push(event),
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await endpoints.reach(1);
		const { generation } = metadata[0];

		assert.deepEqual(await requestRecovery(sender, generation, true, {}), {
			outcome: 'retired',
		});
		assert.deepEqual(started.entries, []);
		// Current still reports open and never emits a close. Only the
		// workspace's application-liveness request can retire it.
		assert.deepEqual(await requestRecovery(sender, generation, false), {
			outcome: 'unavailable',
		});
		assert.deepEqual(await requestRecovery(sender, generation, false), {
			outcome: 'unavailable',
		});
		assert.equal(started.entries.length, 1);

		const retry = requestRecovery(sender, generation, true);
		const joined = requestRecovery(sender, generation, false);
		await started.reach(2);
		complete(replacement);
		const next = { outcome: 'ready', generation: generation + 1 };
		assert.deepEqual(await retry, next);
		assert.deepEqual(await joined, next);
		assert.deepEqual(await requestRecovery(sender, generation, true), next);
		assert.equal(started.entries.length, 2);
		assert.equal(endpoints.entries.length, 2);
		assert.ok(
			diagnostics.entries.some(
				(event) => event.stage === 'join' && event.attempt === 2,
			),
		);
	} finally {
		unbind();
		for (const endpoint of endpoints.entries) endpoint.close();
	}
});

test('a timed-out replacement cannot take over the next lane', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const endpoints = observed();
	const metadata = [];
	const current = documentSender(11, endpoints, metadata);
	const otherEndpoints = observed();
	const other = documentSender(12, otherEndpoints);
	const diagnostics = observed();
	const late = lane();
	const replacement = lane();
	const unstarted = observed();
	let completeLate;
	let setupSignal;
	let calls = 0;
	let lateClosed = false;
	late.close = async () => {
		lateClosed = true;
	};
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender: current,
		launch: {
			context: { serverId: 'same-server' },
			byteEndpointHandle: 'endpoint-5',
		},
		transport: lane(),
		reconnect: async (signal) => {
			if (++calls !== 1) return replacement;
			setupSignal = signal;
			return new Promise((resolve) => {
				completeLate = resolve;
				unstarted.push('hung');
			});
		},
		onRecovery: diagnostics.push,
	});
	const unbindOther = bindRemoteServerUiDocumentEndpoint({
		sender: other,
		launch: {
			context: { serverId: 'same-server' },
			byteEndpointHandle: 'endpoint-6',
		},
		transport: lane(),
		reconnect: async () => assert.fail('the other window reconnected'),
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender: current });
		ipcMain.emit('server-ui-host:document-ready', { sender: other });
		await Promise.all([endpoints.reach(1), otherEndpoints.reach(1)]);
		const { generation } = metadata[0];
		const timed = requestRecovery(current, generation, false);
		await unstarted.reach(1);
		t.mock.timers.tick(90_000);
		assert.deepEqual(await timed, { outcome: 'timeout' });
		assert.equal(setupSignal.aborted, true);
		const result = await requestRecovery(current, generation, true);
		assert.deepEqual(result, { outcome: 'ready', generation: generation + 1 });
		ipcMain.emit(
			'server-ui-host:remote-endpoint-received',
			{ sender: current, senderFrame: current.mainFrame },
			result.generation,
		);
		completeLate(late);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(lateClosed, true);
		assert.equal(endpoints.entries.length, 2);
		assert.equal(otherEndpoints.entries.length, 1);
		assert.deepEqual(
			diagnostics.entries.map(({ stage, attempt, outcome }) => [
				stage,
				attempt,
				outcome,
			]),
			[
				['request', 1, undefined],
				['start', 1, undefined],
				['outcome', 1, 'timeout'],
				['request', 2, undefined],
				['start', 2, undefined],
				['outcome', 2, 'ready'],
				['handoff', 2, 'ready'],
			],
		);
		for (const event of diagnostics.entries) {
			assert.ok(
				Object.keys(event).every((key) =>
					['attempt', 'stage', 'reason', 'outcome', 'durationMs'].includes(key),
				),
			);
			if (event.durationMs !== undefined)
				assert.ok(Number.isSafeInteger(event.durationMs));
		}
	} finally {
		unbind();
		unbindOther();
		for (const endpoint of [...endpoints.entries, ...otherEndpoints.entries])
			endpoint.close();
	}
});

test('an explicit pairing refusal stops the host backoff', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const endpoints = observed();
	const metadata = [];
	const sender = documentSender(13, endpoints, metadata);
	let calls = 0;
	const unbind = bindRemoteServerUiDocumentEndpoint({
		sender,
		launch: {
			context: { serverId: 'remote' },
			byteEndpointHandle: 'endpoint-7',
		},
		transport: lane(),
		reconnect: async () => {
			calls += 1;
			throw Object.assign(
				new Error('the authenticated server refused the device'),
				{ code: 'pairing-required' },
			);
		},
	});
	try {
		ipcMain.emit('server-ui-host:document-ready', { sender });
		await endpoints.reach(1);
		assert.deepEqual(
			await requestRecovery(sender, metadata[0].generation, false),
			{ outcome: 'pairing-required' },
		);
		t.mock.timers.tick(100_000);
		assert.deepEqual(
			await requestRecovery(sender, metadata[0].generation, true),
			{ outcome: 'pairing-required' },
		);
		assert.equal(calls, 1);
	} finally {
		unbind();
		for (const endpoint of endpoints.entries) endpoint.close();
	}
});
