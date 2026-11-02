import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { BotEngine } from '../dist/botService/index.js';
import { BotShellService, createNodePtyFactory } from '../dist/index.js';

const id = 'abc123def456';
function authority(controller = new AbortController()) {
	return {
		connectionId: 'c',
		clientId: 'client',
		authScope: 'write',
		signal: controller.signal,
		assertCurrent: () => {},
	};
}
test('4.10 shell uses privileged PTY host, pinned engine, root supervisor and bot home; resize and revocation reach process', async () => {
	let spawned, data, exit;
	const writes = [],
		sizes = [],
		kills = [],
		commands = [],
		activity = [];
	const pty = {
		write: (bytes) => writes.push(Buffer.from(bytes).toString()),
		resize: (d) => sizes.push(d),
		kill: (s) => kills.push(s),
		onData: (fn) => {
			data = fn;
			return () => {
				data = undefined;
			};
		},
		onExit: (fn) => {
			exit = fn;
			return () => {
				exit = undefined;
			};
		},
	};
	const driver = {
		details: {
			pin: {
				kind: 'podman',
				address: 'unix:///run/podman/podman.sock',
				connection: false,
			},
		},
		exec: async (...a) => commands.push(a),
	};
	const service = new BotShellService({
		engine: async () => driver,
		start: async () => {},
		pty: {
			spawn: async (options) => {
				spawned = options;
				return pty;
			},
		},
		cwd: '/tmp',
		environment: { PATH: process.env.PATH },
		activity: (_id, delta) => activity.push(delta),
	});
	const controller = new AbortController(),
		output = [];
	const shell = await service.open(
		authority(controller),
		id,
		1,
		{ cols: 80, rows: 24 },
		(b) => output.push(Buffer.from(b).toString()),
		() => {},
	);
	assert.deepEqual(spawned.args.slice(0, 9), [
		'--url',
		'unix:///run/podman/podman.sock',
		'exec',
		'-it',
		'-u',
		'root',
		'-w',
		'/home/bot',
		`terminay-bot-${id}`,
	]);
	assert.ok(spawned.args.includes('terminay-run'));
	assert.equal(spawned.shellPath, 'podman');
	await shell.write(Buffer.from('whoami\r'));
	data(Buffer.from('bot\r\n'));
	assert.deepEqual(output, ['bot\r\n']);
	assert.deepEqual(writes, ['whoami\r']);
	await shell.resize({ cols: 100, rows: 40 });
	assert.deepEqual(sizes, [{ cols: 100, rows: 40 }]);
	await assert.rejects(shell.resize({ cols: 0, rows: 40 }));
	controller.abort();
	await shell.close();
	assert.ok(commands[0][1].includes('--kill'));
	assert.equal(kills[0], 'SIGKILL');
	assert.equal(data, undefined);
	assert.equal(exit, undefined);
	assert.deepEqual(activity, [1, -1]);
	await assert.rejects(shell.write(Buffer.from('late')));
	await assert.rejects(
		service.open(
			authority(),
			id,
			1,
			{ cols: 80, rows: 24 },
			() => {},
			() => {},
		),
		/stale/,
	);
	await service.close();
});
const real = process.env.TERMINAY_BOT_INTEGRATION_ENGINE;
test('4.10 opt-in real PTY whoami, resize and shell process teardown', {
	skip: !real,
	timeout: 60_000,
}, async (t) => {
	assert.ok(['docker', 'podman'].includes(real));
	const { default: nodePty } = await import('node-pty');
	const name = `terminay-bot-${id}`;
	const run = (args, options = {}) => {
		const r = spawnSync(real, args, {
			encoding: 'utf8',
			timeout: 45_000,
			...options,
		});
		assert.equal(r.status, 0, r.stderr);
		return r.stdout;
	};
	const inspect = spawnSync(real, ['container', 'inspect', name], {
		encoding: 'utf8',
	});
	assert.notEqual(
		inspect.status,
		0,
		'integration bot id must not already exist',
	);
	t.after(() => spawnSync(real, ['rm', '-f', name], { timeout: 15_000 }));
	run(['run', '-d', '--pull', 'never', '--name', name, 'terminay-bot:local']);
	run(['exec', '-i', '-u', 'root', name, 'terminay-init', '--bootstrap'], {
		input: JSON.stringify({ botId: id, vncPassword: 'fake-pass' }),
	});
	const engine = new BotEngine({
		load: async () => undefined,
		save: async () => {},
	});
	t.after(() => engine.close());
	assert.equal((await engine.check(real)).available, true);
	const service = new BotShellService({
		engine: async () => engine.driver,
		start: async () => {},
		pty: createNodePtyFactory(nodePty),
		cwd: process.cwd(),
		environment: process.env,
		activity: () => {},
	});
	t.after(() => service.close());
	let text = '',
		resolve;
	const wait = new Promise((r) => (resolve = r));
	const shell = await service.open(
		authority(),
		id,
		1,
		{ cols: 80, rows: 24 },
		(b) => {
			text += Buffer.from(b).toString();
			if (text.includes('PROBE:bot:40 100')) resolve();
		},
		() => {},
	);
	await shell.resize({ cols: 100, rows: 40 });
	await shell.write(
		Buffer.from('printf \'PROBE:%s:%s\\n\' "$(whoami)" "$(stty size)"\r'),
	);
	await wait;
	await shell.close();
	const processes = run(['exec', '-u', 'root', name, 'ps', '-eo', 'args']);
	assert.ok(!processes.includes('/bin/bash -i'));
});
