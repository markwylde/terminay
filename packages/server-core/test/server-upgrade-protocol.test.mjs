import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SERVER_UPGRADE_OPERATIONS as CLIENT_OPERATIONS,
	ServerUpgradeClient,
	serverPublishesUpgradeStatus,
	TerminayClient,
} from '@terminay/client-core';
import {
	FEATURE_CAPABILITIES,
	SERVER_UPGRADE_OPERATIONS,
} from '@terminay/protocol';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	capabilityOf,
	createServerCore,
	createServerCoreComposition,
	ServerUpgradeService,
} from '../dist/index.js';

const quietPty = {
	spawn: () => ({
		pid: 4242,
		write() {},
		resize() {},
		kill() {},
		onData() {
			return () => {};
		},
		onExit() {
			return () => {};
		},
		onForegroundProcess() {
			return () => {};
		},
		async refreshForegroundProcess() {},
	}),
};

const report = (overrides = {}) => ({
	environment: 'user',
	installed: { channel: 'tag', version: '5.1.1', revision: 'aaaa111' },
	available: { version: '5.2.0' },
	canUpgrade: true,
	modes: ['in-place'],
	trigger: { kind: 'spawn' },
	unavailable: null,
	lastResult: null,
	...overrides,
});

function fakeUpgrader(initial) {
	const upgrader = {
		current: initial,
		checks: 0,
		handovers: [],
		async check() {
			upgrader.checks += 1;
			return upgrader.current;
		},
		async trigger(handover) {
			upgrader.handovers.push(handover);
			return undefined;
		},
	};
	return upgrader;
}

/** Settles once this client holds a status that satisfies `predicate`. */
function statusWhere(upgrade, predicate) {
	if (upgrade.status !== undefined && predicate(upgrade.status))
		return Promise.resolve(upgrade.status);
	return new Promise((resolve) => {
		const off = upgrade.store.subscribe((status) => {
			if (status === undefined || !predicate(status)) return;
			off();
			resolve(status);
		});
	});
}

/** A composed server and a way to attach feature clients to it. */
async function served(t, { upgrader, scopeFor = () => 'admin' } = {}) {
	const intervals = new Set();
	const service =
		upgrader === undefined
			? undefined
			: new ServerUpgradeService({
					serverVersion: '5.1.1',
					upgrader,
					setInterval: (handler) => {
						intervals.add(handler);
						return handler;
					},
					clearInterval: (handler) => {
						intervals.delete(handler);
					},
				});
	const composition = createServerCoreComposition({
		allowUnresolvedTestSessions: true,
		serverId: 'upgrade-server',
		serverVersion: '5.1.1',
		capabilities: ['desktop'],
		ptyFactory: quietPty,
		...(service === undefined ? {} : { serverUpgrade: service }),
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: scopeFor(hello.clientId),
		}),
		// Called once the server has let go of the connection, upgrade
		// attachment included.
		onConnectionClosed: (_connectionId, clientId) => {
			closeWaiters.get(clientId)?.();
		},
	});
	/** Start the server and settle once its first release check is in. */
	async function start() {
		const checked =
			service === undefined
				? undefined
				: new Promise((resolve) => {
						const off = service.subscribe(() => {
							off();
							resolve();
						});
					});
		await composition.start();
		await checked;
	}
	const closeWaiters = new Map();
	const closers = [];
	t.after(async () => {
		for (const close of closers) await close();
		await composition.shutdown();
	});
	async function connect(clientId) {
		const pair = createInMemoryTransportPair();
		const serverTask = composition.core.accept(pair.server).start();
		const client = new TerminayClient({
			transport: pair.client,
			clientId,
			capabilities: ['events.resync'],
		});
		const close = async () => {
			await client.close().catch(() => undefined);
			await serverTask.catch(() => undefined);
		};
		const serverReleased = new Promise((resolve) =>
			closeWaiters.set(clientId, resolve),
		);
		closers.push(close);
		await pair.open();
		const hello = await client.connect();
		const upgrade = new ServerUpgradeClient({
			query: async (operation, payload, options) =>
				(await client.query(operation, payload, options)).result,
			command: async (operation, payload, options) =>
				(await client.command(operation, payload, options)).result,
			subscribe: async (event, listener, onResync) => {
				const subscription = await client.subscribe(event);
				subscription.onEvent(listener);
				if (onResync !== undefined) subscription.onResync(onResync);
				return () => void subscription.unsubscribe().catch(() => undefined);
			},
		});
		return {
			client,
			hello,
			upgrade,
			close,
			/** Close, and settle once the server has released the connection. */
			disconnect: async () => {
				await close();
				await serverReleased;
			},
		};
	}
	return { composition, connect, intervals, start };
}

