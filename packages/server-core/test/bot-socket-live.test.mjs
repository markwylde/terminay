import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BotEngine, EngineProcess } from '../dist/botService/index.js';

const endpoint = process.env.TERMINAY_BOT_SOCKET_SMOKE;
test('real socket: build, lifecycle, binary exec, TTY resize, stats, logs and shared socket', {
	skip: !endpoint,
	timeout: 180000,
}, async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), 'socket-live-'));
	let pin;
	const engine = new BotEngine(
		{
			load: async () => pin,
			save: async (p) => {
				pin = p;
			},
		},
		new EngineProcess({
			...process.env,
			DOCKER_CONTEXT: '',
			DOCKER_HOST: endpoint,
			PATH: '/no/host/clis',
		}),
	);
	t.after(async () => {
		engine.close();
		await rm(directory, { recursive: true, force: true });
	});
	const candidates = await engine.discover();
	const candidate = candidates.find((c) => c.available);
	assert.ok(candidate, JSON.stringify(candidates));
	assert.equal(
		(await engine.check(candidate.details.pin.kind)).available,
		true,
	);
	assert.equal((await engine.check()).available, true);
	const driver = engine.driver,
		suffix = randomBytes(6).toString('hex'),
		name = `terminay-socket-smoke-${suffix}`,
		tag = `terminay-socket-smoke:${suffix}`;
	const base =
		process.env.TERMINAY_BOT_SOCKET_BASE_IMAGE ?? 'terminay-bot:local';
	await writeFile(
		path.join(directory, 'Dockerfile'),
		`FROM ${base}\nRUN mkdir -p /home/bot\nLABEL terminay.socket-smoke="${suffix}"\n`,
	);
	const progress = [];
	t.after(async () => {
		await driver.run(['container', 'rm', '-f', name]).catch(() => {});
		await driver.run(['image', 'rm', tag]).catch(() => {});
	});
	await driver.run(['build', '--tag', tag, directory], {
		onOutput: (c) => progress.push(c),
		deadlineMs: 120000,
	});
	assert.ok(progress.length);
	assert.equal(
		(await driver.inspect('image', tag)).Config.Labels['terminay.socket-smoke'],
		suffix,
	);
	const socketGroup = (
		await driver.run([
			'run',
			'--rm',
			'--pull',
			'never',
			'--network',
			'none',
			'--user',
			'root',
			'--security-opt',
			'label=disable',
			'--mount',
			`type=bind,source=${driver.details.socketPath},target=/run/engine.sock,readonly`,
			'--entrypoint',
			'stat',
			tag,
			'-c',
			'%g',
			'/run/engine.sock',
		])
	).trim();
	assert.match(socketGroup, /^\d+$/);
	const create = [
		'container',
		'create',
		'--name',
		name,
		'--network',
		'none',
		'--cpus',
		'0.5',
		'--memory',
		'134217728',
		'--pids-limit',
		'32',
		'--group-add',
		socketGroup,
		'--security-opt',
		'label=disable',
		'--mount',
		`type=bind,source=${driver.details.socketPath},target=/run/engine.sock`,
		'--entrypoint',
		'sleep',
		tag,
		'120',
	];
	await driver.run(create);
	await driver.run(['container', 'start', name]);
	assert.equal((await driver.inspect('container', name)).State.Running, true);
	t.diagnostic('container started; checking exec');
	assert.match(
		await driver.exec(name, ['id'], {
			user: 'root',
			onOutput: (text) => t.diagnostic(text),
		}),
		/uid=0/,
	);
	assert.equal(
		await driver.exec(name, ['cat'], {
			user: 'root',
			input: 'socket-🔐-roundtrip\n',
		}),
		'socket-🔐-roundtrip\n',
	);
	for (let i = 0; i < 10; i++)
		assert.match(await driver.exec(name, ['id'], { user: 'root' }), /uid=0/);
	t.diagnostic('stdin roundtrip passed; checking TTY');
	const child = driver.execStream(name, ['sh', '-c', 'read line; stty size'], {
		tty: true,
		user: 'root',
	});
	let tty = '';
	child.stdout.on('data', (b) => (tty += b));
	child.stderr.resume();
	await child.resize(100, 40);
	const closed = once(child, 'close');
	child.stdin.write('go\n');
	assert.equal((await closed)[0], 0);
	assert.match(tty, /40 100/);
	assert.match(
		await driver.exec(name, ['stat', '-c', '%g', '/run/engine.sock'], {
			user: 'root',
		}),
		/^\d+/,
	);
	const socketUser = base === 'terminay-bot:local' ? 'bot' : 'nobody';
	for (const permission of ['-S', '-r', '-w'])
		await driver.exec(name, ['test', permission, '/run/engine.sock'], {
			user: socketUser,
		});
	if (base === 'terminay-bot:local')
		assert.match(
			await driver.exec(
				name,
				[
					'docker',
					'--host',
					'unix:///run/engine.sock',
					'version',
					'--format',
					'{{.Server.Version}}',
				],
				{ user: 'bot' },
			),
			/\d+\.\d+/,
		);
	const usage = JSON.parse(
		await driver.run(['stats', '--no-stream', '--format', 'json', name]),
	);
	assert.ok(usage.MemUsageBytes >= 0);
	await driver.run(['logs', name], { tail: true, maxBytes: 1024 });
	await driver.run(['container', 'stop', name]);
	assert.equal((await driver.inspect('container', name)).State.Running, false);
});
