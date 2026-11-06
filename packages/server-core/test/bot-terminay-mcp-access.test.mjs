import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

// A bot's Terminay MCP access as the bot service grants and revokes it
// (ADR-0100). The host seam is faked: it records what it is asked to do.

function fakeHost() {
	const opened = [];
	const revoked = [];
	const closed = [];
	return {
		opened,
		revoked,
		closed,
		host: {
			open(botId, executionId, isAllowed) {
				if (!isAllowed()) return undefined;
				const entry = { botId, executionId, isAllowed };
				opened.push(entry);
				return {
					handle() {},
					closeConnection() {},
					close: () => closed.push(executionId),
				};
			},
			revokeBot(botId) {
				revoked.push(botId);
			},
		},
	};
}

async function setup(t, access) {
	const root = mkdtempSync(join(tmpdir(), 'bots-terminay-mcp-'));
	const fake = fakeHost();
	const servers = [];
	const r = await runtime(root, {
		terminayMcp: fake.host,
		onProcess: (o) => servers.push(o.mcpServers.map((server) => server.name)),
	});
	t.after(async () => {
		await r.service.shutdown();
		await r.kill();
		rmSync(root, { recursive: true, force: true });
	});
	const bot = await r.service.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
		...(access === undefined ? {} : { terminayMcpAccess: access }),
	});
	return { ...r, fake, servers, bot };
}

const state = (r, id, ...states) =>
	until(r.service, 'changed', () => states.includes(r.sessions.get(id).state));

test('a bot without access opens no Terminay MCP and gets no terminay server', async (t) => {
	const r = await setup(t);
	assert.equal(r.bot.terminayMcpAccess, false);
	const run = await r.service.send(r.bot.id, 'normal');
	await state(r, run.sessionId, 'completed');
	assert.equal(r.fake.opened.length, 0);
	assert.equal(r.servers[0].includes('terminay'), false);
});

test('a bot with access opens one capability per execution, closed when it ends', async (t) => {
	const r = await setup(t, true);
	const run = await r.service.send(r.bot.id, 'normal');
	await state(r, run.sessionId, 'completed');
	assert.deepEqual(r.fake.opened.map((o) => o.executionId), [run.sessionId]);
	assert.ok(r.servers[0].includes('terminay'), 'the agent is given the terminay server');
	await until(r.service, 'changed', () => r.fake.closed.includes(run.sessionId)).catch(() => {});
	assert.deepEqual(r.fake.closed, [run.sessionId]);
});

test('turning access off revokes running executions before the save returns, and on again restores nothing', async (t) => {
	const r = await setup(t, true);
	const run = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () => r.fake.opened.length === 1);
	const [opened] = r.fake.opened;
	assert.equal(opened.isAllowed(), true);
	await r.service.save({ ...r.bots.get(r.bot.id), terminayMcpAccess: false });
	assert.deepEqual(r.fake.revoked, [r.bot.id], 'revoked before save returned');
	assert.equal(opened.isAllowed(), false);
	await r.service.save({ ...r.bots.get(r.bot.id), terminayMcpAccess: true });
	assert.equal(opened.isAllowed(), false, 'a running execution stays revoked');
	assert.equal(r.fake.opened.length, 1);
	await r.service.stop(r.bot.id, run.sessionId).catch(() => r.service.stopBot(r.bot.id));
});

test('turning access on applies to the next execution only', async (t) => {
	const r = await setup(t, false);
	const first = await r.service.send(r.bot.id, 'normal');
	await state(r, first.sessionId, 'completed');
	await r.service.save({ ...r.bots.get(r.bot.id), terminayMcpAccess: true });
	const second = await r.service.send(r.bot.id, 'normal');
	await state(r, second.sessionId, 'completed');
	assert.deepEqual(r.fake.opened.map((o) => o.executionId), [second.sessionId]);
});

test('a save that leaves access on, or a refused save, revokes nothing', async (t) => {
	const r = await setup(t, true);
	await r.service.save({ ...r.bots.get(r.bot.id), description: 'still on' });
	await assert.rejects(
		r.service.save({ ...r.bots.get(r.bot.id), terminayMcpAccess: false, modelId: 'unlisted' }),
	);
	assert.deepEqual(r.fake.revoked, []);
});

test('no MCP caller, including a bot execution, can reach a bot operation', async () => {
	const { assertBotAuthority } = await import('../dist/botService/authority.js');
	assert.throws(() => assertBotAuthority({ clientId: 'system:mcp', authScope: 'write' }), /terminal-create authority/);
	assert.throws(
		() =>
			assertBotAuthority({
				clientId: 'c',
				authScope: 'write',
				claims: { botExecutionId: '0123456789abcdef01234567' },
			}),
		/terminal-create authority/,
	);
	assert.doesNotThrow(() => assertBotAuthority({ clientId: 'c', authScope: 'write' }));
});

test('deleting a bot revokes every concurrent execution first', async (t) => {
	const r = await setup(t, true);
	await r.service.send(r.bot.id, 'hold');
	await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () => r.fake.opened.length === 2);
	await r.service.remove(r.bot.id, false, true);
	assert.deepEqual(r.fake.revoked, [r.bot.id]);
	assert.deepEqual(r.fake.opened.map((o) => o.isAllowed()), [false, false]);
	assert.equal(r.fake.closed.length, 2, 'both executions gave up their relays');
});

test('stopping an execution closes its Terminay MCP', async (t) => {
	const r = await setup(t, true);
	const run = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () => r.fake.opened.length === 1);
	await r.service.stop(r.bot.id, run.sessionId);
	await until(r.service, 'changed', () => r.fake.closed.includes(run.sessionId)).catch(() => {});
	assert.deepEqual(r.fake.closed, [run.sessionId]);
});

test('a toggle-off that lands while an execution is starting leaves it without Terminay MCP', async (t) => {
	const r = await setup(t, true);
	// The host checks isAllowed when it mints; the record has changed by then.
	const open = r.fake.host.open;
	r.fake.host.open = (botId, executionId, isAllowed) => {
		r.bots.save({ ...r.bots.get(botId), terminayMcpAccess: false });
		return open(botId, executionId, isAllowed);
	};
	const run = await r.service.send(r.bot.id, 'normal');
	await state(r, run.sessionId, 'completed');
	assert.equal(r.fake.opened.length, 0);
	assert.equal(r.servers[0].includes('terminay'), false);
});
