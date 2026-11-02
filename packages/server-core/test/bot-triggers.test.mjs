import {relayDriver} from './fixtures/bot-runtime-relay.mjs';
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
	acpCommand: { executable: 'fake', args: [] },
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
		clients = new Map();
	const failures = { engine: false, image: false, agent: false };
	const driver = relayDriver();
	const service = new BotService(bots, sessions, memories, {
		now: () => time.now,
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
					o.onClient(client);
					return client;
				},
				async close(reason) {
					closed.push({ id: o.sessionId, reason });
					client.finish();
                    await o.cleanupRuntime?.();
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
		clients,
		failures,
	};
}
async function finish(r, id) {
	r.clients.get(id).finish();
	await flush();
}

test('runtime trigger CRUD shares UI persistence, validation and events without a work lease', async (t) => {
	const r = await setup(t);
	const { sessionId } = await r.service.send(r.bot.id, 'Manage my triggers');
	const call = (name, args = {}) => r.service.runtime.call(sessionId, name, args);
	const initial = await call('triggers_list');
	assert.equal((await call('sessions_get', { sessionId })).ownsWork, false);
	const created = await call('triggers_create', { revision: initial.revision, draft: draft() });
	const id = created.trigger.id;
	assert.equal(created.trigger.prompt, undefined);
	assert.equal((await call('triggers_get', { triggerId: id })).text, draft().prompt);
	await assert.rejects(call('triggers_create', { revision: initial.revision, draft: draft() }), /revision changed/);
	assert.equal(r.triggers.list(r.bot.id).triggers.length, 1);
	const changed = await call('triggers_update', { triggerId: id, revision: created.revision, draft: draft({ kind: 'cron', cron: '0 9 * * 1-5' }, { name: 'Weekday review', prompt: 'Review this morning' }) });
	const restored = new BotStore(join(r.root, 'bots.json')).trigger(r.bot.id, id);
	assert.equal(restored.name, 'Weekday review');
	assert.equal(restored.prompt, 'Review this morning');
	const disabled = await call('triggers_enable', { triggerId: id, revision: changed.revision, enabled: false });
	assert.equal(disabled.trigger.enabled, false);
	assert.equal(r.triggers.list(r.bot.id).triggers[0].prompt, restored.prompt);
	await assert.rejects(call('triggers_delete', { triggerId: id, revision: changed.revision }), /revision changed/);
	const deleted = await call('triggers_delete', { triggerId: id, revision: disabled.revision });
	assert.equal(deleted.deleted, id);
	assert.equal(new BotStore(join(r.root, 'bots.json')).triggers(r.bot.id).length, 0);
	const events = await call('events_next', { cursor: initial.eventsCursor });
	assert.deepEqual(events.items.filter((e) => e.type.startsWith('trigger.')).map((e) => e.type), ['trigger.created', 'trigger.updated', 'trigger.updated', 'trigger.deleted']);
	assert.ok(!JSON.stringify(events).includes(restored.prompt));
});

