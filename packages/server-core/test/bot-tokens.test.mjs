import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import {
	BotTokenRedactor,
	BotTokenService,
	DockerDriver,
	EngineProcess,
} from '../dist/botService/index.js';

const id = 'abc123def456',
	declaration = {
		environmentVariable: 'CODEX_API_KEY',
		authenticateMethodId: 'api-key',
		kind: 'api-key',
		label: 'key',
		help: 'fake',
	};
function vault() {
	const entries = new Map();
	return {
		entries,
		status: () => ({ entries: [...entries.keys()].map((id) => ({ id })) }),
		put: async ({ id, value }) => entries.set(id, Buffer.from(value)),
		replace: async ({ id, value }) => entries.set(id, Buffer.from(value)),
		remove: async (id) => entries.delete(id),
		withSecret: async (id, fn) => {
			if (!entries.has(id)) throw Error('missing');
			const v = Buffer.from(entries.get(id));
			try {
				return await fn(v);
			} finally {
				v.fill(0);
			}
		},
	};
}
test('4.6 bot-owned vault entries, explicit copying, ACP method hook and last-lease memory release', async () => {
	const v = vault(),
		service = new BotTokenService(v);
	const input = Buffer.from('fake-secret');
	await service.save(id, 'CODEX_API_KEY', input);
	assert.ok(input.every((b) => b === 0));
	await assert.rejects(
		service.acquire('def123abc456', [declaration]),
		/unavailable/,
	);
	await service.copy(id, 'def123abc456', 'CODEX_API_KEY');
	const a = await service.acquire(id, [declaration]),
		b = await service.acquire(id, [declaration]);
	assert.equal(service.retainedCount(id), 1);
	const calls = [];
	await a.authenticate(async (params) => calls.push(params));
	assert.deepEqual(calls, [{ methodId: 'api-key' }]);
	let transient;
	await a.withEnvironment(async (env) => {
		transient = env;
		assert.equal(env.CODEX_API_KEY, 'fake-secret');
	});
	assert.deepEqual(transient, {});
	const r = a.redactor();
	a.release();
	assert.equal(service.retainedCount(id), 1);
	assert.throws(() => r.push('test'), /closed/);
	b.release();
	assert.equal(service.retainedCount(id), 0);
	await assert.rejects(
		a.withEnvironment(() => {}),
		/closed/,
	);
	const copy = await service.acquire('def123abc456', [declaration]);
	await copy.withEnvironment(async (env) =>
		assert.equal(env.CODEX_API_KEY, 'fake-secret'),
	);
	copy.release();
});
test('4.6 client environment carries token while argv names only -e NAME', async () => {
	const service = new BotTokenService(vault());
	await service.save(id, 'CODEX_API_KEY', Buffer.from('fake-secret'));
	const lease = await service.acquire(id, [declaration]);
	let observed;
	const runner = new EngineProcess({ PATH: process.env.PATH });
	runner.stream = (_executable, args, options) => {
		observed = { args, env: options.env };
		return spawn(
			process.execPath,
			['-e', 'process.stdout.write(process.env.CODEX_API_KEY)'],
			{ env: options.env, stdio: ['pipe', 'pipe', 'pipe'] },
		);
	};
	const driver = new DockerDriver(
		{ pin: { kind: 'docker', address: 'unix:///fake', connection: false } },
		runner,
	);
	let child;
	await lease.withEnvironment(async (env) => {
		child = driver.execStream('bot', ['fake-acp'], {
			env,
			environmentNames: lease.environmentNames,
		});
	});
	assert.ok(!observed.args.some((a) => a.includes('fake-secret')));
	assert.ok(observed.args.includes('CODEX_API_KEY'));
	assert.ok(!observed.args.includes('CODEX_API_KEY=fake-secret'));
	let output = '';
	child.stdout.on('data', (b) => (output += b));
	child.stdin.end();
	await once(child, 'close');
	assert.equal(output, 'fake-secret');
	lease.release();
});
test('4.6 redacts every split, byte-fragmented UTF-8 and secrets sharing prefixes before output', () => {
	const secret = 'secret-🔐-fake';
	const bytes = Buffer.from(`before ${secret} after ${secret}`);
	for (let split = 0; split <= bytes.length; split++) {
		const r = new BotTokenRedactor([secret]);
		const output = Buffer.concat([
			r.push(bytes.subarray(0, split)),
			r.push(bytes.subarray(split)),
			r.finish(),
		]).toString();
		assert.equal(output, 'before [redacted] after [redacted]');
	}
	const r = new BotTokenRedactor(['abc', 'abcdef']);
	const chunks = [];
	for (const b of Buffer.from('abcdef abc'))
		chunks.push(r.push(Buffer.from([b])));
	chunks.push(r.finish());
	assert.equal(Buffer.concat(chunks).toString(), '[redacted] [redacted]');
});

test('4.6 separate log channels redact split tokens even when stderr interleaves', async () => {
	const { BotLogTail } = await import('../dist/botService/index.js');
	const tail = new BotLogTail(['fake-secret']);
	tail.push('key=fake-', 'stdout');
	tail.push('unrelated error\n', 'stderr');
	tail.push('secret\n', 'stdout');
	const output = tail.finish();
	assert.ok(output.includes('key=[redacted]'));
	assert.ok(!output.includes('fake-'));
	assert.ok(output.includes('unrela'));
	assert.ok(output.includes('ted error'));
});
