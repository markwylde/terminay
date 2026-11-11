import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BotCleanupError } from '../dist/botService/agentProcess.js';
import { SourceRunError } from '../dist/botService/sourceRunner.js';
import {
	AutomationRepository,
	AutomationRunLog,
	AutomationScheduler,
	BotImageBuildError,
	BotMemories,
	BotService,
	BotSessionStore,
	BotStore,
	createBotOperations,
	EventFanout,
	eventBlock,
	ScheduleEngine,
} from '../dist/index.js';
import { relayDriver } from './fixtures/bot-runtime-relay.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const start = Date.parse('2026-01-05T08:00:00Z');
const flush = () => new Promise((resolve) => setImmediate(resolve));
function source() {
	const listeners = new Set();
	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		emit(value) {
			for (const fn of listeners) fn(value);
		},
	};
}
function clock(initial = start) {
	let now = initial,
		sequence = 0;
	const timers = new Map();
	return {
		get now() {
			return now;
		},
		timers,
		clock: {
			now: () => now,
			setTimeout(fn, delay) {
				const id = ++sequence;
				timers.set(id, { fn, at: now + delay });
				return id;
			},
			clearTimeout(id) {
				timers.delete(id);
			},
		},
		async advance(to, engine) {
			for (;;) {
				const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
				if (!due || due[1].at > to) break;
				now = due[1].at;
				timers.delete(due[0]);
				due[1].fn();
				await engine.idle();
				await flush();
			}
			now = to;
		},
		async wake(to, engine) {
			now = to;
			await engine.wake();
			await flush();
		},
	};
}
const draft = (
	condition = { kind: 'every', intervalMs: 5 * MINUTE },
	extra = {},
) => ({
	name: 'Nightly',
	enabled: true,
	prompt: 'Check the nightly build and summarise failures',
	condition,
	...extra,
});
const agent = {
	id: 'fake.agent',
	displayName: 'Fake',
	autonomousOnly: false,
	runtimeProtocol: 'native-cli-v1',
	nativeDriver: 'claude-code-cli',
	runtimeVersion: '2.1.312',
};
async function setup(t, options = {}) {
	const root = options.root ?? mkdtempSync(join(tmpdir(), 'bot-triggers-'));
	const time = clock(options.at ?? start);
	const errors = [];
	const engine = new ScheduleEngine({
		clock: time.clock,
		timeZone: options.zone ?? 'UTC',
		onError: (e) => errors.push(e),
	});
	const agents = source(),
		activity = source(),
		journal = source();
	const fanout = new EventFanout({
		serverId: 'server',
		agents,
		activity,
		eventJournal: journal,
		now: () => time.now,
		describeTerminal: (id) =>
			id.startsWith('project-')
				? {
						projectId: id,
						title: 'Build terminal',
						projectTitle: 'Project A',
						sessionCreatedAt: 1,
					}
				: undefined,
		onError: (e) => errors.push(e),
	});
	const bots = new BotStore(join(root, 'bots.json'), () => time.now);
	const sessions = new BotSessionStore(
		join(root, 'sessions'),
		time.clock,
		() => time.now,
	);
	const memories = new BotMemories(
		{
			async acquire() {
				return {
					async list() {
						return [];
					},
					release() {},
				};
			},
		},
		bots,
	);
	const turns = [],
		closed = [],
		runtimeCleanups = [],
		clients = new Map();
	const failures = { engine: false, image: false, agent: false, kill: 0 };
	const driver = relayDriver();
	const service = new BotService(bots, sessions, memories, {
		now: () => time.now,
		sources: options.sources,
		agents: {
			botAgentContributions: () => [
				{ extensionId: 'fake', contribution: agent },
			],
			botAgentModels: async () => ({ available: true, value: [] }),
			botAgentStatus: async () =>
				failures.agent
					? { available: false }
					: { available: true, value: { state: 'ready' } },
			botAgentLaunch: async () => ({
				available: true,
				value: { args: [], env: {} },
			}),
		},
		environment: {
			register() {},
			async prepareSession() {
				if (failures.image) throw new BotImageBuildError();
			},
			async reconcileAll() {},
			async remove() {},
			async stop() {},
			state: () => 'stopped',
		},
		driver: async () => {
			if (failures.engine) throw new Error('engine not running');
			return driver;
		},
		credentials: {
			async acquire() {
				return { redact: (v) => v, release() {} };
			},
		},
		removeHelpers: async () => {},
		activity() {},
		process(o) {
			const client = new EventEmitter();
			client.session = `acp-${o.sessionId}`;
			client.canLoad = true;
			client.permissions = [];
			client.prompt = async (text) => {
				turns.push({
					sessionId: o.sessionId,
					text,
					snapshot: o.snapshot,
					loadId: o.loadId,
				});
				if (!options.autoComplete)
					await new Promise((resolve) => {
						client.finish = resolve;
					});
			};
			client.finish = () => {};
			clients.set(o.sessionId, client);
			return {
				client,
				async open() {
					driver.connect(o.sessionId, o.mcpServers);
					o.onClient(client);
					return client;
				},
				async close(reason) {
					closed.push({ id: o.sessionId, reason });
					client.finish();
					// BotAgentProcess.close: when the agent's `terminay-run --kill`
					// exec fails, the relays are still closed and the close
					// rejects with BotCleanupError.
					if (failures.kill > 0) {
						failures.kill--;
						await o.cleanupRuntime?.();
						throw new BotCleanupError(
							new Error(failures.killMessage ?? 'container process failed'),
						);
					}
					await o.cleanupRuntime?.();
					runtimeCleanups.push(o.sessionId);
				},
			};
		},
	});
	await service.reconcile();
	const bot =
		bots.list()[0] ??
		bots.save({
			name: 'Bird',
			agentId: agent.id,
			signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
		});
	if (!options.deferStart)
		await service.triggers.start(engine, fanout, options.zone ?? 'UTC');
	t.after(async () => {
		service.triggers.stop();
		engine.stop();
		fanout.stop();
		for (const c of clients.values()) c.finish();
		await flush();
		await service.shutdown();
		if (!options.keepRoot) rmSync(root, { recursive: true, force: true });
		assert.deepEqual(errors, []);
	});
	return {
		root,
		time,
		engine,
		fanout,
		agents,
		activity,
		journal,
		bots,
		sessions,
		service,
		triggers: service.triggers,
		bot,
		turns,
		closed,
		runtimeCleanups,
		clients,
		failures,
		driver,
	};
}
async function finish(r, id) {
	r.clients.get(id).finish();
	await flush();
}

test('runtime trigger CRUD shares UI persistence, validation and events without a work lease', async (t) => {
	const r = await setup(t);
	const { sessionId } = await r.service.send(r.bot.id, 'Manage my triggers');
	const call = (name, args = {}) =>
		r.service.runtime.call(sessionId, name, args);
	const initial = await call('triggers_list');
	assert.equal((await call('sessions_get', { sessionId })).ownsWork, false);
	const created = await call('triggers_create', {
		revision: initial.revision,
		draft: draft(),
	});
	const id = created.trigger.id;
	assert.equal(created.trigger.prompt, undefined);
	assert.equal(
		(await call('triggers_get', { triggerId: id })).text,
		draft().prompt,
	);
	await assert.rejects(
		call('triggers_create', { revision: initial.revision, draft: draft() }),
		/revision changed/,
	);
	assert.equal(r.triggers.list(r.bot.id).triggers.length, 1);
	const changed = await call('triggers_update', {
		triggerId: id,
		revision: created.revision,
		draft: draft(
			{ kind: 'cron', cron: '0 9 * * 1-5' },
			{ name: 'Weekday review', prompt: 'Review this morning' },
		),
	});
	const restored = new BotStore(join(r.root, 'bots.json')).trigger(
		r.bot.id,
		id,
	);
	assert.equal(restored.name, 'Weekday review');
	assert.equal(restored.prompt, 'Review this morning');
	const disabled = await call('triggers_enable', {
		triggerId: id,
		revision: changed.revision,
		enabled: false,
	});
	assert.equal(disabled.trigger.enabled, false);
	assert.equal(r.triggers.list(r.bot.id).triggers[0].prompt, restored.prompt);
	await assert.rejects(
		call('triggers_delete', { triggerId: id, revision: changed.revision }),
		/revision changed/,
	);
	const deleted = await call('triggers_delete', {
		triggerId: id,
		revision: disabled.revision,
	});
	assert.equal(deleted.deleted, id);
	assert.equal(
		new BotStore(join(r.root, 'bots.json')).triggers(r.bot.id).length,
		0,
	);
	const events = await call('events_next', { cursor: initial.eventsCursor });
	assert.deepEqual(
		events.items
			.filter((e) => e.type.startsWith('trigger.'))
			.map((e) => e.type),
		[
			'trigger.created',
			'trigger.updated',
			'trigger.updated',
			'trigger.deleted',
		],
	);
	assert.ok(!JSON.stringify(events).includes(restored.prompt));
});

