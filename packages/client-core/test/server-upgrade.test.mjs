import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SERVER_UPGRADE_OPERATIONS,
	ServerUpgradeClient,
	ServerUpgradeStatusStore,
	serverPublishesUpgradeStatus,
	serverUpgradeAvailable,
} from '../dist/index.js';

const status = (overrides = {}) => ({
	version: '5.1.1',
	channel: 'tag',
	canUpgrade: true,
	modes: ['in-place'],
	upgrade: { state: 'none' },
	...overrides,
});

/** One server, as a feature client reaches it. */
function fakeServer(initial) {
	const listeners = new Set();
	const server = {
		current: initial,
		commands: [],
		resync: undefined,
		refuse: undefined,
		subscriptions: 0,
		publish(next) {
			server.current = next;
			for (const listener of listeners)
				listener({
					subscriptionId: 's',
					revision: 1,
					cursor: '1',
					event: SERVER_UPGRADE_OPERATIONS.event,
					payload: next,
				});
		},
		transport: {
			query: async (operation) => {
				assert.equal(operation, SERVER_UPGRADE_OPERATIONS.status);
				return server.current;
			},
			command: async (operation, payload) => {
				server.commands.push({ operation, payload });
				if (server.refuse !== undefined) throw server.refuse;
				server.current = {
					...server.current,
					upgrade: {
						state: 'in-progress',
						mode: payload.mode,
						startedAt: 1_000,
					},
				};
				return server.current;
			},
			subscribe: async (event, listener, onResync) => {
				assert.equal(event, SERVER_UPGRADE_OPERATIONS.event);
				server.subscriptions += 1;
				server.resync = onResync;
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
					server.subscriptions -= 1;
				};
			},
		},
	};
	return server;
}

test('a server says in its hello whether it publishes an upgrade status', () => {
	assert.equal(
		serverPublishesUpgradeStatus(['workspace.v1', 'server.upgrade']),
		true,
	);
	assert.equal(
		serverPublishesUpgradeStatus(['workspace.v1', 'server.health']),
		false,
	);
	assert.equal(serverUpgradeAvailable(undefined), false);
	assert.equal(serverUpgradeAvailable(status()), false);
	assert.equal(
		serverUpgradeAvailable(status({ available: { version: '5.2.0' } })),
		true,
	);
});

test('the store holds the latest whole status and tells listeners only of a change', () => {
	const store = new ServerUpgradeStatusStore();
	const seen = [];
	store.subscribe((next) => seen.push(next?.available?.version ?? null));
	assert.equal(store.status, undefined);
	assert.equal(store.apply(status()), true);
	assert.equal(store.apply(status()), false);
	assert.equal(store.apply(status({ available: { version: '5.2.0' } })), true);
	assert.throws(
		() => store.apply({ ...status(), url: 'https://example.test' }),
		TypeError,
	);
	assert.deepEqual(
		store.status.available,
		{ version: '5.2.0' },
		'an unreadable status changes nothing',
	);
	store.clear();
	store.clear();
	assert.equal(store.status, undefined);
	assert.deepEqual(seen, [null, '5.2.0', null]);
});

test('status for one attached server does not affect another', async () => {
	const home = fakeServer(status());
	const work = fakeServer(status({ version: '4.9.0', channel: 'main' }));
	const homeClient = new ServerUpgradeClient(home.transport);
	const workClient = new ServerUpgradeClient(work.transport);
	await homeClient.subscribe();
	await workClient.subscribe();
	const homeSeen = [];
	const workSeen = [];
	homeClient.store.subscribe((next) => homeSeen.push(next));
	workClient.store.subscribe((next) => workSeen.push(next));

	home.publish(status({ available: { version: '5.2.0' } }));
	assert.deepEqual(homeClient.status.available, { version: '5.2.0' });
	assert.equal(workClient.status.available, undefined);
	assert.equal(workClient.status.version, '4.9.0');
	assert.equal(homeSeen.length, 1);
	assert.deepEqual(workSeen, []);

	// Starting one server's upgrade is sent to that server only.
	await homeClient.startServerUpgrade('in-place');
	assert.deepEqual(home.commands, [
		{
			operation: SERVER_UPGRADE_OPERATIONS.start,
			payload: { mode: 'in-place' },
		},
	]);
	assert.deepEqual(work.commands, []);
	assert.equal(homeClient.status.upgrade.state, 'in-progress');
	assert.deepEqual(workClient.status.upgrade, { state: 'none' });

	// Closing one leaves the other subscribed.
	homeClient.close();
	assert.equal(home.subscriptions, 0);
	assert.equal(work.subscriptions, 1);
	work.publish(
		status({
			version: '4.9.0',
			channel: 'main',
			available: { version: 'main-abc1234' },
		}),
	);
	assert.deepEqual(workClient.status.available, { version: 'main-abc1234' });
	assert.equal(homeClient.status.upgrade.state, 'in-progress');
	workClient.close();
});

test('the client subscribes before its snapshot, refreshes on a resync, and survives a bad publication', async () => {
	const server = fakeServer(status());
	const client = new ServerUpgradeClient(server.transport);
	const unsubscribe = await client.subscribe();
	assert.equal(
		await client.subscribe(),
		unsubscribe,
		'one subscription per client',
	);
	assert.equal(server.subscriptions, 1);
	assert.deepEqual(client.status, status());

	server.publish({ nonsense: true });
	assert.deepEqual(client.status, status());

	// A stream gap is answered with the server's current status.
	server.current = status({
		upgrade: { state: 'succeeded', from: '5.1.0', to: '5.1.1', at: 5_000 },
	});
	server.resync();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(client.status.upgrade.state, 'succeeded');
	unsubscribe();
	assert.equal(server.subscriptions, 0);
});

test("a refused upgrade rejects with the server's error and leaves the status alone", async () => {
	const server = fakeServer(status({ available: { version: '5.2.0' } }));
	const client = new ServerUpgradeClient(server.transport);
	await client.subscribe();
	server.refuse = Object.assign(
		new Error('a server upgrade is already in progress'),
		{ code: 'conflict', details: { reason: 'in-progress' } },
	);
	await assert.rejects(
		client.startServerUpgrade('in-place'),
		(error) => error.details.reason === 'in-progress',
	);
	assert.deepEqual(client.status.upgrade, { state: 'none' });
	client.close();
});