const rejectedWith = (code, reason) => (error) => {
	const cause = error.cause ?? error;
	assert.equal(cause.code, code);
	if (reason !== undefined) assert.equal(cause.details?.reason, reason);
	return true;
};

test('both sides agree on the operation names, and each belongs to the upgrade capability', () => {
	assert.deepEqual({ ...CLIENT_OPERATIONS }, { ...SERVER_UPGRADE_OPERATIONS });
	for (const operation of Object.values(SERVER_UPGRADE_OPERATIONS))
		assert.equal(
			capabilityOf(operation),
			FEATURE_CAPABILITIES.serverUpgrade,
			operation,
		);
	// The connection mechanics that share the namespace are not swept in.
	assert.notEqual(
		capabilityOf('server.health'),
		FEATURE_CAPABILITIES.serverUpgrade,
	);
	assert.notEqual(
		capabilityOf('server.upgrades'),
		FEATURE_CAPABILITIES.serverUpgrade,
	);
});

test('every attached client receives the same status, and again when it changes', async (t) => {
	const upgrader = fakeUpgrader(report({ available: null }));
	const { composition, connect, start } = await served(t, { upgrader });
	await start();
	const desktop = await connect('desktop');
	const browser = await connect('browser');
	const phone = await connect('phone');
	for (const each of [desktop, browser, phone]) {
		assert.equal(serverPublishesUpgradeStatus(each.hello.capabilities), true);
		await each.upgrade.subscribe();
		assert.equal(each.upgrade.status.available, undefined);
	}
	// A later check finds a newer release while all three are attached.
	upgrader.current = report();
	await composition.serverUpgrade.check();
	await Promise.all(
		[desktop, browser, phone].map((each) =>
			statusWhere(each.upgrade, (status) => status.available !== undefined),
		),
	);
	const expected = {
		version: '5.1.1',
		channel: 'tag',
		available: { version: '5.2.0' },
		canUpgrade: true,
		modes: ['in-place'],
		upgrade: { state: 'none' },
	};
	for (const each of [desktop, browser, phone])
		assert.deepEqual(each.upgrade.status, expected);
	// A device that attaches afterwards is told the same thing.
	const late = await connect('late');
	await late.upgrade.subscribe();
	assert.deepEqual(late.upgrade.status, expected);
});

test('the release check is owned by attached clients over the wire', async (t) => {
	const upgrader = fakeUpgrader(report());
	const { connect, intervals, start } = await served(t, { upgrader });
	await start();
	assert.equal(upgrader.checks, 1, 'one check at server start');
	assert.equal(intervals.size, 0, 'no poll while nobody is attached');
	const first = await connect('first');
	const second = await connect('second');
	assert.equal(intervals.size, 1);
	await first.disconnect();
	assert.equal(intervals.size, 1);
	await second.disconnect();
	assert.equal(intervals.size, 0, 'the poll outlived the last client');
});

test('a paired device starts the upgrade and every device sees it in progress', async (t) => {
	const upgrader = fakeUpgrader(report());
	const { connect, start } = await served(t, { upgrader });
	await start();
	const first = await connect('first');
	const second = await connect('second');
	await first.upgrade.subscribe();
	await second.upgrade.subscribe();
	const status = await first.upgrade.startServerUpgrade('in-place');
	assert.equal(status.upgrade.state, 'in-progress');
	await statusWhere(
		second.upgrade,
		(seen) => seen.upgrade.state === 'in-progress',
	);
	assert.deepEqual(second.upgrade.status.upgrade, status.upgrade);
	assert.deepEqual(upgrader.handovers, [
		{ environment: 'user', mode: 'in-place', trigger: { kind: 'spawn' } },
	]);
	// A second device asking while it runs is refused; the running one stands.
	await assert.rejects(
		second.upgrade.startServerUpgrade('in-place'),
		rejectedWith('conflict', 'in-progress'),
	);
	assert.equal(upgrader.handovers.length, 1);
});