test('runtime trigger reads paginate metadata, slice escaped UTF-8 prompts and reject stale/cross-scope cursors', async (t) => {
	const r = await setup(t);
	for (let i = 0; i < 31; i++) r.triggers.create(r.bot.id, draft(undefined, { name: `Task ${i}`, prompt: '😀\n"\\'.repeat(3000) + '\uFFFD' }));
	const { sessionId } = await r.service.send(r.bot.id, 'Inspect my triggers');
	const call = (name, args = {}) => r.service.runtime.call(sessionId, name, args);
	const first = await call('triggers_list');
	assert.equal(first.items.length, 10);
	assert.ok(first.items.every((item) => item.prompt === undefined));
	const seen = [...first.items];
	let cursor = first.nextCursor;
	while (cursor) {
		const page = await call('triggers_list', { cursor, limit: 25 });
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 8192);
		seen.push(...page.items); cursor = page.nextCursor;
	}
	assert.equal(new Set(seen.map((item) => item.id)).size, 31);
	await assert.rejects(call('triggers_list', { limit: 26 }), /limit/);
	await assert.rejects(call('triggers_list', { cursor: first.nextCursor, search: 'different' }), /query/);
	const id = first.items[0].id;
	let prompt = '', detailCursor;
	do {
		const detail = await call('triggers_get', { triggerId: id, cursor: detailCursor });
		assert.ok(Buffer.byteLength(JSON.stringify(detail)) <= 8192);
		assert.ok(!detail.text.slice(0, -1).includes('\uFFFD'));
		prompt += detail.text; detailCursor = detail.nextCursor;
	} while (detailCursor);
	assert.equal(prompt, r.bots.trigger(r.bot.id, id).prompt);
	const detail = await call('triggers_get', { triggerId: id });
	const waiting = call('events_next', { cursor: first.eventsCursor, waitMs: 2000 });
	r.triggers.update(r.bot.id, id, draft(undefined, { name: 'Edited through UI' }));
	assert.equal((await waiting).items[0].type, 'trigger.updated');
	await assert.rejects(call('triggers_list', { cursor: first.nextCursor }), /query/);
	await assert.rejects(call('triggers_get', { triggerId: id, cursor: detail.nextCursor }), /query/);
	const other = r.bots.save({ name: 'Other', agentId: agent.id, signIn: r.bot.signIn });
	const outside = r.triggers.create(other.id, draft());
	const { sessionId: otherSession } = await r.service.send(other.id, 'Inspect own triggers');
	await assert.rejects(r.service.runtime.call(otherSession, 'triggers_list', { cursor: first.nextCursor }), /cursor/i);
	for (const [name, args] of [
		['triggers_get', {}],
		['triggers_update', { revision: r.bots.revision, draft: draft() }],
		['triggers_delete', { revision: r.bots.revision }],
		['triggers_enable', { revision: r.bots.revision, enabled: false }],
		['triggers_run', { revision: r.bots.revision }],
	])
		await assert.rejects(call(name, { triggerId: outside.id, ...args }), /not found/i);
	assert.equal(r.bots.trigger(other.id, outside.id).enabled, true);
	r.service.runtime.revoke(sessionId);
	for (const name of ['triggers_list', 'triggers_create', 'triggers_delete', 'triggers_run'])
		await assert.rejects(call(name, { triggerId: id, revision: r.bots.revision, draft: draft() }), /active/);
});

test('runtime trigger preview, Run now and scheduled firing use the shared scheduler', async (t) => {
	const r = await setup(t, { zone: 'Europe/London' });
	const { sessionId } = await r.service.send(r.bot.id, 'Schedule a check');
	const call = (name, args = {}) => r.service.runtime.call(sessionId, name, args);
	const preview = await call('triggers_preview', { condition: { kind: 'cron', cron: '0 9 * * 1-5' } });
	assert.equal(preview.timeZone, 'Europe/London');
	assert.equal(preview.next.length, 5);
	assert.equal(new Date(preview.next[0]).toISOString(), '2026-01-05T09:00:00.000Z');
	assert.deepEqual((await call('triggers_preview', { condition: { kind: 'event', event: 'agent.finished' } })).next, []);
	await assert.rejects(call('triggers_preview', { condition: { kind: 'every', intervalMs: 120000 } }), /5 minutes/);
	const created = await call('triggers_create', { revision: r.bots.revision, draft: draft({ kind: 'once', at: start + MINUTE }, { enabled: false }) });
	const run = await call('triggers_run', { triggerId: created.trigger.id, revision: created.revision });
	assert.notEqual(run.firing.sessionId, sessionId);
	assert.equal(r.sessions.get(run.firing.sessionId).origin.kind, 'run-now');
	assert.equal(r.bots.trigger(r.bot.id, created.trigger.id).enabled, false);
	await assert.rejects(call('triggers_run', { triggerId: created.trigger.id, revision: created.revision }), /revision changed/);
	assert.equal(r.triggers.firings(r.bot.id).length, 1);
	await finish(r, run.firing.sessionId);
	await call('triggers_enable', { triggerId: created.trigger.id, revision: r.bots.revision, enabled: true });
	const cursor = r.service.messages.eventCursor(r.bot.id);
	await r.time.advance(start + MINUTE, r.engine);
	assert.equal(r.bots.trigger(r.bot.id, created.trigger.id).enabled, false);
	assert.equal(r.sessions.list(r.bot.id).filter((s) => s.origin.kind === 'trigger').length, 1);
	assert.ok(r.service.messages.events(r.bot.id, cursor).items.some((e) => e.type === 'trigger.updated'));
});

