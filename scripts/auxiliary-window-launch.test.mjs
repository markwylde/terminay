import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { serverUiPartitionKey } from '../apps/terminay-desktop/src/main/serverUiPartition.ts';
import { createProfileConnectQueue } from '../electron/remote/desktopWindowIdentity.ts';

// Exercise the actual launch closure with controlled native/transport timings.
// No Electron process, credentials or network is needed for these failure races.
const main = readFileSync(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const start = main.indexOf('\tconst remoteProfile = options?.remoteProfile;');
const end = main.indexOf(
	'\n\tif (options?.deferCanonicalLaunch === true)',
	start,
);
assert.ok(start > 0 && end > start);
const code = transformSync(main.slice(start, end), {
	loader: 'ts',
	target: 'es2022',
}).code;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function harness(overrides = {}) {
	const window = new EventEmitter();
	let destroyed = false;
	let visible = false;
	window.isDestroyed = () => destroyed;
	window.show = () => {
		visible = true;
	};
	window.close = () => {
		destroyed = true;
		window.emit('closed');
	};
	window.loadURL = async () => {};
	const events = [];
	const transport = {
		close: async () => {
			events.push('close');
		},
	};
	let recovery;
	const endpoints = new Map();
	const environment = {
		options: {
			remoteProfile: { id: 'remote:a', serverId: 'server-a' },
			auxiliary: { route: '/?auxiliary=settings' },
		},
		window,
		windowWebContentsId: 42,
		isAuxiliary: true,
		remoteProfileBindingsByWebContents: new Map(),
		auxiliaryRouteByWebContents: new Map(),
		desktopStartupLoadingDocument: () => 'data:text/html,loading',
		desktopWindowIds: { for: (id) => `window-${id}` },
		openDesktopRemoteLanes: async (_profile, id, _failure, _status, signal) => {
			assert.ok(visible, 'connection must start after the native window shows');
			events.push('connect');
			assert.equal(id, 'window-42');
			assert.equal(signal.aborted, false);
			return { transport };
		},
		prepareCanonicalRemoteLaunch: async () => ({}),
		mountCanonicalLaunch: async () => {
			events.push('mount');
		},
		recordCanonicalRecoveryDiagnostic: async () => {
			events.push('diagnostic');
		},
		documentEndpointUnbindByWebContents: endpoints,
		releaseServerUiWindowBinding: () => {},
		releaseLocalServerUiSessionSafely: () => {},
		showCanonicalLaunchRecovery: async (options) => {
			recovery = options;
		},
		launchRecoveryWebContents: new Set(),
		console: { error() {} },
		...overrides,
	};
	const launch = new Function(
		...Object.keys(environment),
		`${code}\nreturn launchWithRecovery;`,
	)(...Object.values(environment));
	return {
		window,
		launch,
		events,
		transport,
		endpoints,
		environment,
		recovery: () => recovery,
	};
}

test('a loaded but unpainted auxiliary document cannot start its connection', async () => {
	const h = harness();
	const running = h.launch();
	await tick();
	assert.deepEqual(h.events, []);
	h.window.emit('ready-to-show');
	await running;
	assert.deepEqual(h.events, ['connect', 'mount']);
});

test('close before first paint cancels launch without opening a lane', async () => {
	const h = harness();
	const running = h.launch();
	await tick();
	h.window.close();
	await running;
	assert.deepEqual(h.events, []);
});

test('close during handshake aborts it and closes a late transport', async () => {
	const pending = deferred();
	let signal;
	const h = harness({
		openDesktopRemoteLanes: async (_profile, _id, _f, _s, abort) => {
			signal = abort;
			return pending.promise;
		},
	});
	const running = h.launch();
	h.window.emit('ready-to-show');
	await tick();
	h.window.close();
	assert.equal(signal.aborted, true);
	pending.resolve({ transport: h.transport });
	await running;
	assert.deepEqual(h.events, ['close']);
});

test('failed mount retires the document endpoint before recovery; Retry opens a fresh lane', async () => {
	let fail = true;
	const h = harness({
		mountCanonicalLaunch: async () => {
			if (fail) throw new Error('mount failed');
		},
	});
	h.endpoints.set(42, () => h.events.push('unbind'));
	const running = h.launch();
	h.window.emit('ready-to-show');
	await running;
	assert.deepEqual(h.events, ['connect', 'close', 'unbind']);
	assert.equal(h.endpoints.has(42), false);
	assert.ok(h.recovery());
	fail = false;
	// No second ready-to-show event is emitted on Retry.
	await h.recovery().retry();
	assert.deepEqual(h.events, ['connect', 'close', 'unbind', 'connect']);
});

test('an unsafe bundle closes the window even if diagnostics fail', async () => {
	const h = harness({
		prepareCanonicalRemoteLaunch: async () => {
			throw new Error('unsafe bundle');
		},
		recordCanonicalRecoveryDiagnostic: async () => {
			throw new Error('disk full');
		},
	});
	const running = h.launch();
	h.window.emit('ready-to-show');
	await running;
	assert.equal(h.window.isDestroyed(), true);
	assert.deepEqual(h.events, ['connect', 'close']);
});

test('connection failure recovers in the same window with the latest route and id', async () => {
	let fail = true;
	const ids = [];
	const h = harness({
		openDesktopRemoteLanes: async (_profile, id) => {
			ids.push(id);
			if (fail) throw new Error('offline');
			return { transport: h.transport };
		},
		mountCanonicalLaunch: async () => {
			assert.equal(
				h.environment.auxiliaryRouteByWebContents.get(42),
				'/?auxiliary=settings&section=extensions',
			);
		},
	});
	const running = h.launch();
	h.window.emit('ready-to-show');
	await running;
	assert.ok(h.recovery());
	h.environment.auxiliaryRouteByWebContents.set(
		42,
		'/?auxiliary=settings&section=extensions',
	);
	fail = false;
	await h.recovery().retry();
	assert.deepEqual(ids, ['window-42', 'window-42']);
	assert.equal(h.window.isDestroyed(), false);
});

test('closing while the bundle is prepared closes the lane without mounting', async () => {
	const pending = deferred();
	const h = harness({ prepareCanonicalRemoteLaunch: () => pending.promise });
	const running = h.launch();
	h.window.emit('ready-to-show');
	await tick();
	h.window.close();
	pending.resolve({});
	await running;
	assert.deepEqual(h.events, ['connect', 'close']);
});

test('remote auxiliary storage stays profile-scoped before launch metadata exists', () => {
	const start = main.indexOf(
		'partition: getServerUiPartitionName(',
		main.indexOf('function createWindow('),
	);
	const end = main.indexOf('\n\t\t\tsandbox:', start);
	assert.ok(start > 0 && end > start);
	const expression = main
		.slice(start + 'partition: '.length, end)
		.trim()
		.replace(/,$/, '');
	const partition = new Function(
		'options',
		'localServerUiPartitionKey',
		'getServerUiPartitionName',
		'serverUiPartitionKey',
		`return ${expression};`,
	);
	const key = (options) =>
		partition(options, 'local-key', (value) => value, serverUiPartitionKey);
	const remote = {
		id: 'remote:a',
		serverId: 'server-a',
		origin: 'https://a.example',
	};
	assert.equal(key(undefined), 'local-key');
	assert.notEqual(key({ remoteProfile: remote }), 'local-key');
	assert.equal(
		key({ remoteProfile: remote }),
		key({ remoteProfile: { ...remote } }),
	);
	assert.notEqual(
		key({ remoteProfile: remote }),
		key({ remoteProfile: { ...remote, id: 'remote:b' } }),
	);
	assert.equal(
		key({ remoteProfile: remote }),
		createHash('sha256').update('server-a\0remote:a').digest('base64url'),
	);
	assert.notEqual(
		key({ remoteProfile: { ...remote, serverId: undefined } }),
		'local-key',
	);
});

test('a window closed in the server queue never handshakes or delays the next window', async () => {
	const queue = createProfileConnectQueue();
	const blocker = deferred();
	const first = queue.run('remote:a', () => blocker.promise);
	const h = harness({
		openDesktopRemoteLanes: (_profile, _id, _failure, _status, abort) =>
			queue.run('remote:a', async () => {
				abort.throwIfAborted();
				assert.fail('the closed window must not start a handshake');
			}),
	});
	const running = h.launch();
	h.window.emit('ready-to-show');
	await tick();
	h.window.close();
	let nextStarted = false;
	const next = queue.run('remote:a', async () => {
		nextStarted = true;
	});
	blocker.resolve();
	await Promise.all([first, running, next]);
	assert.equal(nextStarted, true);
	assert.equal(h.recovery(), undefined);
});

test('identity discovery failure offers Retry instead of closing an otherwise safe bundle', async () => {
	const h = harness({
		options: { remoteProfile: { id: 'remote:a', origin: 'https://a.example' } },
		readRemoteServerIdentity: async () => {
			throw new Error('bootstrap unavailable');
		},
	});
	const running = h.launch();
	h.window.emit('ready-to-show');
	await running;
	assert.equal(h.window.isDestroyed(), false);
	assert.ok(h.recovery());
	assert.deepEqual(h.events, ['connect', 'close']);
});

test('closing during identity discovery aborts its request and retires the lane', async () => {
	let signal;
	const h = harness({
		options: { remoteProfile: { id: 'remote:a', origin: 'https://a.example' } },
		readRemoteServerIdentity: (_origin, abort) => {
			signal = abort;
			return new Promise((_resolve, reject) => {
				abort.addEventListener('abort', () => reject(abort.reason), {
					once: true,
				});
			});
		},
	});
	const running = h.launch();
	h.window.emit('ready-to-show');
	await tick();
	h.window.close();
	await running;
	assert.equal(signal.aborted, true);
	assert.deepEqual(h.events, ['connect', 'close']);
	assert.equal(h.recovery(), undefined);
});
