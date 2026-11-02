import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	BotEngine,
	botId,
	EngineProcess,
	ownedResource,
	validateEnginePin,
} from '../dist/botService/index.js';

async function fixture(t, config = {}, platform = 'linux') {
	const directory = await mkdtemp(path.join(tmpdir(), 'bot-engine-'));
	const script = await readFile(
		new URL('./fixtures/bot-engine.mjs', import.meta.url),
		'utf8',
	);
	for (const name of ['docker', 'podman']) {
		await writeFile(
			path.join(directory, name),
			`#!${process.execPath}\n${script}`,
		);
		await chmod(path.join(directory, name), 0o755);
	}
	const configPath = path.join(directory, 'config.json');
	await writeFile(configPath, JSON.stringify(config));
	const callsPath = path.join(directory, 'calls.jsonl');
	let pin;
	const runner = new EngineProcess({
		...process.env,
		PATH: directory,
		BOT_ENGINE_CONFIG: configPath,
		BOT_ENGINE_CALLS: callsPath,
		XDG_RUNTIME_DIR: '/run/user/1234',
		CONTAINER_HOST: config.containerHost,
		CONTAINER_CONNECTION: undefined,
		DOCKER_HOST: undefined,
	});
	const engine = new BotEngine(
		{
			// `roundTrip` reads the pin back as the composed store does, from JSON
			// through its validator.
			load: async () =>
				pin && config.roundTrip
					? validateEnginePin(JSON.parse(JSON.stringify(pin)))
					: pin,
			save: async (value) => {
				pin = value;
			},
		},
		runner,
		platform,
	);
	t.after(async () => {
		engine.close();
		await rm(directory, { recursive: true, force: true });
	});
	return {
		engine,
		runner,
		directory,
		get pin() {
			return pin;
		},
		update: (value) => writeFile(configPath, JSON.stringify(value)),
		calls: async () =>
			(await readFile(callsPath, 'utf8')).trim().split('\n').map(JSON.parse),
	};
}

test('4.1 detects Docker and Podman shim, pins calls despite default context switches', async (t) => {
	for (const shim of [false, true])
		await t.test(String(shim), async (t) => {
			const f = await fixture(t, {
				shim,
				connections: [
					{ Name: 'local', URI: 'unix:///fake/podman.sock', Default: true },
				],
			});
			const connecting = once(f.engine, 'container-event');
			assert.equal((await f.engine.check('docker')).available, true);
			await connecting;
			assert.equal(f.pin.kind, shim ? 'podman' : 'docker');
			const driver = f.engine.driver;
			await driver.run(['echo', '$(never execute); space']);
			await driver.exec('container', ['whoami']);
			await driver.inspect('container', 'missing');
			const connectedAgain = once(f.engine, 'container-event');
			await f.update({
				shim,
				endpoint: 'unix:///different.sock',
				connections: [{ Name: 'local', URI: 'unix:///fake/podman.sock' }],
			});
			assert.equal((await f.engine.check()).available, true);
			await connectedAgain;
			const calls = await f.calls();
			const pinned = calls.filter(
				({ executable, args }) =>
					executable === f.pin.kind &&
					['--host', '--connection', '--url'].includes(args[0]),
			);
			assert.ok(pinned.length >= 6);
			assert.ok(pinned.every(({ args }) => args[1] === f.pin.address));
			assert.deepEqual(
				pinned.find(({ args }) => args[2] === 'echo').args.slice(3),
				['$(never execute); space'],
			);
		});
});

test('4.1 refuses Windows, remote SSH/TCP, rootless Docker and reports unavailable reasons', async (t) => {
	const cases = [
		['docker', {}, 'win32', 'unsupported-platform'],
		[
			'podman',
			{ containerHost: 'unix:///forwarded/podman.sock' },
			'darwin',
			'unsupported-engine-mode',
		],
		['docker', { endpoint: 'tcp://host:2375' }, 'linux', 'remote-engine'],
		['docker', { endpoint: 'ssh://build-host' }, 'linux', 'remote-engine'],
		['docker', { rootless: true }, 'linux', 'unsupported-engine-mode'],
		[
			'docker',
			{ infoFailure: 'permission denied' },
			'linux',
			'permission-denied',
		],
		['docker', { infoFailure: 'Cannot connect' }, 'linux', 'not-running'],
		[
			'podman',
			{
				connections: [
					{ Name: 'remote', URI: 'ssh://build-host', Default: true },
				],
			},
			'linux',
			'remote-engine',
		],
		[
			'podman',
			{
				connections: [
					{
						Name: 'machine-root',
						URI: 'ssh://127.0.0.1:9999/run/podman/podman.sock',
						Default: true,
					},
				],
				machines: [{ Name: 'machine' }],
			},
			'darwin',
			'remote-engine',
		],
	];
	for (const [kind, config, platform, reason] of cases)
		await t.test(reason + JSON.stringify(config), async (t) => {
			const f = await fixture(t, config, platform);
			assert.deepEqual(await f.engine.check(kind), {
				available: false,
				reason,
			});
		});
	const f = await fixture(t);
	await rm(path.join(f.directory, 'docker'));
	assert.deepEqual(await f.engine.check('docker'), {
		available: false,
		reason: 'not-installed',
	});
});