test('runtime trigger mutation guards reject invalid drafts, forged scope, limits and stale writes', async (t) => {
	const r = await setup(t);
	const { sessionId } = await r.service.send(r.bot.id, 'Manage schedules');
	const call = (name, args = {}) => r.service.runtime.call(sessionId, name, args);
	for (const bad of [draft(undefined, { prompt: '' }), draft(undefined, { prompt: 'x'.repeat(32769) }), draft({ kind: 'every', intervalMs: 120000 }), draft({ kind: 'event', event: 'invented' }), draft(undefined, { botId: 'forged' }), draft({ kind: 'every', intervalMs: 300000, anchor: 0 })])
		await assert.rejects(call('triggers_create', { revision: r.bots.revision, draft: bad }));
	await assert.rejects(call('triggers_create', { revision: null, draft: draft() }), /revision/);
	await assert.rejects(call('triggers_list', { botId: 'forged' }), /argument/);
	assert.equal(r.bots.triggers(r.bot.id).length, 0);
	const revision = r.bots.revision;
	const racing = await Promise.allSettled([
		call('triggers_create', { revision, draft: draft() }),
		call('triggers_create', { revision, draft: draft() }),
	]);
	assert.equal(racing.filter((result) => result.status === 'fulfilled').length, 1);
	assert.equal(racing.filter((result) => result.status === 'rejected').length, 1);
	assert.equal(r.bots.triggers(r.bot.id).length, 1);
	r.triggers.remove(r.bot.id, r.bots.triggers(r.bot.id)[0].id);
	for (let i = 0; i < 50; i++) r.triggers.create(r.bot.id, draft());
	await assert.rejects(call('triggers_create', { revision: r.bots.revision, draft: draft() }), /50 triggers/);
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
	assert.ok(r.turns[0].text.endsWith(trigger.prompt));
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
		[draft({ kind: 'every', intervalMs: 2 * MINUTE }), /5 minutes/],
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

test('6.1 busy bot queues; repeated pending firings and a full queue skip as bot busy; queued input snapshots survive edits', async (t) => {
	const r = await setup(t);
	const chat = await r.service.send(r.bot.id, 'chat');
    for(let n=0;n<3;n++)await r.service.send(r.bot.id,'hold');
	await flush();
	const trigger = r.triggers.create(r.bot.id, draft());
	await r.time.advance(start + 5 * MINUTE, r.engine);
	assert.equal(r.turns.length,4);
	assert.equal(r.service.queue.list(r.bot.id).length,1);
	r.triggers.update(
		r.bot.id,
		trigger.id,
		draft(undefined, { prompt: 'new prompt' }),
	);
	await r.time.advance(start + 10 * MINUTE, r.engine);
	assert.equal(r.triggers.firings(r.bot.id)[0].reason, 'bot busy');
	assert.equal(r.triggers.firings(r.bot.id)[0].outcome, 'skipped');
	for (let n = 0; n < 19; n++) {
		const other = r.triggers.create(
			r.bot.id,
			draft({ kind: 'event', event: 'project.opened' }, { name: `q${n}` }),
		);
		await r.triggers.runNow(r.bot.id, other.id);
	}
	assert.equal(r.service.queue.list(r.bot.id).length, 20);
	const overflow = r.triggers.create(
		r.bot.id,
		draft({ kind: 'event', event: 'project.closed' }),
	);
	const skipped = await r.triggers.runNow(r.bot.id, overflow.id);
	assert.equal(skipped.reason, 'bot busy');
	assert.equal(skipped.outcome, 'skipped');
	await finish(r, chat.sessionId);
	assert.equal(r.closed[0].reason,'end');
	assert.ok(r.turns[4].text.endsWith(trigger.prompt));
	assert.equal(r.sessions.get(chat.sessionId).state,'completed');
});

test('6.1 trigger and subsequent user messages use fresh executions', async (t) => {
	const r = await setup(t);
	const chat = await r.service.send(r.bot.id, 'chat');
	await flush();
	await finish(r, chat.sessionId);
	const trigger = r.triggers.create(
		r.bot.id,
		draft({ kind: 'event', event: 'project.opened' }),
	);
	const firing = await r.triggers.runNow(r.bot.id, trigger.id);
	await flush();
	assert.equal(r.sessions.get(chat.sessionId).state,'completed');
	await finish(r, firing.sessionId);
	const resumed = await r.service.send(r.bot.id, 'continue');
	await flush();
	assert.notEqual(resumed.sessionId,chat.sessionId);
	assert.equal(r.turns.at(-1).loadId,null);
});

test('6.1 disabling/deleting removes pending work; a queued once firing survives its automatic disable', async (t) => {
	const r = await setup(t);
	await r.service.send(r.bot.id, 'hold');
    for(let n=0;n<3;n++)await r.service.send(r.bot.id,'hold');
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
	assert.ok(r.turns[0].text.endsWith(trigger.prompt));
	assert.equal(r.triggers.list(r.bot.id).triggers[0].enabled, false);
});

for (const [failure, reason] of [
	['engine', 'container engine unavailable'],
	['agent', 'agent not ready'],
	['image', 'image out of date and building failed'],
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
		assert.equal(r.engine.armedFor, r.time.now + HOUR);
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

test('6.1 sleep follows shared missed-run tolerance with no polling or catch-up', async (t) => {
	const r = await setup(t, { autoComplete: true });
	const trigger = r.triggers.create(r.bot.id, draft());
	await r.time.wake(start + 16 * MINUTE + 1, r.engine);
	assert.equal(r.turns.length, 0);
	assert.equal(r.bots.trigger(r.bot.id, trigger.id).missedCount, 3);
	await r.time.wake(start + 30 * MINUTE + 30_000, r.engine);
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
test('6.1 event needs-input fires across projects only on transitions; bounded context excludes private payloads', async (t) => {
	const r = await setup(t, { autoComplete: true });
	r.triggers.create(
		r.bot.id,
		draft({ kind: 'event', event: 'agent.needsInput' }),
	);
	r.agents.emit(
		snapshot([
			agentEntry('project-one', 'working'),
			agentEntry('project-two', 'working'),
		]),
	);
	r.agents.emit(
		snapshot([
			agentEntry('project-one', 'waiting'),
			agentEntry('project-two', 'working'),
		]),
	);
	await flush();
	r.agents.emit(
		snapshot([
			agentEntry('project-one', 'waiting'),
			agentEntry('project-two', 'working'),
		]),
	);
	await flush();
	r.agents.emit(
		snapshot([
			agentEntry('project-one', 'waiting'),
			agentEntry('project-two', 'waiting'),
		]),
	);
	await flush();
	assert.equal(r.turns.length, 2);
	assert.match(r.turns[0].text, /Build terminal/);
	assert.match(r.turns[0].text, /Project A/);
	assert.match(r.turns[0].text, /Fake ACP/);
	const context = eventBlock({
		event: 'agent.needsInput',
		subject: {
			kind: 'terminal',
			serverId: 'server',
			projectId: 'p',
			sessionId: 's',
			title: '🦜'.repeat(100_000),
			projectTitle: 'Project',
			capabilityToken: 'private-token',
		},
		context: {
			agentProvider: 'Fake',
			secret: 'private-secret',
			terminalOutput: 'private-output',
			providerJournal: 'private-journal',
		},
	});
	assert.ok(Buffer.byteLength(context) < 4096);
	assert.doesNotMatch(context, /private-/);
});

test('6.1 bot process, file and shell activity has no workspace terminal and raises no event for any consumer', async (t) => {
	const r = await setup(t, { autoComplete: true });
	for (const event of [
		'agent.finished',
		'agent.needsInput',
		'terminal.commandFinished',
		'terminal.idle',
		'project.opened',
	])
		r.triggers.create(r.bot.id, draft({ kind: 'event', event }));
	const received = [];
	r.fanout.registerSource('observer', {
		accepts: () => true,
		onEvent: (e) => received.push(e),
	});
	for (const id of ['bot-agent', 'bot-file-helper', 'shell-bot']) {
		r.agents.emit(snapshot([agentEntry(id, 'working')]));
		r.agents.emit(snapshot([agentEntry(id, 'waiting')]));
		r.agents.emit(snapshot([agentEntry(id, 'done')]));
		r.activity.emit({
			type: 'activity.changed',
			snapshot: { sessionId: id, status: 'working', attention: false },
		});
		r.activity.emit({
			type: 'activity.changed',
			snapshot: {
				sessionId: id,
				status: 'idle',
				attention: false,
				source: 'structured:command',
				exitCode: 0,
			},
		});
	}
	r.journal.emit({
		event: 'bots.changed',
		payload: { botId: r.bot.id, revision: 1 },
	});
	await flush();
	assert.equal(received.length, 0);
	assert.equal(r.turns.length, 0);
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

test('6.1 restart records previously queued and unassociated pending firings as skipped', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-trigger-pending-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const first = await setup(t, { root, keepRoot: true });
	await first.service.send(first.bot.id, 'hold');
    for(let n=0;n<3;n++)await first.service.send(first.bot.id,'hold');
	await flush();
	const trigger = first.triggers.create(first.bot.id, draft());
	const pending = await first.triggers.runNow(first.bot.id, trigger.id);
	first.bots.putFiring({ ...pending, id: 'a'.repeat(24), sessionId: null });
	first.triggers.stop();
	first.engine.stop();
	const second = await setup(t, { root, keepRoot: true, at: start + MINUTE });
	const firings = second.triggers.firings(second.bot.id);
	assert.equal(firings.length, 2);
	assert.ok(
		firings.every(
			(f) => f.outcome === 'skipped' && f.reason === 'server restarted',
		),
	);
	assert.equal(second.turns.length, 0);
});

test('6.1 all offered event kinds reach the same send path and repeated reports stay quiet', async (t) => {
	const r = await setup(t, { autoComplete: true });
	const events = [
		'agent.finished',
		'agent.needsInput',
		'agent.blocked',
		'terminal.needsAttention',
		'terminal.commandFinished',
		'terminal.idle',
		'project.opened',
		'project.closed',
		'device.connected',
	];
	for (const event of events)
		r.triggers.create(
			r.bot.id,
			draft({ kind: 'event', event }, { name: event }),
		);
	const emitAgent = (state) =>
		r.agents.emit(snapshot([agentEntry('project-one', state)]));
	emitAgent('working');
	for (const state of ['done', 'waiting', 'blocked']) {
		emitAgent(state);
		await flush();
	}
	const emitActivity = (snapshot) =>
		r.activity.emit({
			type: 'activity.changed',
			snapshot: { sessionId: 'project-one', attention: false, ...snapshot },
		});
	emitActivity({ status: 'working' });
	emitActivity({
		status: 'idle',
		source: 'structured:command',
		exitCode: 7,
		attention: true,
	});
	await flush();
	r.journal.emit({
		event: 'project.opened',
		payload: { serverId: 'server', projectId: 'p', name: 'P' },
	});
	r.journal.emit({
		event: 'project.closed',
		payload: { serverId: 'server', projectId: 'p', name: 'P' },
	});
	r.fanout.deviceConnected({ deviceId: 'device', deviceName: 'Phone' });
	// Wait for the per-bot send serialization and turns, using service events.
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			r.service.off('changed', check);
			reject(new Error('event firing deadline'));
		}, 5000);
		const check = () => {
			if (
				r.triggers.firings(r.bot.id).filter((f) => f.outcome === 'completed')
					.length === events.length
			) {
				clearTimeout(timer);
				r.service.off('changed', check);
				resolve();
			}
		};
		r.service.on('changed', check);
		check();
	});
	assert.deepEqual(
		r.triggers
			.firings(r.bot.id)
			.map((f) => f.triggerName)
			.sort(),
		events.sort(),
	);
});