test('a request that names anything but an offered mode is rejected and starts nothing', async (t) => {
	const upgrader = fakeUpgrader(report());
	const { connect, start } = await served(t, { upgrader });
	await start();
	const { client, upgrade } = await connect('device');
	const send = (payload) =>
		client.command(SERVER_UPGRADE_OPERATIONS.start, payload);
	for (const payload of [
		{},
		{ mode: 'sideways' },
		{ mode: 'in-place', version: '9.9.9' },
		{ mode: 'in-place', url: 'https://example.test/terminay.tar.gz' },
		{ mode: 'in-place', path: '/tmp/terminay' },
		{ mode: 'in-place', flags: ['--force'] },
	])
		await assert.rejects(
			send(payload),
			rejectedWith('validation'),
			JSON.stringify(payload),
		);
	// Recreate is a real mode, but not one this server offers.
	await assert.rejects(
		upgrade.startServerUpgrade('recreate'),
		rejectedWith('conflict', 'mode-not-offered'),
	);
	assert.deepEqual(upgrader.handovers, []);
	assert.deepEqual((await upgrade.refresh()).upgrade, { state: 'none' });
});

test('a request with nothing available is rejected', async (t) => {
	const upgrader = fakeUpgrader(report({ available: null }));
	const { connect, start } = await served(t, { upgrader });
	await start();
	const { upgrade } = await connect('device');
	await assert.rejects(
		upgrade.startServerUpgrade('in-place'),
		rejectedWith('conflict', 'none-available'),
	);
	assert.deepEqual(upgrader.handovers, []);
});

test('only an administrative connection may start an upgrade; any reader may see the status', async (t) => {
	const upgrader = fakeUpgrader(report());
	const { connect, start } = await served(t, {
		upgrader,
		scopeFor: (clientId) =>
			clientId.startsWith('reader')
				? 'read'
				: clientId.startsWith('writer')
					? 'write'
					: 'admin',
	});
	await start();
	for (const clientId of ['reader', 'writer']) {
		const { upgrade } = await connect(clientId);
		assert.deepEqual((await upgrade.refresh()).available, { version: '5.2.0' });
		await assert.rejects(
			upgrade.startServerUpgrade('in-place'),
			rejectedWith('forbidden'),
		);
	}
	assert.deepEqual(upgrader.handovers, []);
});

test('a server composed without an upgrader reports that no upgrade is offered and checks nothing', async (t) => {
	// The embedded Local server, and a standalone one run from a checkout.
	const { composition, connect } = await served(t);
	await composition.start();
	assert.equal(composition.serverUpgrade.enabled, false);
	const { hello, upgrade } = await connect('window');
	assert.equal(serverPublishesUpgradeStatus(hello.capabilities), true);
	await upgrade.subscribe();
	assert.deepEqual(upgrade.status, {
		version: '5.1.1',
		canUpgrade: false,
		modes: [],
		upgrade: { state: 'none' },
	});
	await assert.rejects(
		upgrade.startServerUpgrade('in-place'),
		rejectedWith('conflict', 'none-available'),
	);
});

test('a client of a server without the capability receives no status', async (t) => {
	// A server from before the capability: its hello does not name it and its
	// dispatcher has never heard of the operations.
	const core = createServerCore({
		serverId: 'older-server',
		serverVersion: '5.0.0',
		capabilities: [
			FEATURE_CAPABILITIES.terminal,
			FEATURE_CAPABILITIES.workspace,
			FEATURE_CAPABILITIES.files,
		],
		queries: { 'server.health': () => ({ ok: true }) },
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'admin',
		}),
	});
	const pair = createInMemoryTransportPair();
	const serverTask = core.accept(pair.server).start();
	const client = new TerminayClient({
		transport: pair.client,
		clientId: 'newer-client',
	});
	t.after(async () => {
		await client.close().catch(() => undefined);
		await serverTask.catch(() => undefined);
	});
	await pair.open();
	const hello = await client.connect();
	assert.equal(serverPublishesUpgradeStatus(hello.capabilities), false);
	// The connection itself is unaffected.
	assert.deepEqual((await client.query('server.health')).result, { ok: true });
	// A client that asked anyway would be told the operation does not exist.
	await assert.rejects(client.query(SERVER_UPGRADE_OPERATIONS.status));
	await assert.rejects(
		client.command(SERVER_UPGRADE_OPERATIONS.start, { mode: 'in-place' }),
	);
});