test('runtime trigger reads paginate metadata, slice escaped UTF-8 prompts and reject stale/cross-scope cursors', async (t) => {
	const r = await setup(t);
	for (let i = 0; i < 31; i++)
		r.triggers.create(
			r.bot.id,
			draft(undefined, {
				name: `Task ${i}`,
				prompt: `${'😀\n"\\'.repeat(3000)}\uFFFD`,
			}),
		);
	const { sessionId } = await r.service.send(r.bot.id, 'Inspect my triggers');
	const call = (name, args = {}) =>
		r.service.runtime.call(sessionId, name, args);
	const first = await call('triggers_list');
	assert.equal(first.items.length, 10);
	assert.ok(first.items.every((item) => item.prompt === undefined));
	const seen = [...first.items];
	let cursor = first.nextCursor;
	while (cursor) {
		const page = await call('triggers_list', { cursor, limit: 25 });
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 8192);
		seen.push(...page.items);
		cursor = page.nextCursor;
	}
	assert.equal(new Set(seen.map((item) => item.id)).size, 31);
	await assert.rejects(call('triggers_list', { limit: 26 }), /limit/);
	await assert.rejects(
		call('triggers_list', { cursor: first.nextCursor, search: 'different' }),
		/query/,
	);
	const id = first.items[0].id;
	let prompt = '',
		detailCursor;
	do {
		const detail = await call('triggers_get', {
			triggerId: id,
			cursor: detailCursor,
		});
		assert.ok(Buffer.byteLength(JSON.stringify(detail)) <= 8192);
		assert.ok(!detail.text.slice(0, -1).includes('\uFFFD'));
		prompt += detail.text;
		detailCursor = detail.nextCursor;
	} while (detailCursor);
	assert.equal(prompt, r.bots.trigger(r.bot.id, id).prompt);
	const detail = await call('triggers_get', { triggerId: id });
	const waiting = call('events_next', {
		cursor: first.eventsCursor,
		waitMs: 2000,
	});
	r.triggers.update(
		r.bot.id,
		id,
		draft(undefined, { name: 'Edited through UI' }),
	);
	assert.equal((await waiting).items[0].type, 'trigger.updated');
	await assert.rejects(
		call('triggers_list', { cursor: first.nextCursor }),
		/query/,
	);
	await assert.rejects(
		call('triggers_get', { triggerId: id, cursor: detail.nextCursor }),
		/query/,
	);
	const other = r.bots.save({
		name: 'Other',
		agentId: agent.id,
		signIn: r.bot.signIn,
	});
	const outside = r.triggers.create(other.id, draft());
	const { sessionId: otherSession } = await r.service.send(
		other.id,
		'Inspect own triggers',
	);
	await assert.rejects(
		r.service.runtime.call(otherSession, 'triggers_list', {
			cursor: first.nextCursor,
		}),
		/cursor/i,
	);
	for (const [name, args] of [
		['triggers_get', {}],
		['triggers_update', { revision: r.bots.revision, draft: draft() }],
		['triggers_delete', { revision: r.bots.revision }],
		['triggers_enable', { revision: r.bots.revision, enabled: false }],
		['triggers_run', { revision: r.bots.revision }],
	])
		await assert.rejects(
			call(name, { triggerId: outside.id, ...args }),
			/not found/i,
		);
	assert.equal(r.bots.trigger(other.id, outside.id).enabled, true);
	r.service.runtime.revoke(sessionId);
	for (const name of [
		'triggers_list',
		'triggers_create',
		'triggers_delete',
		'triggers_run',
	])
		await assert.rejects(
			call(name, { triggerId: id, revision: r.bots.revision, draft: draft() }),
			/active/,
		);
});

test('runtime trigger preview, Run now and scheduled firing use the shared scheduler', async (t) => {
	const r = await setup(t, { zone: 'Europe/London' });
	const { sessionId } = await r.service.send(r.bot.id, 'Schedule a check');
	const call = (name, args = {}) =>
		r.service.runtime.call(sessionId, name, args);
	const preview = await call('triggers_preview', {
		condition: { kind: 'cron', cron: '0 9 * * 1-5' },
	});
	assert.equal(preview.timeZone, 'Europe/London');
	assert.equal(preview.next.length, 5);
	assert.equal(
		new Date(preview.next[0]).toISOString(),
		'2026-01-05T09:00:00.000Z',
	);
	assert.deepEqual(
		(
			await call('triggers_preview', {
				condition: { kind: 'event', event: 'agent.finished' },
			})
		).next,
		[],
	);
	await assert.rejects(
		call('triggers_preview', {
			condition: { kind: 'every', intervalMs: 30000 },
		}),
		/1 minutes/,
	);
	const created = await call('triggers_create', {
		revision: r.bots.revision,
		draft: draft({ kind: 'once', at: start + MINUTE }, { enabled: false }),
	});
	const run = await call('triggers_run', {
		triggerId: created.trigger.id,
		revision: created.revision,
	});
	assert.notEqual(run.firing.sessionId, sessionId);
	assert.equal(r.sessions.get(run.firing.sessionId).origin.kind, 'run-now');
	assert.equal(r.bots.trigger(r.bot.id, created.trigger.id).enabled, false);
	await assert.rejects(
		call('triggers_run', {
			triggerId: created.trigger.id,
			revision: created.revision,
		}),
		/revision changed/,
	);
	assert.equal(r.triggers.firings(r.bot.id).length, 1);
	await finish(r, run.firing.sessionId);
	await call('triggers_enable', {
		triggerId: created.trigger.id,
		revision: r.bots.revision,
		enabled: true,
	});
	const cursor = r.service.messages.eventCursor(r.bot.id);
	await r.time.advance(start + MINUTE, r.engine);
	assert.equal(r.bots.trigger(r.bot.id, created.trigger.id).enabled, false);
	assert.equal(
		r.sessions.list(r.bot.id).filter((s) => s.origin.kind === 'trigger').length,
		1,
	);
	assert.ok(
		r.service.messages
			.events(r.bot.id, cursor)
			.items.some((e) => e.type === 'trigger.updated'),
	);
});

test('runtime trigger mutation guards reject invalid drafts, forged scope, limits and stale writes', async (t) => {
	const r = await setup(t);
	const { sessionId } = await r.service.send(r.bot.id, 'Manage schedules');
	const call = (name, args = {}) =>
		r.service.runtime.call(sessionId, name, args);
	for (const bad of [
		draft(undefined, { prompt: '' }),
		draft(undefined, { prompt: 'x'.repeat(32769) }),
		draft({ kind: 'every', intervalMs: 30000 }),
		draft({ kind: 'event', event: 'invented' }),
		draft(undefined, { botId: 'forged' }),
		draft({ kind: 'every', intervalMs: 300000, anchor: 0 }),
	])
		await assert.rejects(
			call('triggers_create', { revision: r.bots.revision, draft: bad }),
		);
	await assert.rejects(
		call('triggers_create', { revision: null, draft: draft() }),
		/revision/,
	);
	await assert.rejects(call('triggers_list', { botId: 'forged' }), /argument/);
	assert.equal(r.bots.triggers(r.bot.id).length, 0);
	const revision = r.bots.revision;
	const racing = await Promise.allSettled([
		call('triggers_create', { revision, draft: draft() }),
		call('triggers_create', { revision, draft: draft() }),
	]);
	assert.equal(
		racing.filter((result) => result.status === 'fulfilled').length,
		1,
	);
	assert.equal(
		racing.filter((result) => result.status === 'rejected').length,
		1,
	);
	assert.equal(r.bots.triggers(r.bot.id).length, 1);
	r.triggers.remove(r.bot.id, r.bots.triggers(r.bot.id)[0].id);
	for (let i = 0; i < 50; i++) r.triggers.create(r.bot.id, draft());
	await assert.rejects(
		call('triggers_create', { revision: r.bots.revision, draft: draft() }),
		/50 triggers/,
	);
});

