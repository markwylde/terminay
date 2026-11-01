import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BotsClient,
	TerminayClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { FEATURE_CAPABILITIES, BOT_OPERATIONS as op } from '@terminay/protocol';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	BotConnectionResources,
	createBotOperations,
} from '../dist/botService/index.js';
import { capabilityOf, createServerCoreComposition } from '../dist/index.js';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

const context = {
	connectionId: 'connection',
	clientId: 'client',
	authScope: 'write',
	signal: new AbortController().signal,
};
async function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bots-protocol-'));
	const r = await runtime(root);
	const bot = await r.service.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	t.after(async () => {
		await r.service.shutdown();
		rmSync(root, { recursive: true, force: true });
	});
	return { ...r, bot };
}
async function connect(t, composition, identity) {
	const pair = createInMemoryTransportPair();
	const connection = composition.core.accept(pair.server, {
		authenticatedClient: identity,
	});
	const task = connection.start();
	const client = new TerminayClient({
		transport: pair.client,
		clientId: 'wire-client',
	});
	await pair.open();
	const hello = await client.connect();
	t.after(async () => {
		await client.close();
		await task;
	});
	return { client, connection, hello, task };
}
function compose(service) {
	return createServerCoreComposition({
		serverId: 'bots-test',
		serverVersion: 'test',
		capabilities: [],
		bots: service,
		ptyFactory: {
			spawn() {
				return {
					pid: 1,
					write() {},
					resize() {},
					kill() {},
					onData: () => () => {},
					onExit: () => () => {},
				};
			},
		},
		allowUnresolvedTestSessions: true,
	});
}
test('5.8 every operation rechecks authority, including reads, capability-bound requests and aborted requests', async (t) => {
	const r = await setup(t);
	const registry = createBotOperations(r.service);
	for (const auth of [
		{ authScope: 'read' },
		{ claims: { projectId: 'p' } },
		{ claims: { sessionId: 's' } },
		{ claims: { capability: 'mcp' } },
		{ clientId: 'system:mcp' },
	]) {
		for (const [operation, handler] of Object.entries({
			...registry.queries,
			...registry.commands,
		})) {
			await assert.rejects(
				async () =>
					handler({
						envelope: { operation, payload: { botId: r.bot.id } },
						context: { ...context, ...auth },
					}),
				(e) => e.code === 'forbidden',
				operation,
			);
		}
	}
	const abort = new AbortController();
	abort.abort();
	await assert.rejects(
		registry.queries[op.list]({
			envelope: { payload: {} },
			context: { ...context, signal: abort.signal },
		}),
	);
});
test('5.8 wire conformance refuses unauthorized list, get and subscribe, including capability-bound write clients', async (t) => {
	const r = await setup(t);
	const composition = compose(r.service);
	await composition.start();
	t.after(() => composition.shutdown());
	for (const identity of [
		{ clientId: 'reader', authScope: 'read' },
		{
			clientId: 'bound',
			authScope: 'write',
			claims: { capabilityId: 'mcp-token' },
		},
		{ clientId: 'project', authScope: 'admin', claims: { projectId: 'p' } },
	]) {
		const { client } = await connect(t, composition, identity);
		await assert.rejects(
			client.query(op.list, {}),
			(e) => e.code === 'forbidden',
		);
		await assert.rejects(
			client.query(op.get, { botId: r.bot.id }),
			(e) => e.code === 'forbidden',
		);
		await assert.rejects(
			client.subscribe('bots.changed'),
			(e) => e.code === 'forbidden',
		);
	}
});
test('5.8 invalidations carry only bot id/revision; revocation ends subscriptions and connection-bound resources', async (t) => {
	const r = await setup(t);
	const composition = compose(r.service);
	await composition.start();
	t.after(() => composition.shutdown());
	const { client, connection, hello, task } = await connect(t, composition, {
		clientId: 'writer',
		authScope: 'write',
	});
	assert.ok(hello.capabilities.includes(FEATURE_CAPABILITIES.bots));
	for (const operation of Object.values(op))
		assert.equal(capabilityOf(operation), FEATURE_CAPABILITIES.bots);
	const sub = await client.subscribe('bots.changed');
	const events = [];
	sub.onEvent((event) => events.push(event));
	await client.command(op.watchMemories, { botId: r.bot.id });
	assert.equal(r.helper.references, 1);
	await client.command(op.writeMemory, {
		botId: r.bot.id,
		path: 'note.md',
		contents: '# Note',
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(events.length > 0);
	assert.ok(
		events.every(
			(e) => Object.keys(e.payload).sort().join(',') === 'botId,revision',
		),
	);
	await connection.close({
		code: 'unauthorized',
		message: 'authority revoked',
	});
	await task;
	assert.equal(r.helper.references, 0);
	const count = events.length;
	await r.memories.write(r.bot.id, 'after.md', 'after');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(events.length, count);
});
test('5.8 stream resources tear down once on revoke or abort, and unauthorized clients cannot bind', () => {
	const resources = new BotConnectionResources();
	let closed = 0;
	const abort = new AbortController();
	const close = resources.bind(
		{ ...context, signal: abort.signal },
		() => closed++,
	);
	resources.revoke(context.connectionId);
	close();
	abort.abort();
	assert.equal(closed, 1);
	assert.throws(
		() => resources.bind({ ...context, authScope: 'read' }, () => {}),
		(e) => e.code === 'forbidden',
	);
});

test('5.8 binary pages carry a near-cap transcript and runner output through the default 64 KiB header budget', {
	timeout: 15000,
}, async (t) => {
	const r = await setup(t);
	const composition = compose(r.service);
	await composition.start();
	t.after(() => composition.shutdown());
	const { client } = await connect(t, composition, {
		clientId: 'writer',
		authScope: 'write',
	});
	const facade = new BotsClient(new TerminayClientFacade(client));
	const saved = await facade.save({
		...r.bot,
		instructions: 'x'.repeat(32768),
	});
	assert.equal(saved.instructions.length, 32768);
	const sent = await facade.send(r.bot.id, 'normal');
	await until(
		r.service,
		'changed',
		() => r.sessions.get(sent.sessionId).state === 'completed',
	);
	for (let n = 0; n < 15; n++)
		r.sessions.append(sent.sessionId, { text: 'x'.repeat(512 * 1024) });
	r.sessions.runner(sent.sessionId, 'y'.repeat(256 * 1024));
	r.sessions.commit(sent.sessionId);
	const detail = await facade.session(r.bot.id, sent.sessionId);
	assert.equal(detail.runnerOutput.length, 256 * 1024);
	assert.ok(JSON.stringify(detail).length > 7 * 1024 * 1024);
	await facade.writeMemory(r.bot.id, 'large.md', 'z'.repeat(256 * 1024));
	assert.equal((await facade.memory(r.bot.id, 'large.md')).length, 256 * 1024);
});

test('6.1 trigger wire operations use binary bodies, expose firings/next times, and send only invalidations until revocation', async (t) => {
	const r = await setup(t);
	const composition = compose(r.service);
	await composition.start();
	t.after(() => composition.shutdown());
	const { client, connection, task } = await connect(t, composition, {
		clientId: 'writer',
		authScope: 'write',
	});
	const facade = new BotsClient(new TerminayClientFacade(client));
	const sub = await client.subscribe('bots.changed');
	const events = [];
	sub.onEvent((event) => events.push(event));
	const draft = {
		name: 'Build',
		prompt: '\x01'.repeat(32768),
		enabled: false,
		condition: { kind: 'every', intervalMs: 300000 },
	};
	let trigger = await facade.createTrigger(r.bot.id, draft);
	assert.equal(trigger.prompt, draft.prompt);
	assert.equal((await facade.triggers(r.bot.id)).triggers[0].id, trigger.id);
	trigger = await facade.updateTrigger(r.bot.id, trigger.id, {
		...draft,
		prompt: 'Check builds',
		name: 'Edited',
	});
	assert.equal(trigger.name, 'Edited');
	assert.equal(
		(
			await facade.previewTrigger(r.bot.id, {
				kind: 'cron',
				cron: '0 9 * * 1-5',
			})
		).length,
		5,
	);
	await facade.enableTrigger(r.bot.id, trigger.id, true);
	const now = Date.now();
	const upcoming = await facade.upcomingTriggers(
		r.bot.id,
		now,
		now + 7 * 24 * 3600000,
		{ limit: 3 },
	);
	assert.equal(upcoming.firings.length, 3);
	assert.ok(upcoming.next);
	await facade.enableTrigger(r.bot.id, trigger.id, false);
	const firing = await facade.runTrigger(r.bot.id, trigger.id);
	assert.ok(firing.sessionId);
	await until(
		r.service,
		'changed',
		() => r.service.triggers.firings(r.bot.id)[0].outcome === 'completed',
	);
	const history = await facade.triggerFirings(r.bot.id, trigger.id);
	assert.equal(history[0].origin, 'run-now');
	assert.equal(history[0].outcome, 'completed');
	assert.equal((await facade.triggers(r.bot.id)).triggers[0].enabled, false);
	await facade.dismissMissedTriggers(r.bot.id, trigger.id);
	await facade.deleteTrigger(r.bot.id, trigger.id);
	assert.deepEqual((await facade.triggers(r.bot.id)).triggers, []);
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(events.length > 0);
	assert.ok(
		events.every(
			(e) => Object.keys(e.payload).sort().join(',') === 'botId,revision',
		),
	);
	await connection.close({
		code: 'unauthorized',
		message: 'authority revoked',
	});
	await task;
	const count = events.length;
	r.service.triggers.create(r.bot.id, { ...draft, prompt: 'After revocation' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(events.length, count);
});
