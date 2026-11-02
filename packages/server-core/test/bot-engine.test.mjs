import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	BotEngine,
	botId,
	discoverSockets,
	EngineProcess,
	ownedResource,
	unixSocketPath,
	validateEnginePin,
} from '../dist/botService/index.js';
import { startBotSocketServer } from './fixtures/bot-socket-server.mjs';

async function fixture(t, options = {}, platform = 'linux') {
	const root = await mkdtemp(path.join(tmpdir(), 'bot-socket-test-'));
	const api = await startBotSocketServer(root, options);
	let pin;
	const env = {
		HOME: root,
		PATH: '/no/engine/cli',
		DOCKER_HOST: `unix://${api.socketPath}`,
	};
	const store = {
		load: async () => pin && validateEnginePin(JSON.parse(JSON.stringify(pin))),
		save: async (value) => {
			pin = value;
		},
	};
	const runner = new EngineProcess(env),
		engine = new BotEngine(store, runner, platform);
	t.after(async () => {
		engine.close();
		await api.close();
		await rm(root, { recursive: true, force: true });
	});
	return {
		api,
		engine,
		env,
		store,
		get pin() {
			return pin;
		},
	};
}

test('Docker and Podman sockets work with no host CLI; server kind and stable pin survive random info IDs and restarts', async (t) => {
	for (const kind of ['docker', 'podman'])
		await t.test(kind, async (t) => {
			const f = await fixture(t, { kind, randomID: true });
			assert.equal((await f.engine.discover())[0].details.pin.kind, kind);
			assert.equal(
				await f.api.read('volume', 'terminay-engine-identity'),
				undefined,
				'discovery does not mutate engine',
			);
			assert.equal((await f.engine.check(kind)).available, true);
			const identity = f.pin.identity;
			for (let i = 0; i < 4; i++)
				assert.equal((await f.engine.check()).available, true);
			assert.equal(f.pin.identity, identity);
			f.env.DOCKER_HOST = 'unix:///different/default.sock';
			assert.equal(
				(await f.engine.check()).available,
				true,
				'pin ignores changed default',
			);
			const restarted = new BotEngine(f.store, new EngineProcess(f.env));
			t.after(() => restarted.close());
			assert.equal((await restarted.check()).available, true);
			assert.equal(f.pin.identity, identity);
			assert.equal(
				await restarted.driver.inspect('image', 'missing'),
				undefined,
			);
		});
});
test('changed or removed marker blocks all bot operations until explicit reselection', async (t) => {
	const f = await fixture(t, { kind: 'podman' });
	await f.engine.check('podman');
	await f.api.put('volume', 'terminay-engine-identity', {
		Labels: { 'terminay.engine.identity': 'replacement' },
	});
	assert.deepEqual(await f.engine.check(), {
		available: false,
		reason: 'engine-changed',
	});
	assert.throws(() => f.engine.driver, /unavailable/);
	assert.equal((await f.engine.check('podman', true)).available, true);
	assert.equal(f.pin.identity, 'replacement');
	await rm(path.join(f.api.root, 'volume-terminay-engine-identity.json'));
	assert.deepEqual(await f.engine.check(), {
		available: false,
		reason: 'engine-changed',
	});
	assert.equal(
		await f.api.read('volume', 'terminay-engine-identity'),
		undefined,
		'never silently recreates a pinned marker',
	);
});
test('rootless capabilities and daemon-side socket URI normalization', async (t) => {
	const f = await fixture(
		t,
		{ kind: 'podman', rootless: true, controllers: ['cpu'] },
		'darwin',
	);
	const details = await f.engine.detect('podman');
	assert.equal(details.rootless, true);
	assert.equal(details.limitsEnforced, false);
	assert.equal(details.socketPath, '/run/podman/podman.sock');
	assert.equal(details.botUid, 1000);
	const docker = await fixture(t, { rootless: true });
	assert.deepEqual(await docker.engine.check('docker'), {
		available: false,
		reason: 'unsupported-engine-mode',
	});
});
test('refuses remote endpoints and unsupported platforms without contacting them', async (t) => {
	const f = await fixture(t);
	f.env.DOCKER_HOST = 'tcp://build-host:2375';
	assert.equal((await f.engine.discover())[0].reason, 'remote-engine');
	assert.equal(f.api.calls.length, 0);
	for (const endpoint of ['ssh://host', 'http://host', 'unix://host/socket'])
		assert.throws(() => unixSocketPath(endpoint), { code: 'remote-engine' });
	const windows = new BotEngine(f.store, new EngineProcess(f.env), 'win32');
	assert.equal((await windows.check('docker')).reason, 'unsupported-platform');
});
test('Unix socket aliases are deduplicated and selected Docker context metadata is respected', async (t) => {
	const f = await fixture(t);
	delete f.env.DOCKER_HOST;
	await mkdir(path.join(f.env.HOME, '.docker/run'), { recursive: true });
	await symlink(
		f.api.socketPath,
		path.join(f.env.HOME, '.docker/run/docker.sock'),
	);
	// Explicit context takes precedence over DOCKER_HOST, like Docker does.
	const meta = path.join(f.env.HOME, '.docker/contexts/meta/hash');
	await mkdir(meta, { recursive: true });
	await writeFile(
		path.join(meta, 'meta.json'),
		JSON.stringify({
			Name: 'selected',
			Endpoints: { docker: { Host: `unix://${f.api.socketPath}` } },
		}),
	);
	f.env.DOCKER_CONTEXT = 'selected';
	f.env.DOCKER_HOST = 'tcp://ignored:2375';
	assert.deepEqual(await discoverSockets(f.env, 'linux'), [
		{ address: `unix://${f.api.socketPath}` },
	]);
	f.env.DOCKER_CONTEXT = 'missing';
	assert.equal((await f.engine.discover())[0].reason, 'not-running');
});
test('old CLI pins require explicit reselection and valid versioned pins preserve their version', async (t) => {
	const f = await fixture(t);
	await f.store.save({
		kind: 'docker',
		address: 'unix:///old',
		identity: 'old',
		connection: false,
	});
	assert.equal((await f.engine.check()).reason, 'engine-changed');
	assert.equal((await f.engine.check('docker', true)).available, true);
	assert.equal(f.pin.version, 2);
	assert.throws(() => validateEnginePin({ ...f.pin, address: 'tcp://host' }));
});
test('ownership requires server, bot and managed labels; bot uid never root', () => {
	const labels = {
		'terminay.server': 'server',
		'terminay.bot': 'bot',
		'terminay.managed': '1',
	};
	for (const value of [
		{ Labels: labels },
		{ Config: { Labels: labels } },
		{ labels },
	])
		assert.equal(ownedResource(value, 'server', 'bot'), true);
	assert.equal(ownedResource({ Labels: labels }, 'other', 'bot'), false);
	assert.equal(ownedResource({ Labels: labels }, 'server', 'other'), false);
	assert.equal(botId(1001), 1001);
	assert.equal(botId(0), 1000);
	assert.equal(botId(undefined), 1000);
});