test('6.1 idle trigger starts a new session through send; disabled trigger never fires; once stays queued after automatic disable', async (t) => {
	const r = await setup(t);
	const original = r.service.send.bind(r.service),
		sent = [];
	r.service.send = (...args) => {
		sent.push(args);
		return original(...args);
	};
	const trigger = r.triggers.create(
		r.bot.id,
		draft({ kind: 'once', at: start + MINUTE }),
	);
	r.triggers.create(
		r.bot.id,
		draft({ kind: 'every', intervalMs: 5 * MINUTE }, { enabled: false }),
	);
	await r.time.advance(start + MINUTE, r.engine);
	assert.equal(sent.length, 1);
	const session = r.sessions.list(r.bot.id)[0];
	assert.equal(session.origin.kind, 'trigger');
	assert.equal(session.origin.triggerId, trigger.id);
	assert.ok(r.turns[0].text.includes(trigger.prompt));
	assert.equal(
		r.triggers.list(r.bot.id).triggers.find((t) => t.id === trigger.id).enabled,
		false,
	);
	await finish(r, session.id);
	assert.equal(r.triggers.firings(r.bot.id)[0].outcome, 'completed');
	assert.equal(r.time.timers.size, 0);
});

test('6.1 validation rejects empty/oversize prompts, short intervals, malformed/never-matching cron, caps 50 per bot and confines ownership', async (t) => {
	const r = await setup(t);
	for (const [d, reason] of [
		[draft(undefined, { prompt: '' }), /prompt/],
		[draft(undefined, { prompt: '🦜'.repeat(8193) }), /prompt/],
		[draft({ kind: 'every', intervalMs: MINUTE / 2 }), /1 minutes/],
		[draft({ kind: 'cron', cron: '61 * * * *' }), /minute/i],
		[draft({ kind: 'cron', cron: '0 0 30 2 *' }), /never/],
	])
		assert.throws(() => r.triggers.create(r.bot.id, d), reason);
	for (let n = 0; n < 50; n++)
		r.triggers.create(r.bot.id, draft(undefined, { name: `trigger ${n}` }));
	assert.throws(() => r.triggers.create(r.bot.id, draft()), /50 triggers/);
	const another = r.bots.save({
		name: 'Other',
		agentId: agent.id,
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	const trigger = r.triggers.create(another.id, draft());
	assert.throws(
		() => r.triggers.update(r.bot.id, trigger.id, draft()),
		/not found/,
	);
	assert.throws(() => r.triggers.remove(r.bot.id, trigger.id), /not found/);
	assert.throws(
		() => r.triggers.enable(r.bot.id, trigger.id, true),
		/not found/,
	);
});

test('distinct firings from one busy trigger wait instead of being skipped and retain prompt snapshots', async (t) => {
	const r = await setup(t);
	const active = [];
	for (let n = 0; n < 4; n++)
		active.push(await r.service.send(r.bot.id, 'hold'));
	const trigger = r.triggers.create(r.bot.id, draft());
	await r.time.advance(start + 5 * MINUTE, r.engine);
	r.triggers.update(
		r.bot.id,
		trigger.id,
		draft(undefined, { prompt: 'new prompt' }),
	);
	await r.time.advance(start + 10 * MINUTE, r.engine);
	assert.equal(r.service.queue.list(r.bot.id).length, 2);
	assert.ok(r.triggers.firings(r.bot.id).every((f) => f.outcome === 'pending'));
	for (let n = 0; n < 19; n++) await r.triggers.runNow(r.bot.id, trigger.id);
	assert.equal(r.service.queue.list(r.bot.id).length, 20);
	assert.equal(
		r.triggers.observations
			.pending(r.bot.id)
			.filter(
				(e) => !r.sessions.list(r.bot.id).some((s) => s.id === e.sessionId),
			).length,
		1,
	);
	await finish(r, active[0].sessionId);
	await flush();
	assert.ok(r.turns[4].text.includes(trigger.prompt));
	assert.equal(
		r.triggers.observations
			.pending(r.bot.id)
			.filter(
				(e) => !r.sessions.list(r.bot.id).some((s) => s.id === e.sessionId),
			).length,
		0,
	);
});

test('6.1 trigger and subsequent user messages use fresh executions', async (t) => {
	const r = await setup(t);
	const chat = await r.service.send(r.bot.id, 'chat');
	await flush();
	await finish(r, chat.sessionId);
	const trigger = r.triggers.create(
		r.bot.id,
		draft({ kind: 'every', intervalMs: 60000 }),
	);
	const firing = await r.triggers.runNow(r.bot.id, trigger.id);
	await flush();
	assert.equal(r.sessions.get(chat.sessionId).state, 'completed');
	await finish(r, firing.sessionId);
	const resumed = await r.service.send(r.bot.id, 'continue');
	await flush();
	assert.notEqual(resumed.sessionId, chat.sessionId);
	assert.equal(r.turns.at(-1).loadId, null);
});

test('6.1 disabling/deleting removes pending work; a queued once firing survives its automatic disable', async (t) => {
	const r = await setup(t);
	await r.service.send(r.bot.id, 'hold');
	for (let n = 0; n < 3; n++) await r.service.send(r.bot.id, 'hold');
	await flush();
	const a = r.triggers.create(r.bot.id, draft()),
		b = r.triggers.create(r.bot.id, draft());
	await r.triggers.runNow(r.bot.id, a.id);
	await r.triggers.runNow(r.bot.id, b.id);
	r.triggers.enable(r.bot.id, a.id, false);
	r.triggers.remove(r.bot.id, b.id);
	assert.equal(r.service.queue.list(r.bot.id).length, 0);
	assert.equal(r.triggers.firings(r.bot.id, a.id)[0].outcome, 'skipped');
	const once = r.triggers.create(
		r.bot.id,
		draft({ kind: 'once', at: start + MINUTE }),
	);
	await r.time.advance(start + MINUTE, r.engine);
	assert.equal(
		r.triggers.list(r.bot.id).triggers.find((t) => t.id === once.id).enabled,
		false,
	);
	assert.equal(r.service.queue.list(r.bot.id).length, 1);
});

test('6.1 Run now starts disabled triggers with run-now origin and leaves them disabled', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(
		r.bot.id,
		draft(undefined, { enabled: false }),
	);
	const firing = await r.triggers.runNow(r.bot.id, trigger.id);
	await flush();
	assert.equal(r.sessions.get(firing.sessionId).origin.kind, 'run-now');
	assert.ok(r.turns[0].text.includes(trigger.prompt));
	assert.equal(r.triggers.list(r.bot.id).triggers[0].enabled, false);
});

for (const [failure, reason] of [
	['engine', 'container engine unavailable'],
	[
		'agent',
		'The bot agent is not ready. Check its sign-in and rebuild the bot image.',
	],
	[
		'image',
		'The bot image could not be built. Open Build image to inspect the build log and retry.',
	],
])
	test(`6.1 startup failure is recorded: ${failure}`, async (t) => {
		const r = await setup(t);
		r.failures[failure] = true;
		const trigger = r.triggers.create(r.bot.id, draft());
		await r.triggers.runNow(r.bot.id, trigger.id);
		await flush();
		const firing = r.triggers.firings(r.bot.id)[0];
		assert.equal(firing.outcome, 'failed');
		assert.equal(firing.reason, reason);
	});

test('6.1 engine unavailable during startup produces a durable failed firing without a session', async (t) => {
	const r = await setup(t);
	r.failures.engine = true;
	await r.service.reconcile();
	const trigger = r.triggers.create(r.bot.id, draft());
	const result = await r.triggers.runNow(r.bot.id, trigger.id);
	assert.equal(result.sessionId, null);
	assert.equal(result.outcome, 'failed');
	assert.equal(result.reason, 'container engine unavailable');
	assert.equal(
		new BotStore(join(r.root, 'bots.json')).firings(r.bot.id)[0].reason,
		result.reason,
	);
});

test('6.1 cron preview uses automation parser/zone, upcoming merges seven days and paginates equal timestamps', async (t) => {
	const r = await setup(t, { zone: 'Europe/London' });
	const cron = r.triggers.create(
		r.bot.id,
		draft({ kind: 'cron', cron: '0 9 * * 1-5' }),
	);
	assert.deepEqual(
		r.triggers.preview(cron.condition),
		[5, 6, 7, 8, 9].map((day) => Date.parse(`2026-01-0${day}T09:00:00Z`)),
	);
	r.triggers.create(
		r.bot.id,
		draft({ kind: 'every', intervalMs: HOUR }, { name: 'Hourly' }),
	);
	r.triggers.create(
		r.bot.id,
		draft({ kind: 'cron', cron: '0 9 * * *' }, { name: 'Daily' }),
	);
	const all = r.triggers.upcoming(r.bot.id, start, start + 7 * 24 * HOUR);
	assert.equal(all.next, null);
	assert.ok(all.firings.length > 168);
	assert.deepEqual(
		all.firings.map((f) => f.at),
		all.firings.map((f) => f.at).sort((a, b) => a - b),
	);
	const paged = [];
	let after;
	do {
		const page = r.triggers.upcoming(
			r.bot.id,
			start,
			start + 7 * 24 * HOUR,
			3,
			after,
		);
		paged.push(...page.firings);
		after = page.next ?? undefined;
	} while (after);
	assert.deepEqual(paged, all.firings);
});

for (const [label, at] of [
	['spring forward', '2026-03-29T00:30:00Z'],
	['fall back', '2026-10-25T00:30:00Z'],
])
	test(`6.1 every is elapsed through ${label}; save and enable reset anchor`, async (t) => {
		const r = await setup(t, {
			at: Date.parse(at),
			zone: 'Europe/London',
			autoComplete: true,
		});
		const anchor = r.time.now,
			trigger = r.triggers.create(
				r.bot.id,
				draft({ kind: 'every', intervalMs: HOUR }),
			);
		await r.time.advance(anchor + 2 * HOUR, r.engine);
		assert.deepEqual(
			r.triggers
				.firings(r.bot.id)
				.map((f) => f.firedAt)
				.sort((a, b) => a - b),
			[anchor + HOUR, anchor + 2 * HOUR],
		);
		await r.time.advance(anchor + 2 * HOUR + MINUTE, r.engine);
		r.triggers.update(
			r.bot.id,
			trigger.id,
			draft({ kind: 'every', intervalMs: HOUR }),
		);
		assert.equal(r.engine.armedFor, anchor + 3 * HOUR);
		r.triggers.enable(r.bot.id, trigger.id, false);
		assert.equal(r.time.timers.size, 0);
		await r.time.advance(anchor + 3 * HOUR, r.engine);
		r.triggers.enable(r.bot.id, trigger.id, true);
		assert.equal(r.engine.armedFor, anchor + 4 * HOUR);
	});

test('6.1 restart keeps interval anchor, records missed firings until dismissed, disables missed once, never catches up', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-triggers-restart-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = await setup(t, { root, keepRoot: true });
	const interval = first.triggers.create(
		first.bot.id,
		draft({ kind: 'every', intervalMs: 6 * HOUR }),
	);
	const once = first.triggers.create(
		first.bot.id,
		draft({ kind: 'once', at: start + HOUR }),
	);
	first.triggers.stop();
	first.engine.stop();
	const second = await setup(t, { root, keepRoot: true, at: start + 4 * HOUR });
	assert.equal(second.engine.armedFor, start + 6 * HOUR);
	assert.equal(second.turns.length, 0);
	assert.equal(second.bots.trigger(second.bot.id, once.id).missedCount, 1);
	assert.equal(second.bots.trigger(second.bot.id, once.id).enabled, false);
	second.triggers.stop();
	second.engine.stop();
	const third = await setup(t, { root, keepRoot: true, at: start + 19 * HOUR });
	assert.equal(
		third.bots.trigger(third.bot.id, interval.id).condition.anchor,
		start,
	);
	assert.equal(third.bots.trigger(third.bot.id, interval.id).missedCount, 3);
	assert.equal(third.bots.trigger(third.bot.id, once.id).missedCount, 1);
	assert.equal(third.turns.length, 0);
	assert.equal(third.engine.armedFor, start + 24 * HOUR);
	third.triggers.dismissMissed(third.bot.id, interval.id);
	assert.equal(
		new BotStore(join(root, 'bots.json')).trigger(third.bot.id, interval.id)
			.missedCount,
		0,
	);
});