test('4.1 detects local macOS machine and rootless Podman with limit and uid metadata', async (t) => {
	const f = await fixture(
		t,
		{
			rootless: true,
			connections: [
				{
					Name: 'podman-machine-default',
					URI: 'ssh://core@127.0.0.1:4321/run/user/1000/podman/podman.sock',
					Default: true,
				},
			],
			machines: [{ Name: 'podman-machine-default', Running: true }],
			socket: '/run/user/1000/podman/podman.sock',
		},
		'darwin',
	);
	const details = await f.engine.detect('podman');
	assert.equal(details.rootless, true);
	assert.equal(details.limitsEnforced, true);
	assert.equal(details.socketPath, '/run/user/1000/podman/podman.sock');
	assert.equal(details.pin.connection, true);
	assert.equal(details.botUid, 1000);
	await f.update({
		rootless: true,
		cgroups: 'v1',
		connections: [
			{
				Name: 'local',
				URI: 'unix:///run/user/501/podman/podman.sock',
				Default: true,
			},
		],
		socket: '/run/user/501/podman/podman.sock',
	});
	const native = await f.engine.detect('podman');
	assert.equal(native.limitsEnforced, false);
	assert.equal(native.pin.address, 'local');
	await f.update({});
	await assert.rejects(f.engine.detect('podman'), /engine address missing/);
});

test('4.1 a pin read back from disk after a restart still matches its engine', async (t) => {
	const f = await fixture(t, { roundTrip: true });
	assert.equal((await f.engine.check('docker')).available, true);
	assert.equal((await f.engine.check()).available, true);
});

test('4.1 changed identity blocks actions until explicit adoption; stream ending is unavailable', async (t) => {
	const f = await fixture(t);
	let connected = once(f.engine, 'container-event');
	await f.engine.check('docker');
	await connected;
	await f.update({ identity: 'replacement' });
	assert.deepEqual(await f.engine.check(), {
		available: false,
		reason: 'engine-changed',
	});
	assert.throws(() => f.engine.driver, /unavailable/);
	connected = once(f.engine, 'container-event');
	assert.equal((await f.engine.check('docker', true)).available, true);
	await connected;
	const event = once(f.engine, 'container-event');
	await f.update({ identity: 'replacement', event: { Type: 'container' } });
	assert.deepEqual((await event)[0], { Type: 'container' });
	const changed = once(f.engine, 'availability');
	await f.update({ identity: 'replacement', eventsEnd: true });
	assert.deepEqual((await changed)[0], {
		available: false,
		reason: 'not-running',
	});
	assert.equal(
		ownedResource(
			{
				Config: {
					Labels: {
						'terminay.bot': 'abc123def456',
						'terminay.server': 'other',
						'terminay.managed': '1',
					},
				},
			},
			'server',
			'abc123def456',
		),
		false,
	);
	assert.equal(
		ownedResource(
			{
				Labels: {
					'terminay.bot': 'abc123def456',
					'terminay.server': 'server',
					'terminay.managed': '1',
				},
			},
			'server',
			'abc123def456',
		),
		true,
	);
	// Podman's `network inspect` reports lowercase keys.
	assert.equal(
		ownedResource(
			{
				labels: {
					'terminay.bot': 'abc123def456',
					'terminay.server': 'server',
					'terminay.managed': '1',
				},
			},
			'server',
			'abc123def456',
		),
		true,
	);
});

test('4.1 command deadlines kill a CLI that ignores SIGTERM, output is bounded, exec/events always address pin', async (t) => {
	const f = await fixture(t);
	const connected = once(f.engine, 'container-event');
	await f.engine.check('docker');
	await connected;
	await assert.rejects(f.engine.driver.run(['hang'], { deadlineMs: 100 }), {
		code: 'deadline',
	});
	await assert.rejects(f.engine.driver.run(['overflow'], { maxBytes: 128 }), {
		code: 'output-limit',
	});
	const stream = f.engine.driver.execStream('c', ['cat'], { tty: true });
	stream.stdin.end();
	await once(stream, 'close');
	const call = (await f.calls()).at(-1);
	assert.deepEqual(call.args.slice(0, 4), [
		'--host',
		f.pin.address,
		'exec',
		'-i',
	]);
	assert.ok(call.args.includes('-t'));
});

test('4.1 native Linux Podman pins an explicit socket URL on every operation', async (t) => {
	for (const rootless of [false, true]) {
		const socket = rootless
			? '/run/user/1234/podman/podman.sock'
			: '/run/podman/podman.sock';
		const f = await fixture(t, {
			rootless,
			socket,
			containerHost: `unix://${socket}`,
		});
		const ready = once(f.engine, 'container-event');
		assert.equal((await f.engine.check('podman')).available, true);
		await ready;
		assert.equal(f.pin.connection, false);
		assert.equal(f.pin.address, `unix://${socket}`);
		await f.engine.driver.run(['echo', 'hello']);
		await f.engine.driver.exec('c', ['true']);
		const child = f.engine.driver.execStream('c', ['true']);
		child.stdin.end();
		await once(child, 'close');
		await f.update({
			connections: [
				{ Name: 'changed-default', URI: 'unix:///elsewhere', Default: true },
			],
			rootless,
			socket,
		});
		assert.equal((await f.engine.check()).available, true);
		const calls = (await f.calls()).filter(
			({ args }) => !['system', 'machine'].includes(args[0]),
		);
		assert.ok(
			calls.every(
				({ args }) => args[0] === '--url' && args[1] === `unix://${socket}`,
			),
		);
	}
	const f = await fixture(t);
	const details = await f.engine.detect('podman');
	assert.equal(details.pin.connection, false);
	assert.equal(
		details.pin.address,
		process.getuid() === 0
			? 'unix:///run/podman/podman.sock'
			: 'unix:///run/user/1234/podman/podman.sock',
	);
});

test('the bot runs as the server account on Linux, but never as root', () => {
	assert.equal(botId(1001), 1001);
	assert.equal(botId(0), 1000);
	assert.equal(botId(undefined), 1000);
});
