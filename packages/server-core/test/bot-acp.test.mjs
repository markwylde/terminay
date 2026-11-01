import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { BotAcpClient, spawnBotAgent } from '../dist/botService/index.js';
import { credential, until } from './fixtures/bot-test-runtime.mjs';

async function client(t, mode = 'autonomous', only = false, env = {}) {
	const child = spawn(
		process.execPath,
		[new URL('./fixtures/bot-acp.mjs', import.meta.url).pathname],
		{ stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } },
	);
	const acp = new BotAcpClient(child, credential(), mode, only);
	t.after(async () => {
		acp.dispose();
		if (child.exitCode === null && child.signalCode === null) {
			const closed = once(child, 'close');
			child.kill('SIGKILL');
			await closed;
		}
	});
	const frames = [];
	const write = child.stdin.write.bind(child.stdin);
	child.stdin.write = (chunk, ...args) => {
		frames.push(JSON.parse(chunk));
		return write(chunk, ...args);
	};
	await acp.initialize();
	await acp.open(null, 'selected');
	return { acp, frames };
}
test('5.2 initialization has no capabilities, authenticate precedes use, config model and every streamed update kind', async (t) => {
	const { acp, frames } = await client(t);
	const updates = [];
	const runner = [];
	acp.on('update', (u) => updates.push(u));
	acp.on('runner', (s) => runner.push(s));
	await acp.prompt('normal client-request', 30000);
	acp.closeInput();
	await once(acp, 'closed');
	assert.deepEqual(frames[0].params.clientCapabilities, {});
	assert.equal(frames[1].method, 'authenticate');
	assert.equal(frames[1].params.methodId, 'api-key');
	assert.equal(frames[2].method, 'session/new');
	assert.ok(
		frames.some(
			(f) =>
				f.method === 'session/set_config_option' &&
				f.params.value === 'selected',
		),
	);
	const kinds = new Set(updates.map((u) => u.sessionUpdate));
	for (const kind of [
		'user_message_chunk',
		'agent_message_chunk',
		'agent_thought_chunk',
		'tool_call',
		'tool_call_update',
		'plan',
		'available_commands_update',
		'current_mode_update',
		'config_option_update',
		'session_info_update',
		'usage_update',
	])
		assert.ok(kinds.has(kind), kind);
	assert.ok(!JSON.stringify(updates).includes('secret'));
	assert.match(JSON.stringify(updates), /\[redacted\]/);
	assert.ok(!runner.join('').includes('secret'));
	const toolText = updates
		.filter((u) => u.toolCallId === 'split-tool')
		.flatMap((u) => u.content)
		.map((c) => c.content.text)
		.join('');
	assert.equal(toolText, '[redacted]');
	assert.ok(
		frames.some((f) => f.id === 'forbidden-fs' && f.error?.code === -32601),
	);
});
test('5.2 Autonomous allows only once; Autonomous-only forces Ask mode to Autonomous and full access', async (t) => {
	const { acp, frames } = await client(t, 'ask', true);
	await acp.prompt('permission', 30000);
	assert.ok(
		frames.some(
			(f) =>
				f.method === 'session/set_mode' &&
				f.params.modeId === 'agent-full-access',
		),
	);
	assert.deepEqual(frames.find((f) => f.result?.outcome)?.result, {
		outcome: { outcome: 'selected', optionId: 'allow' },
	});
});
test('5.2 Ask me first answer wins, unknown option is refused, timeout rejects pending request', async (t) => {
	const { acp, frames } = await client(t, 'ask');
	let permission = once(acp, 'permission');
	let prompt = acp.prompt('permission', 30000);
	let [request] = await permission;
	assert.throws(
		() => acp.answer(request.id, 'forged'),
		/unknown permission option/,
	);
	acp.answer(request.id, 'reject');
	assert.throws(() => acp.answer(request.id, 'allow'), /already answered/);
	await prompt;
	permission = once(acp, 'permission');
	prompt = acp.prompt('permission-late', 30000);
	[request] = await permission;
	const late = until(acp, 'permission-answered', () =>
		frames.some((f) => f.id === 'late-permission'),
	);
	acp.timeout();
	await prompt;
	await late;
	assert.equal(
		frames.filter((f) => f.result?.outcome?.optionId === 'reject').length,
		3,
	);
	assert.ok(
		frames.some(
			(f) =>
				f.id === 'late-permission' && f.result?.outcome?.optionId === 'reject',
		),
	);
	assert.throws(() => acp.answer(request.id, 'allow'), /already answered/);
});
test('5.2 session/load restores an existing ACP id and unknown client requests get no filesystem authority', async (t) => {
	const { acp, frames } = await client(t);
	await acp.open('saved-session', null);
	assert.ok(
		frames.some(
			(f) =>
				f.method === 'session/load' && f.params.sessionId === 'saved-session',
		),
	);
});
test('5.2 agent exec uses explicit engine address, root supervisor and environment names without secret arguments', () => {
	let call;
	const fake = {
		stream: (...args) => {
			call = args;
			return {};
		},
	};
	spawnBotAgent(
		{
			details: {
				pin: { kind: 'docker', address: 'unix:///pinned', connection: false },
			},
		},
		'abc123def456',
		['terminay-run', 'session', '--', 'agent'],
		{ FAKE_KEY: 'secret' },
		fake,
	);
	assert.deepEqual(call[1].slice(0, 7), [
		'--host',
		'unix:///pinned',
		'exec',
		'-i',
		'-u',
		'root',
		'-w',
	]);
	assert.ok(call[1].includes('FAKE_KEY'));
	assert.ok(!call[1].includes('secret'));
	assert.equal(call[2].env.FAKE_KEY, 'secret');
});
test('5.2 extension launch settings affect only the container, never the host CLI environment', () => {
	let call;
	const runner = {
		stream: (...args) => {
			call = args;
			return {};
		},
	};
	const driver = {
		details: {
			pin: { kind: 'docker', address: 'unix:///pinned', connection: false },
		},
	};
	spawnBotAgent(
		driver,
		'abc123def456',
		['terminay-run', 'sid', '--', 'agent'],
		{ FAKE_KEY: 'secret' },
		runner,
		{ PATH: '/agent/bin', NODE_OPTIONS: '--agent-only' },
	);
	assert.equal(call[2].env.PATH, undefined);
	assert.equal(call[2].env.NODE_OPTIONS, undefined);
	assert.ok(call[1].includes('PATH=/agent/bin'));
	assert.ok(!call[1].includes('secret'));
	assert.throws(
		() => spawnBotAgent(driver, 'abc123def456', [], { PATH: 'secret' }, runner),
		/host engine process/,
	);
});
test('5.2 Ask me can approve once, and a second device cannot replace its answer', async (t) => {
	const { acp } = await client(t, 'ask');
	const permission = once(acp, 'permission');
	const prompt = acp.prompt('permission', 30000);
	const [request] = await permission;
	acp.answer(request.id, 'allow');
	assert.throws(() => acp.answer(request.id, 'reject'), /already answered/);
	await prompt;
});
test('5.2 Autonomous refuses persistent grants and rejects or cancels when no allow-once exists', async (t) => {
	for (const options of [
		[
			{ optionId: 'always', name: 'Always', kind: 'allow_always' },
			{ optionId: 'deny', name: 'Deny', kind: 'reject_once' },
		],
		[{ optionId: 'always', name: 'Always', kind: 'allow_always' }],
	]) {
		const { acp, frames } = await client(t, 'autonomous', false, {
			FAKE_PERMISSION_OPTIONS: JSON.stringify(options),
		});
		await acp.prompt('permission', 30000);
		const outcome = frames.find((f) => f.result?.outcome).result.outcome;
		assert.deepEqual(
			outcome,
			options.length === 2
				? { outcome: 'selected', optionId: 'deny' }
				: { outcome: 'cancelled' },
		);
	}
});
test('5.2 a credential requiring an undeclared authenticate method fails before opening a session', async (t) => {
	await assert.rejects(
		client(t, 'autonomous', false, { FAKE_AUTH_METHOD_MISSING: '1' }),
		/authentication method/,
	);
});