test('6.1 sleep skips late bot ticks without changing the next deadline', async (t) => {
	const r = await setup(t, { autoComplete: true });
	const trigger = r.triggers.create(r.bot.id, draft());
	await r.time.wake(start + 16 * MINUTE + 1, r.engine);
	assert.equal(r.turns.length, 0);
	assert.equal(r.bots.trigger(r.bot.id, trigger.id).missedCount, 3);
	await r.time.wake(start + 30 * MINUTE + 500, r.engine);
	assert.equal(r.turns.length, 1);
	assert.equal(r.bots.trigger(r.bot.id, trigger.id).missedCount, 5);
	assert.equal(r.time.timers.size, 1);
	assert.equal(r.engine.armedFor, start + 35 * MINUTE);
});

const agentEntry = (id, state) => ({
	entryId: id,
	kind: 'root',
	provider: 'Fake',
	harness: 'Fake ACP',
	terminalSessionId: id,
	state,
});
const snapshot = (entries) => ({
	entries: Object.fromEntries(entries.map((e) => [e.entryId, e])),
});
test('project events are refused for new triggers and do not subscribe bots to workspace events', async (t) => {
	const r = await setup(t);
	assert.throws(
		() =>
			r.triggers.create(
				r.bot.id,
				draft({ kind: 'event', event: 'agent.needsInput' }),
			),
		/unsupported/,
	);
	assert.equal(r.sessions.list(r.bot.id).length, 0);
	const condition = {
		kind: 'files',
		path: '/home/bot/watch',
		debounceMs: 5000,
	};
	assert.deepEqual(r.triggers.preview(condition), []);
});

function backend() {
	let state;
	return {
		load: async () => state,
		commit: async (s) => {
			state = structuredClone(s);
		},
		backup: async () => {},
	};
}
test('6.1 bot and automation share one deadline and each fire once with unchanged automation log', async (t) => {
	const r = await setup(t, { autoComplete: true });
	const repository = new AutomationRepository(backend(), {
		now: () => r.time.now,
	});
	await repository.load();
	await repository.upsert({
		id: 'hourly',
		name: 'Hourly',
		trigger: { kind: 'schedule', cron: '0 * * * *' },
		action: { kind: 'runCommand', command: 'true' },
	});
	const runLog = new AutomationRunLog(backend(), { now: () => r.time.now });
	const scheduler = new AutomationScheduler({
		engine: r.engine,
		repository,
		runLog,
		timeZone: 'UTC',
		clock: r.time.clock,
		controller: () => ({
			async start(request) {
				return runLog.record({
					runId: 'automation-run',
					automationId: 'hourly',
					triggerKind: 'schedule',
					firedAt: request.firedAt,
					startedBy: 'trigger',
					status: 'finished',
					outcome: 'succeeded',
					startedAt: request.firedAt,
					finishedAt: request.firedAt,
					durationMs: 0,
					suppressedEvents: 0,
				});
			},
		}),
	});
	await scheduler.start();
	t.after(() => scheduler.stop());
	r.triggers.create(r.bot.id, draft({ kind: 'cron', cron: '0 * * * *' }));
	assert.equal(r.time.timers.size, 1);
	await r.time.advance(start + HOUR, r.engine);
	assert.equal(r.turns.length, 1);
	assert.equal(runLog.get('automation-run').outcome, 'succeeded');
	assert.equal(runLog.get('automation-run').firedAt, start + HOUR);
	assert.equal(runLog.get('automation-run').suppressedEvents, 0);
});

test('6.1 bot deletion removes its triggers and firings; durable store recovers the previous committed trigger state', async (t) => {
	const r = await setup(t, { autoComplete: true });
	const trigger = r.triggers.create(r.bot.id, draft());
	r.triggers.update(
		r.bot.id,
		trigger.id,
		draft(undefined, { prompt: 'changed' }),
	);
	const path = join(r.root, 'bots.json');
	writeFileSync(path, 'broken');
	const recovered = new BotStore(path);
	assert.equal(recovered.trigger(r.bot.id, trigger.id).prompt, trigger.prompt);
	assert.ok(readdirSync(r.root).some((n) => n.includes('.corrupt-')));
	// Continue using the in-memory canonical state after verifying recovery.
	r.triggers.enable(r.bot.id, trigger.id, false);
	await r.triggers.runNow(r.bot.id, trigger.id);
	await flush();
	await r.service.remove(r.bot.id, false, true);
	const disk = JSON.parse(readFileSync(path, 'utf8'));
	assert.deepEqual(disk.triggers, []);
	assert.deepEqual(disk.firings, []);
});

