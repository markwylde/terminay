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
test('4.10 socket TTY resize, supervision, activity and revocation', async () => {
	const { SocketProcess } = await import('../dist/botService/index.js');
	const child = new SocketProcess(),
		commands = [],
		activity = [],
		sizes = [],
		output = [],
		writes = [];
	child.stdin.on('data', (bytes) => writes.push(bytes.toString()));
	child.resizeHandler = async (cols, rows) => sizes.push({ cols, rows });
	let call;
	const driver = {
		execStream: (...args) => {
			call = args;
			return child;
		},
		exec: async (...args) => commands.push(args),
	};
	const service = new BotShellService({
		engine: async () => driver,
		start: async () => {},
		activity: (_id, delta) => activity.push(delta),
	});
	const controller = new AbortController();
	const shell = await service.open(
		authority(controller),
		id,
		1,
		{ cols: 80, rows: 24 },
		(bytes) => output.push(Buffer.from(bytes).toString()),
		() => {},
	);
	child.emit('ready');
	assert.equal(call[0], `terminay-bot-${id}`);
	assert.equal(call[1][0], 'terminay-run');
	assert.equal(call[2].tty, true);
	assert.equal(call[2].user, 'root');
	await shell.write(Buffer.from('whoami\r'));
	child.stdout.write('bot\r\n');
	assert.deepEqual(writes, ['whoami\r']);
	assert.deepEqual(output, ['bot\r\n']);
	await shell.resize({ cols: 100, rows: 40 });
	assert.deepEqual(sizes.at(-1), { cols: 100, rows: 40 });
	await assert.rejects(shell.resize({ cols: 0, rows: 40 }));
	controller.abort();
	await shell.close();
	assert.ok(commands[0][1].includes('--kill'));
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
