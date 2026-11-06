import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BotBlockedError,
	BotImageBuildError,
	botProcessCount,
	classifyProcessFailure,
	EngineCommandError,
	showsProcessCreationFailure,
	SocketDriver,
} from '../dist/botService/index.js';
import { botFailureCause } from '../dist/botService/failure.js';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

test('EAGAIN classifier recognises process and thread creation failures', () => {
	for (const text of [
		"Error: spawn /usr/local/lib/node_modules/@openai/codex/bin/codex EAGAIN\n    at ChildProcess._handle.onexit",
		'bash: fork: Resource temporarily unavailable',
		'node[12855]: pthread_create: Resource temporarily unavailable',
		'OCI runtime exec failed: exec failed: unable to start container process: resource temporarily unavailable',
	])
		assert.equal(showsProcessCreationFailure(text), true, text);
	for (const text of [
		'EAGAIN on read from socket',
		'The native agent could not complete the request.',
		'Resource temporarily unavailable (os error 11) while locking file',
	])
		assert.equal(showsProcessCreationFailure(text), false, text);
});

test('process exhaustion is claimed only with engine evidence near the limit', async () => {
	const text = 'Error: spawn codex EAGAIN';
	assert.deepEqual(
		await classifyProcessFailure(text, async () => ({ current: 1013, limit: 1024 })),
		{
			reason:
				'The bot container has run out of processes (1013 of 1024). Restart the bot container.',
			cause: 'processes',
		},
	);
	for (const count of [null, { current: 200, limit: 1024 }])
		assert.deepEqual(await classifyProcessFailure(text, async () => count), {
			reason: 'The agent could not start a process (EAGAIN).',
			cause: null,
		});
	assert.equal(
		await classifyProcessFailure('ordinary failure', async () => {
			throw new Error('stats must not be read');
		}),
		null,
	);
});

test('engine stats give the process count and limit, or nothing', async () => {
	const driver = (value) => ({
		run: async (args) => {
			assert.deepEqual(args, ['stats', '--no-stream', '--format', 'json', 'c']);
			if (value instanceof Error) throw value;
			return JSON.stringify(value);
		},
	});
	assert.deepEqual(await botProcessCount(driver({ PIDs: 1013, PidsLimit: 1024 }), 'c'), {
		current: 1013,
		limit: 1024,
	});
	assert.equal(await botProcessCount(driver({ PIDs: 5, PidsLimit: null }), 'c'), null);
	assert.equal(await botProcessCount(driver({ MemUsageBytes: 1 }), 'c'), null);
	assert.equal(await botProcessCount(driver(new Error('engine down')), 'c'), null);
});

test('the socket driver reports the engine process count and limit from one-shot stats', async () => {
	const routes = [];
	const driver = (pids_stats) =>
		new SocketDriver(
			{ pin: { kind: 'docker', address: 'unix:///fake', connection: false } },
			{
				json: async (method, route) => {
					routes.push(`${method} ${route}`);
					return { cpu_stats: {}, memory_stats: { usage: 5 }, pids_stats };
				},
			},
		);
	const stats = (d) => d.run(['stats', '--no-stream', '--format', 'json', 'terminay-bot-x']);
	assert.deepEqual(
		await botProcessCount(driver({ current: 1013, limit: 1024 }), 'terminay-bot-x'),
		{ current: 1013, limit: 1024 },
	);
	assert.equal(JSON.parse(await stats(driver(undefined))).PIDs, null);
	assert.deepEqual(routes, [
		'GET /containers/terminay-bot-x/stats?stream=false',
		'GET /containers/terminay-bot-x/stats?stream=false',
	]);
});

test('structured causes come from error types, never message text', () => {
	assert.equal(botFailureCause(new BotBlockedError('disabled', 'x')), 'disabled');
	assert.equal(botFailureCause(new BotBlockedError('agent', 'x')), 'agent');
	assert.equal(botFailureCause(new BotImageBuildError()), 'image');
	assert.equal(botFailureCause(new EngineCommandError('not-running', 'x')), 'engine');
	assert.equal(botFailureCause(new Error('container engine unavailable')), null);
});

async function setup(t, options) {
	const root = mkdtempSync(join(tmpdir(), 'bots-cause-'));
	const r = await runtime(root, options);
	t.after(async () => {
		await r.service.shutdown();
		await r.kill();
		rmSync(root, { recursive: true, force: true });
	});
	const bot = await r.service.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	return { ...r, bot };
}
const ended = (r, id) =>
	until(r.service, 'changed', () =>
		['failed', 'completed'].includes(r.sessions.get(id).state),
	);

for (const [label, stats, reason, cause] of [
	[
		'at the limit',
		{ PIDs: 1013, PidsLimit: 1024 },
		'The bot container has run out of processes (1013 of 1024). Restart the bot container.',
		'processes',
	],
	['below the limit', { PIDs: 40, PidsLimit: 1024 }, 'The agent could not start a process (EAGAIN).', null],
	['without stats', new Error('stats unavailable'), 'The agent could not start a process (EAGAIN).', null],
])
	test(`an agent that cannot spawn ${label} records the classified reason and cause`, async (t) => {
		const r = await setup(t, { stats });
		const { sessionId } = await r.service.send(r.bot.id, 'eagain');
		await ended(r, sessionId);
		const record = r.sessions.get(sessionId);
		assert.equal(record.state, 'failed');
		assert.equal(record.reason, reason);
		assert.equal(record.cause ?? null, cause);
		assert.match(record.runnerOutput, /EAGAIN/);
	});

test('an agent that is not ready records the agent cause', async (t) => {
	const r = await setup(t);
	r.hooks.agents.botAgentStatus = async () => ({ available: false, error: 'no' });
	const { sessionId } = await r.service.send(r.bot.id, 'normal');
	await ended(r, sessionId);
	assert.equal(r.sessions.get(sessionId).cause, 'agent');
});

test('an engine that cannot be reached records the engine cause', async (t) => {
	const r = await setup(t);
	r.hooks.environment.prepareSession = async () => {
		throw new EngineCommandError('not-running', 'engine down');
	};
	const { sessionId } = await r.service.send(r.bot.id, 'normal');
	await ended(r, sessionId);
	assert.equal(r.sessions.get(sessionId).cause, 'engine');
});

test('an ordinary agent failure has no cause', async (t) => {
	const r = await setup(t, { stats: { PIDs: 3, PidsLimit: 1024 } });
	r.hooks.agents.botAgentLaunch = async () => ({ available: false });
	const { sessionId } = await r.service.send(r.bot.id, 'normal');
	await ended(r, sessionId);
	assert.equal(r.sessions.get(sessionId).state, 'failed');
	assert.equal(r.sessions.get(sessionId).cause ?? null, null);
});