test('6.1 new trigger protocol handlers reject unauthorized and capability-bound callers', async (t) => {
	const r = await setup(t);
	const registry = createBotOperations(r.service);
	for (const [operation, handler] of Object.entries({
		...registry.queries,
		...registry.commands,
	}).filter(([name]) => name.startsWith('bots.triggers.')))
		for (const context of [
			{ authScope: 'read' },
			{ authScope: 'write', claims: { capabilityId: 'token' } },
		])
			await assert.rejects(
				async () =>
					handler({
						envelope: { payload: { botId: r.bot.id } },
						context: {
							connectionId: 'conn',
							clientId: 'client',
							signal: new AbortController().signal,
							...context,
						},
					}),
				(e) => e.code === 'forbidden',
				operation,
			);
});

for (const action of ['disable', 'delete'])
	test(`6.1 ${action} while send awaits context cancels the firing before it can acquire a turn`, async (t) => {
		const r = await setup(t);
		const trigger = r.triggers.create(r.bot.id, draft());
		const original = r.service.memories.context.bind(r.service.memories);
		let entered, release;
		const started = new Promise((resolve) => {
			entered = resolve;
		});
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		r.service.memories.context = async (bot) => {
			entered();
			await gate;
			return original(bot);
		};
		const sending = r.triggers.runNow(r.bot.id, trigger.id);
		await started;
		if (action === 'disable') r.triggers.enable(r.bot.id, trigger.id, false);
		else r.triggers.remove(r.bot.id, trigger.id);
		release();
		const firing = await sending;
		await flush();
		assert.equal(firing.outcome, 'skipped');
		assert.equal(firing.reason, 'cancelled');
		assert.equal(r.turns.length, 0);
		assert.equal(r.service.queue.list(r.bot.id).length, 0);
	});

test('restart restores queued accepted events with the same session and skips only orphan legacy firings', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-trigger-pending-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = await setup(t, { root, keepRoot: true });
	await first.service.send(first.bot.id, 'hold');
	for (let n = 0; n < 3; n++) await first.service.send(first.bot.id, 'hold');
	await flush();
	const trigger = first.triggers.create(first.bot.id, draft());
	const pending = await first.triggers.runNow(first.bot.id, trigger.id);
	first.bots.putFiring({ ...pending, id: 'a'.repeat(24), sessionId: null });
	first.triggers.stop();
	first.engine.stop();
	const second = await setup(t, { root, keepRoot: true, at: start + MINUTE });
	await flush();
	const firings = second.triggers.firings(second.bot.id);
	assert.equal(firings.length, 2);
	assert.equal(firings.find((f) => f.id === 'a'.repeat(24)).outcome, 'skipped');
	const restored = firings.find((f) => f.id === pending.id);
	assert.equal(restored.sessionId, pending.sessionId);
	assert.equal(
		second.sessions
			.list(second.bot.id)
			.filter((s) => s.id === pending.sessionId).length,
		1,
	);
	assert.equal(second.turns.length, 1);
});

test('all legacy project event kinds are rejected and stored definitions are retained disabled', async (t) => {
	const r = await setup(t);
	for (const event of [
		'agent.finished',
		'agent.needsInput',
		'agent.blocked',
		'terminal.needsAttention',
		'terminal.commandFinished',
		'terminal.idle',
		'project.opened',
		'project.closed',
		'device.connected',
	])
		assert.throws(
			() => r.triggers.create(r.bot.id, draft({ kind: 'event', event })),
			/unsupported/,
		);
	const trigger = r.triggers.create(r.bot.id, draft());
	r.bots.putTrigger({
		...trigger,
		condition: { kind: 'event', event: 'project.opened' },
	});
	const stored = new BotStore(join(r.root, 'bots.json')).triggers(r.bot.id)[0];
	assert.equal(stored.enabled, false);
	assert.match(stored.unsupported, /unsupported/);
});

test('generic command checks do not wake AI on nonmatches; tests leave memory unchanged and new items start independent sessions', async (t) => {
	let items = [{ id: 1 }, { id: 2 }];
	const calls = [];
	const sources = {
		protect: async (_b, _t, s) => s,
		async run(botId, source, options, observe) {
			calls.push({ botId, source, options });
			await observe({ stdout: JSON.stringify(items), stderr: '', exitCode: 0 });
		},
	};
	const r = await setup(t, { sources });
	const trigger = r.triggers.create(
		r.bot.id,
		draft({
			kind: 'command',
			command: 'list --json',
			intervalMs: 60000,
			match: { kind: 'items', items: '', identity: '/id' },
		}),
	);
	const test = await r.triggers.test(r.bot.id, trigger.condition, trigger.id);
	assert.equal(test.wouldFire, 2);
	assert.equal(r.triggers.memory(r.bot.id, trigger.id).total, 0);
	assert.equal(r.turns.length, 0);
	await r.triggers.runNow(r.bot.id, trigger.id);
	await flush();
	assert.equal(r.sessions.list(r.bot.id).length, 2);
	assert.equal(r.triggers.memory(r.bot.id, trigger.id).total, 2);
	await r.time.advance(start + MINUTE, r.engine);
	await flush();
	assert.equal(r.sessions.list(r.bot.id).length, 2);
	items = [{ id: 1 }, { id: 3 }];
	await r.time.advance(start + 2 * MINUTE, r.engine);
	await flush();
	assert.equal(r.sessions.list(r.bot.id).length, 3);
	assert.ok(calls.every((c) => c.botId === r.bot.id));
	assert.equal(
		r.triggers.list(r.bot.id).triggers[0].health.lastSuccess,
		start + 2 * MINUTE,
	);
});

for (const [policy, checks] of [
	['skip', 0],
	['once', 1],
	['replay', 3],
])
	test(`source recovery ${policy} after server downtime`, async (t) => {
		let count = 0;
		const sources = {
			protect: async (_b, _t, s) => s,
			async run(_bot, _source, _options, observe) {
				count++;
				await observe({ stdout: 'unchanged', stderr: '', exitCode: 0 });
			},
		};
		const r = await setup(t, { sources });
		r.triggers.create(
			r.bot.id,
			draft(
				{
					kind: 'command',
					command: 'status',
					intervalMs: 60000,
					match: { kind: 'changed' },
				},
				{ recovery: policy },
			),
		);
		await r.time.wake(start + 3 * MINUTE + 10000, r.engine);
		await flush();
		await flush();
		await r.triggers.idle();
		assert.equal(count, checks);
		assert.equal(r.turns.length, 0);
	});

test('bot Disable persists, pauses checks and manual operations; Enable skips disabled-period work', async (t) => {
	let count = 0;
	const sources = {
		protect: async (_b, _t, s) => s,
		async run(_bot, _source, _options, observe) {
			count++;
			await observe({ stdout: 'ready', stderr: '', exitCode: 0 });
		},
	};
	const r = await setup(t, { sources });
	const trigger = r.triggers.create(
		r.bot.id,
		draft(
			{
				kind: 'command',
				command: 'check',
				intervalMs: 60000,
				match: { kind: 'contains', text: 'ready' },
			},
			{ recovery: 'replay' },
		),
	);
	r.service.enableBot(r.bot.id, false);
	assert.equal(
		new BotStore(join(r.root, 'bots.json')).get(r.bot.id).enabled,
		false,
	);
	await r.time.wake(start + 10 * MINUTE, r.engine);
	assert.equal(count, 0);
	await assert.rejects(r.triggers.runNow(r.bot.id, trigger.id), /disabled/);
	await assert.rejects(
		r.triggers.test(r.bot.id, trigger.condition),
		/disabled/,
	);
	await assert.rejects(r.service.send(r.bot.id, 'hello'), /disabled/);
	r.service.enableBot(r.bot.id, true);
	await r.time.advance(start + 11 * MINUTE, r.engine);
	await r.triggers.idle();
	assert.equal(count, 1);
	assert.equal(r.turns.length, 0);
});

test('a source disabled during asynchronous redaction cannot accept a late result; disabled-trigger Run now remains explicit', async (t) => {
	const sources = {
		protect: async (_b, _t, s) => s,
		run: async (_b, _s, _o, observe) =>
			observe({ stdout: 'ready', exitCode: 0 }),
	};
	const r = await setup(t, { sources });
	const trigger = r.triggers.create(
		r.bot.id,
		draft({
			kind: 'command',
			command: 'check',
			intervalMs: 60000,
			match: { kind: 'contains', text: 'ready' },
		}),
	);
	const original = r.service.redactMessage.bind(r.service);
	let release, entered;
	const arrived = new Promise((resolve) => (entered = resolve));
	const paused = new Promise((resolve) => (release = resolve));
	r.service.redactMessage = async (...args) => {
		entered();
		await paused;
		return original(...args);
	};
	const work = r.time.advance(start + MINUTE, r.engine);
	await arrived;
	r.triggers.enable(r.bot.id, trigger.id, false);
	release();
	await work;
	await r.triggers.idle();
	assert.equal(r.triggers.memory(r.bot.id, trigger.id).total, 0);
	assert.equal(r.sessions.list(r.bot.id).length, 0);
	r.service.redactMessage = original;
	await r.triggers.runNow(r.bot.id, trigger.id);
	await flush();
	assert.equal(r.sessions.list(r.bot.id).length, 1);
	assert.equal(r.bots.trigger(r.bot.id, trigger.id).enabled, false);
});