test('explicit local Podman machine connections are verified from metadata and never sent over SSH', async (t) => {
	const f = await fixture(t, { kind: 'podman', rootless: true });
	delete f.env.DOCKER_HOST;
	f.env.CONTAINER_CONNECTION = 'local';
	const runner = {
		run: async (_exe, args) =>
			JSON.stringify(
				args[0] === 'system'
					? [
							{
								Name: 'local',
								URI: 'ssh://core@localhost:12345/run/user/1000/podman/podman.sock',
							},
						]
					: args[1] === 'list'
						? [{ Name: 'local', Running: true }]
						: [
								{
									Rootful: false,
									SSHConfig: { Port: 12345 },
									ConnectionInfo: { PodmanSocket: { Path: f.api.socketPath } },
								},
							],
			),
	};
	assert.deepEqual(await discoverSockets(f.env, 'darwin', runner), [
		{ address: `unix://${f.api.socketPath}` },
	]);
	runner.run = async () =>
		JSON.stringify([{ Name: 'local', URI: 'ssh://core@remote:12345/socket' }]);
	await assert.rejects(discoverSockets(f.env, 'darwin', runner), {
		code: 'remote-engine',
	});
});

test('an existing native Podman machine pin upgrades only after its local connection and old identity match', async (t) => {
	const f = await fixture(t, { kind: 'podman' });
	const runner = new EngineProcess(f.env);
	runner.run = async (_exe, args) =>
		JSON.stringify(
			args[0] === 'system'
				? [
						{
							Name: 'local-root',
							URI: 'ssh://root@localhost:12345/run/podman/podman.sock',
						},
					]
				: args[1] === 'list'
					? [{ Name: 'local', Running: true }]
					: [
							{
								Rootful: true,
								SSHConfig: { Port: 12345 },
								ConnectionInfo: { PodmanSocket: { Path: f.api.socketPath } },
							},
						],
		);
	const engine = new BotEngine(f.store, runner, 'darwin');
	t.after(() => engine.close());
	await f.store.save({
		kind: 'podman',
		address: 'local-root',
		connection: true,
		identity: 'local-root:local:localhost.localdomain',
	});
	assert.equal((await engine.check()).available, true);
	assert.equal(f.pin.version, 2);
	assert.equal(f.pin.address, `unix://${f.api.socketPath}`);
	assert.equal((await engine.check()).available, true);
	await f.store.save({
		kind: 'podman',
		address: 'local-root',
		connection: true,
		identity: 'local-root:local:different-machine',
	});
	assert.equal((await engine.check()).reason, 'engine-changed');
});

test('a Docker CLI pin upgrades only when the server is Docker and its previous stable ID matches', async (t) => {
	const f = await fixture(t);
	await f.store.save({
		kind: 'docker',
		address: `unix://${f.api.socketPath}`,
		connection: false,
		identity: 'fake-bot-engine',
	});
	assert.equal((await f.engine.check()).available, true);
	assert.equal(f.pin.version, 2);
	const podman = await fixture(t, { kind: 'podman', randomID: true });
	await podman.store.save({
		kind: 'docker',
		address: `unix://${podman.api.socketPath}`,
		connection: false,
		identity: 'random-compat-id',
	});
	assert.equal((await podman.engine.check()).reason, 'engine-changed');
});