test('continuous restart exposes its gap and resumes an SSE cursor without duplicate sessions', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-source-resume-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const cursors = [];
	const sources = {
		protect: async (_b, _t, s) => s,
		async run(_b, _s, options, observe) {
			cursors.push(options.cursor);
			await observe({ status: 'connected' });
			await observe({ eventId: 'stable-1', data: { id: 1 } });
			await new Promise((resolve) => {
				if (options.signal.aborted) resolve();
				else options.signal.addEventListener('abort', resolve, { once: true });
			});
		},
	};
	const first = await setup(t, { root, keepRoot: true, sources });
	first.triggers.create(
		first.bot.id,
		draft(
			{ kind: 'sse', url: 'https://fixture.invalid/events' },
			{ recovery: 'recover-available' },
		),
	);
	await flush();
	await flush();
	const trigger = first.bots.triggers(first.bot.id)[0];
	assert.equal(first.triggers.memory(first.bot.id, trigger.id).total, 1);
	first.triggers.stop();
	first.engine.stop();
	await first.triggers.idle();
	const second = await setup(t, {
		root,
		keepRoot: true,
		sources,
		at: start + MINUTE,
	});
	await flush();
	await flush();
	assert.equal(cursors.at(-1), 'stable-1');
	assert.match(
		second.triggers.list(second.bot.id).triggers[0].health.gap,
		/Server restarted/,
	);
	assert.equal(second.triggers.memory(second.bot.id, trigger.id).total, 1);
	assert.equal(second.triggers.firings(second.bot.id).length, 1);
});

const commandDraft = () =>
	draft({
		kind: 'command',
		command: 'poll.sh',
		intervalMs: 60000,
		match: { kind: 'items', items: '', identity: '/id' },
	});
for (const [label, stats, error, cause] of [
	[
		'at the process limit',
		{ PIDs: 1020, PidsLimit: 1024 },
		'The bot container has run out of processes (1020 of 1024). Restart the bot container.',
		'processes',
	],
	['below the process limit', { PIDs: 10, PidsLimit: 1024 }, 'The agent could not start a process (EAGAIN).', null],
	['without engine stats', new Error('stats down'), 'The agent could not start a process (EAGAIN).', null],
])
	test(`a condition command that cannot spawn ${label} records the classified health error and cause`, async (t) => {
		const sources = {
			protect: async (_b, _t, s) => s,
			async run() {
				throw new Error(
					'OCI runtime exec failed: exec failed: unable to start container process: resource temporarily unavailable',
				);
			},
		};
		const r = await setup(t, { sources });
		r.driver.stats = stats;
		const trigger = r.triggers.create(r.bot.id, commandDraft());
		await r.time.advance(start + MINUTE, r.engine);
		await flush();
		const health = r.triggers.list(r.bot.id).triggers.find((x) => x.id === trigger.id).health;
		assert.equal(health.state, 'failed');
		assert.equal(health.error, error);
		assert.equal(health.cause ?? null, cause);
	});

test('a condition that fails for an ordinary reason has no cause', async (t) => {
	const sources = {
		protect: async (_b, _t, s) => s,
		async run() {
			throw new Error('poll.sh exited 1');
		},
	};
	const r = await setup(t, { sources });
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await flush();
	const health = r.triggers.list(r.bot.id).triggers.find((x) => x.id === trigger.id).health;
	assert.equal(health.error, 'poll.sh exited 1');
	assert.equal(health.cause ?? null, null);
});

test('a firing that cannot start records the structured cause on the firing and health', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft());
	r.service.enableBot(r.bot.id, false);
	r.service.enableBot(r.bot.id, true);
	r.failures.agent = true;
	r.bots.save({ ...r.bots.get(r.bot.id), signIn: { kind: 'none' } });
	await r.time.advance(start + 5 * MINUTE, r.engine);
	await flush();
	const firing = r.triggers.firings(r.bot.id).find((f) => f.triggerId === trigger.id);
	assert.equal(firing.outcome, 'failed');
	assert.equal(firing.cause, 'agent');
	assert.equal(
		r.triggers.list(r.bot.id).triggers.find((x) => x.id === trigger.id).health.cause,
		'agent',
	);
});

const investigations = (r) =>
	r.sessions.list(r.bot.id).filter((s) => s.origin.kind === 'failure');
async function settle(r) {
	for (let i = 0; i < 5; i++) {
		await r.service.failureFollowUps.idle(r.bot.id);
		await flush();
	}
}
function switchable() {
	const state = { fail: true, error: 'poll.sh exited 1' };
	return {
		state,
		sources: {
			protect: async (_b, _t, s) => s,
			async run(_bot, _source, _options, observe) {
				if (state.fail) throw new Error(state.error);
				await observe({ stdout: '[]', stderr: '', exitCode: 0 });
			},
		},
	};
}
const healthOf = (r, trigger) =>
	r.triggers.list(r.bot.id).triggers.find((x) => x.id === trigger.id).health;

test('a condition failure episode wakes the bot once until a check succeeds', async (t) => {
	const s = switchable();
	const r = await setup(t, { sources: s.sources });
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await settle(r);
	assert.equal(investigations(r).length, 1);
	const [ref] = investigations(r)[0].origin.failures;
	assert.deepEqual(
		{ kind: ref.kind, triggerId: ref.triggerId, triggerName: ref.triggerName, reason: ref.reason },
		{ kind: 'condition', triggerId: trigger.id, triggerName: 'Nightly', reason: 'poll.sh exited 1' },
	);
	await finish(r, investigations(r)[0].id);
	// failed → checking → failed is one episode.
	await r.time.advance(start + 2 * MINUTE, r.engine);
	await settle(r);
	assert.equal(healthOf(r, trigger).state, 'failed');
	assert.equal(investigations(r).length, 1);
	// Recovery ends the episode; the next failure starts a new one.
	s.state.fail = false;
	await r.time.advance(start + 3 * MINUTE, r.engine);
	await settle(r);
	assert.equal(healthOf(r, trigger).state, 'healthy');
	s.state.fail = true;
	await r.time.advance(start + 4 * MINUTE, r.engine);
	await settle(r);
	assert.equal(healthOf(r, trigger).state, 'failed');
	assert.equal(investigations(r).length, 2);
});

test('a restart during a condition failure episode does not wake the bot again', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-triggers-episode-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const s = switchable();
	const first = await setup(t, { root, keepRoot: true, sources: s.sources, autoComplete: true });
	const trigger = first.triggers.create(first.bot.id, commandDraft());
	await first.time.advance(start + MINUTE, first.engine);
	await settle(first);
	assert.equal(investigations(first).length, 1);
	first.triggers.stop();
	first.engine.stop();
	await first.service.shutdown();
	const second = await setup(t, { root, keepRoot: true, sources: s.sources, at: start + 2 * MINUTE, autoComplete: true });
	await second.time.advance(start + 4 * MINUTE, second.engine);
	await settle(second);
	assert.equal(healthOf(second, trigger).state, 'failed');
	assert.equal(investigations(second).length, 1);
});

test('a condition check that fails because the container is out of processes does not wake the bot', async (t) => {
	const s = switchable();
	s.state.error =
		'OCI runtime exec failed: exec failed: unable to start container process: resource temporarily unavailable';
	const r = await setup(t, { sources: s.sources });
	r.driver.stats = { PIDs: 1020, PidsLimit: 1024 };
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await settle(r);
	assert.equal(healthOf(r, trigger).cause, 'processes');
	assert.equal(investigations(r).length, 0);
});

test('a firing that cannot start a session is reported exactly once', async (t) => {
	const r = await setup(t, { autoComplete: true });
	const trigger = r.triggers.create(r.bot.id, draft());
	const original = r.service.send.bind(r.service);
	let failNext = true;
	r.service.send = async (...args) => {
		if (failNext && args[3]?.kind === 'trigger') {
			failNext = false;
			throw new Error('The bot queue rejected this firing.');
		}
		return original(...args);
	};
	await r.time.advance(start + 5 * MINUTE, r.engine);
	await settle(r);
	assert.equal(healthOf(r, trigger).state, 'failed');
	const listed = investigations(r).flatMap((s) => s.origin.failures);
	assert.equal(listed.length, 1);
	assert.equal(listed[0].kind, 'firing');
	assert.equal(listed[0].sessionId, null);
	assert.equal(listed[0].triggerId, trigger.id);
	assert.match(listed[0].firingId, /^[a-z0-9]{24}$/);
});

test('a failed trigger execution wakes the bot once, naming the execution and trigger', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft());
	await r.time.advance(start + 5 * MINUTE, r.engine);
	await flush();
	const run = r.sessions.list(r.bot.id).find((s) => s.origin.kind === 'trigger');
	r.sessions.patch(run.id, {
		state: 'failed',
		reason: 'script.sh: line 3: jq: not found',
		endedAt: r.time.now,
		open: false,
	});
	await settle(r);
	const listed = investigations(r).flatMap((s) => s.origin.failures);
	assert.equal(listed.length, 1);
	assert.equal(listed[0].kind, 'execution');
	assert.equal(listed[0].sessionId, run.id);
	assert.equal(listed[0].triggerId, trigger.id);
	assert.equal(listed[0].reason, 'script.sh: line 3: jq: not found');
});

const triggerRuns = (r) =>
	r.sessions
		.list(r.bot.id)
		.filter((s) => s.origin.kind === 'trigger')
		.sort((a, b) => a.startedAt - b.startedAt);
const captureErrors = (t) => {
	const logged = [];
	t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
	return logged;
};
test('an engine error while ending a completed trigger turn does not block later firings', async (t) => {
	const logged = captureErrors(t);
	const r = await setup(t, { keepRoot: true });
	t.after(() => rmSync(r.root, { recursive: true, force: true }));
	r.triggers.create(r.bot.id, draft());
	r.failures.kill = 1;
	await r.time.advance(start + 5 * MINUTE, r.engine);
	const [first] = triggerRuns(r);
	assert.ok(first, 'the first firing started a session');
	await finish(r, first.id);
	await flush();
	// The agent answered; only the post-turn kill exec failed.
	assert.equal(r.sessions.get(first.id).state, 'completed');
	const stored = new BotSessionStore(
		join(r.root, 'sessions'),
		r.time.clock,
		() => r.time.now,
	).get(first.id);
	assert.match(stored.runnerOutput, /Cleanup failed: .*container process failed/);
	assert.equal(stored.state, 'completed');
	assert.ok(
		logged.some(
			(l) => l.includes('bot cleanup failed') && l.includes(first.id),
		),
	);
	await r.time.advance(start + 10 * MINUTE, r.engine);
	await flush();
	assert.equal(triggerRuns(r).length, 2, 'the next firing started a session');
	assert.equal(r.turns.length, 2, 'the next firing reached the agent');
});

test('a turn that fails cleanup releases its shared work ownership', async (t) => {
	captureErrors(t);
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft());
	r.failures.kill = 1;
	await r.time.advance(start + 5 * MINUTE, r.engine);
	const [first] = triggerRuns(r);
	assert.equal(
		(await r.service.runtime.call(first.id, 'work_acquire', {})).acquired,
		true,
	);
	await finish(r, first.id);
	await flush();
	await r.time.advance(start + 10 * MINUTE, r.engine);
	await flush();
	const second = triggerRuns(r)[1];
	assert.equal(
		(await r.service.runtime.call(second.id, 'work_acquire', {})).acquired,
		true,
	);
});

test('a stopped or timed-out turn keeps its outcome when cleanup fails', async (t) => {
	captureErrors(t);
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft());
	r.failures.kill = 2;
	await r.time.advance(start + 5 * MINUTE, r.engine);
	const [first] = triggerRuns(r);
	await assert.rejects(r.service.stop(r.bot.id, first.id), /cleanup failed/);
	await flush();
	assert.equal(r.sessions.get(first.id).state, 'stopped');
	assert.match(r.sessions.get(first.id).runnerOutput, /Cleanup failed:/);
	await r.time.advance(start + 10 * MINUTE, r.engine);
	const second = triggerRuns(r)[1];
	await assert.rejects(r.service.closeLive(second.id, 'timeout'));
	await flush();
	assert.equal(r.sessions.get(second.id).state, 'timed-out');
	// Two failures: the bot still admits work.
	await r.time.advance(start + 15 * MINUTE, r.engine);
	assert.equal(triggerRuns(r).length, 3);
});

test('three consecutive cleanup failures block the bot without waking a failure investigation', async (t) => {
	captureErrors(t);
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft());
	r.failures.kill = 3;
	for (const n of [1, 2, 3]) {
		await r.time.advance(start + n * 5 * MINUTE, r.engine);
		await finish(r, triggerRuns(r).at(-1).id);
		await flush();
	}
	await settle(r);
	const [a, b, c] = triggerRuns(r);
	assert.equal(r.sessions.get(a.id).state, 'completed');
	assert.equal(r.sessions.get(b.id).state, 'completed');
	const blocked = r.sessions.get(c.id);
	assert.equal(blocked.state, 'failed');
	assert.equal(blocked.cause, 'engine');
	assert.equal(
		blocked.reason,
		'bot blocked after 3 consecutive cleanup failures',
	);
	assert.equal(investigations(r).length, 0);
	await r.time.advance(start + 20 * MINUTE, r.engine);
	await flush();
	assert.equal(r.turns.length, 3, 'the fourth firing never reached the agent');
	await assert.rejects(r.service.send(r.bot.id, 'hello?'));
	assert.equal(r.turns.length, 3, 'a chat message never reached the agent');
});

test('a cleanup error is redacted with the bot secrets in runner output and logs', async (t) => {
	const logged = captureErrors(t);
	const r = await setup(t);
	r.service.redactMessage = async (_bot, v) =>
		v.split('s3cret').join('[redacted]');
	r.triggers.create(r.bot.id, draft());
	r.failures.kill = 1;
	r.failures.killMessage = 'exec failed with token s3cret';
	await r.time.advance(start + 5 * MINUTE, r.engine);
	const [first] = triggerRuns(r);
	await finish(r, first.id);
	await flush();
	const output = r.sessions.get(first.id).runnerOutput;
	assert.match(output, /Cleanup failed: .*\[redacted\]/);
	assert.doesNotMatch(output, /s3cret/);
	assert.ok(logged.some((l) => l.includes('[redacted]')));
	assert.ok(logged.every((l) => !l.includes('s3cret')));
});

test('reconciliation unblocks a blocked bot only after ending every session process group', async (t) => {
	captureErrors(t);
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft());
	r.failures.kill = 3;
	for (const n of [1, 2, 3]) {
		await r.time.advance(start + n * 5 * MINUTE, r.engine);
		await finish(r, triggerRuns(r).at(-1).id);
		await flush();
	}
	r.service.hooks.environment.state = () => 'running';
	const exec = r.driver.exec.bind(r.driver);
	const killAll = [];
	let failKillAll = true;
	r.driver.exec = async (container, args, options) => {
		if (args[1] === '--kill-all') {
			killAll.push(options);
			if (failKillAll) throw new Error('engine operation deadline exceeded');
		}
		return exec(container, args, options);
	};
	await r.service.reconcile();
	await assert.rejects(r.service.send(r.bot.id, 'still blocked?'));
	failKillAll = false;
	await r.service.reconcile();
	await r.service.send(r.bot.id, 'unblocked');
	assert.ok(killAll.every((o) => o.deadlineMs === 5 * MINUTE));
	assert.ok(killAll.length >= 2);
});

test('a condition check that cannot reach the engine records the engine cause and does not wake the bot', async (t) => {
	const { EngineCommandError } = await import('../dist/botService/index.js');
	const sources = {
		protect: async (_b, _t, s) => s,
		async run() {
			throw new EngineCommandError('not-running', 'bot engine unavailable');
		},
	};
	const r = await setup(t, { sources });
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await settle(r);
	const health = healthOf(r, trigger);
	assert.equal(health.state, 'failed');
	assert.equal(health.error, 'bot engine unavailable');
	assert.equal(health.cause, 'engine');
	assert.equal(investigations(r).length, 0);
});

// ── Interrupted polled checks are retried once ──────────────────────────────
function interrupted(stderr = '', exitCode = 1, cleaned = true) {
	const error = new SourceRunError(
		'interrupted',
		'Source check was interrupted before it reported',
		{ exitCode, stderr },
	);
	error.cleaned = cleaned;
	return error;
}
const ended = (outcome, message, exitCode = null) =>
	Object.assign(new SourceRunError(outcome, message, { exitCode, stderr: '' }), {
		cleaned: true,
	});
// Each check takes the next planned outcome: an Error to throw, a function to
// await, or (when the plan is empty) a successful empty observation.
function planned(outcomes) {
	const state = { runs: 0, active: 0, maxActive: 0, plan: [...outcomes] };
	return {
		state,
		sources: {
			protect: async (_b, _t, s) => s,
			async run(_bot, _source, options, observe) {
				state.runs++;
				state.active++;
				state.maxActive = Math.max(state.maxActive, state.active);
				try {
					const next = state.plan.length ? state.plan.shift() : 'ok';
					if (typeof next === 'function') await next(options);
					else if (next instanceof Error) throw next;
					await observe({ stdout: '[]', stderr: '', exitCode: 0 });
				} finally {
					state.active--;
				}
			},
		},
	};
}
async function retrySetup(t, outcomes, delay = 0) {
	const p = planned(outcomes);
	const r = await setup(t, { sources: p.sources });
	r.triggers.sourceRetryDelayMs = delay;
	return { r, p };
}
const waitFor = async (fn) => {
	for (let i = 0; i < 200 && !fn(); i++)
		await new Promise((resolve) => setTimeout(resolve, 5));
};

test('an interrupted command check that recovers on retry is healthy and wakes nobody', async (t) => {
	const { r, p } = await retrySetup(t, [interrupted('vm frozen')]);
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(
		() => p.state.runs === 2 && healthOf(r, trigger).state === 'healthy',
	);
	await settle(r);
	assert.equal(p.state.runs, 2);
	assert.equal(healthOf(r, trigger).state, 'healthy');
	assert.equal(investigations(r).length, 0);
});

test('an interrupted HTTP check is retried once too', async (t) => {
	const { r, p } = await retrySetup(t, [interrupted()]);
	const trigger = r.triggers.create(
		r.bot.id,
		draft({
			kind: 'http',
			url: 'https://example.test',
			intervalMs: 60000,
			match: { kind: 'changed' },
		}),
	);
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(() => p.state.runs === 2);
	await settle(r);
	assert.equal(p.state.runs, 2);
	assert.notEqual(healthOf(r, trigger).state, 'failed');
	assert.equal(investigations(r).length, 0);
});

test('a check interrupted twice fails with the second reason and wakes the bot once', async (t) => {
	const { r, p } = await retrySetup(t, [
		interrupted('first'),
		interrupted('second', 137),
	]);
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(() => healthOf(r, trigger).state === 'failed');
	await settle(r);
	assert.equal(p.state.runs, 2);
	const health = healthOf(r, trigger);
	assert.equal(health.state, 'failed');
	assert.equal(
		health.error,
		'Source check was interrupted before it reported (exit 137): second',
	);
	assert.doesNotMatch(health.error, /recreate/i);
	assert.equal(investigations(r).length, 1);
	const [ref] = investigations(r)[0].origin.failures;
	assert.equal(ref.triggerId, trigger.id);
	assert.match(ref.reason, /interrupted before it reported/);
});

for (const [label, error] of [
	['deadline', ended('deadline', 'Source check exceeded its 55 s limit')],
	[
		'not-executable worker',
		ended('not-executable', 'The source worker could not be executed', 127),
	],
	['uncleaned interruption', interrupted('', 1, false)],
	['ordinary failure', new Error('poll.sh exited 1')],
])
	test(`a ${label} is not retried`, async (t) => {
		const { r, p } = await retrySetup(t, [error]);
		const trigger = r.triggers.create(r.bot.id, commandDraft());
		await r.time.advance(start + MINUTE, r.engine);
		await waitFor(() => healthOf(r, trigger).state === 'failed');
		await settle(r);
		assert.equal(p.state.runs, 1);
		assert.equal(healthOf(r, trigger).state, 'failed');
	});

test('a trigger test is never retried', async (t) => {
	const { r, p } = await retrySetup(t, [interrupted()]);
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.triggers
		.test(r.bot.id, trigger.condition, trigger.id)
		.catch(() => {});
	assert.equal(p.state.runs, 1);
});

for (const [label, act] of [
	['the trigger is disabled', (r, id) => r.triggers.enable(r.bot.id, id, false)],
	['the trigger is deleted', (r, id) => r.triggers.remove(r.bot.id, id)],
	['the bot is disabled', (r) => r.service.enableBot(r.bot.id, false)],
	[
		'the trigger is edited',
		(r, id) => r.triggers.update(r.bot.id, id, commandDraft()),
	],
])
	test(`a pending retry is cancelled when ${label}`, async (t) => {
		const { r, p } = await retrySetup(t, [interrupted()], 60_000);
		const trigger = r.triggers.create(r.bot.id, commandDraft());
		await r.time.advance(start + MINUTE, r.engine);
		await waitFor(() => healthOf(r, trigger)?.state === 'retrying');
		assert.equal(healthOf(r, trigger).state, 'retrying');
		assert.ok(healthOf(r, trigger).nextRetry > r.time.now);
		act(r, trigger.id);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await settle(r);
		assert.equal(p.state.runs, 1);
		assert.equal(investigations(r).length, 0);
	});

test('a scheduled check due during the retry never overlaps it', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const { r, p } = await retrySetup(t, [interrupted(), () => gate]);
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(() => p.state.runs === 2);
	await r.time.advance(start + 3 * MINUTE, r.engine);
	await flush();
	assert.equal(p.state.maxActive, 1);
	release();
	await waitFor(() => healthOf(r, trigger).state === 'healthy');
	await settle(r);
	assert.equal(p.state.maxActive, 1);
});

test('stderr in a failed check reason is redacted with the bot secrets before it is stored', async (t) => {
	const { r } = await retrySetup(t, [
		interrupted('token s3cret leaked'),
		interrupted('again s3cret'),
	]);
	r.service.redactMessage = async (_bot, v) =>
		v.split('s3cret').join('[redacted]');
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(() => healthOf(r, trigger).state === 'failed');
	await settle(r);
	assert.equal(
		healthOf(r, trigger).error,
		'Source check was interrupted before it reported (exit 1): again [redacted]',
	);
	assert.match(investigations(r)[0].origin.failures[0].reason, /\[redacted\]/);
	assert.doesNotMatch(JSON.stringify(investigations(r)[0].origin), /s3cret/);
});

test('stderr is omitted when redaction is unavailable', async (t) => {
	const { r } = await retrySetup(t, [
		interrupted('secret'),
		interrupted('secret'),
	]);
	const redact = r.service.redactMessage.bind(r.service);
	r.service.redactMessage = async (bot, v) => {
		if (v.includes('secret')) throw new Error('no lease');
		return redact(bot, v);
	};
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(() => healthOf(r, trigger).state === 'failed');
	assert.equal(
		healthOf(r, trigger).error,
		'Source check was interrupted before it reported (exit 1)',
	);
});

test('an interruption with process-limit evidence keeps the processes cause and is not retried', async (t) => {
	const { r, p } = await retrySetup(t, [
		interrupted('bash: fork: Resource temporarily unavailable'),
	]);
	r.driver.stats = { PIDs: 1020, PidsLimit: 1024 };
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await waitFor(() => healthOf(r, trigger).state === 'failed');
	await settle(r);
	assert.equal(p.state.runs, 1);
	assert.equal(healthOf(r, trigger).cause, 'processes');
	assert.equal(investigations(r).length, 0);
});

test('during an open failure episode, a recovered interruption ends the episode without a new wake', async (t) => {
	const { r, p } = await retrySetup(t, [
		new Error('poll.sh exited 1'),
		interrupted(),
	]);
	const trigger = r.triggers.create(r.bot.id, commandDraft());
	await r.time.advance(start + MINUTE, r.engine);
	await settle(r);
	assert.equal(investigations(r).length, 1);
	await finish(r, investigations(r)[0].id);
	await r.time.advance(start + 2 * MINUTE, r.engine);
	await waitFor(
		() => p.state.runs === 3 && healthOf(r, trigger).state === 'healthy',
	);
	await settle(r);
	assert.equal(healthOf(r, trigger).state, 'healthy');
	assert.equal(investigations(r).length, 1);
	// The episode ended, so a later failure starts a new one.
	p.state.plan.push(new Error('poll.sh exited 1'));
	await r.time.advance(start + 3 * MINUTE, r.engine);
	await settle(r);
	assert.equal(investigations(r).length, 2);
});
