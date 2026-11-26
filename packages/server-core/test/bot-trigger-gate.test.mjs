import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	GATE_FAILED_NOTE,
	gateCommand,
	utf8Head,
	utf8Tail,
} from '../dist/botService/gate.js';
import { SourceRunError } from '../dist/botService/sourceRunner.js';
import { BotSourceStore } from '../dist/botService/sourceState.js';
import { BotError } from '../dist/botService/store.js';
import { triggerGate } from '../dist/botService/triggerState.js';
import {
	BotMemories,
	BotService,
	BotSessionStore,
	BotStore,
	EventFanout,
	ScheduleEngine,
} from '../dist/index.js';
import { relayDriver } from './fixtures/bot-runtime-relay.mjs';

const MINUTE = 60_000;
const start = Date.parse('2026-01-05T08:00:00Z');
const SECRET = 'sk-GATESECRET-123';
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function settle(n = 8) {
	for (let i = 0; i < n; i++) await flush();
}
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
	};
}
const agent = {
	id: 'fake.agent',
	displayName: 'Fake',
	autonomousOnly: false,
	runtimeProtocol: 'native-cli-v1',
	nativeDriver: 'claude-code-cli',
	runtimeVersion: '2.1.312',
};
const draft = (
	extra = {},
	condition = { kind: 'once', at: start + MINUTE },
) => ({
	name: 'Nightly docs sync',
	enabled: true,
	prompt: 'Sync the docs with today’s merged pull requests',
	condition,
	...extra,
});

/**
 * A fake source runner. Gate runs are recognised by their command and
 * answered by `gate(source, options)`, which returns an observation, throws,
 * or waits for `options.signal`. Other runs answer with `observe` items.
 */
function runner() {
	const state = {
		gateRuns: [],
		gate: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
		items: [],
	};
	return {
		state,
		sources: {
			protect: async (_b, _t, s) => s,
			async run(_bot, src, options, observe) {
				if (src.kind === 'files') {
					state.fileObserve = observe;
					await observe({ snapshot: {}, status: 'watching' });
					await new Promise((resolve) => {
						if (options.signal.aborted) resolve();
						else
							options.signal.addEventListener('abort', resolve, { once: true });
					});
					return;
				}
				if (src.kind === 'command' && src.command.startsWith('g=')) {
					state.gateRuns.push({ src, options });
					const value = await state.gate(src, options);
					if (options.signal.aborted) throw new Error('Source cancelled');
					await observe(value);
					return;
				}
				await observe({
					stdout: JSON.stringify(state.items),
					stderr: '',
					exitCode: 0,
				});
			},
		},
	};
}
function pendingGate(state) {
	let resolve;
	const settled = new Promise((r) => {
		resolve = r;
	});
	state.gate = (_src, options) =>
		new Promise((res, rej) => {
			options.signal.addEventListener('abort', () =>
				rej(new Error('Source cancelled')),
			);
			settled.then(res);
		});
	return resolve;
}

async function setup(t, options = {}) {
	const root = mkdtempSync(join(tmpdir(), 'bot-gate-'));
	const time = clock();
	const errors = [];
	const engine = new ScheduleEngine({
		clock: time.clock,
		timeZone: 'UTC',
		onError: (e) => errors.push(e),
	});
	const fanout = new EventFanout({
		serverId: 'server',
		agents: source(),
		activity: source(),
		eventJournal: source(),
		now: () => time.now,
		describeTerminal: () => undefined,
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
		clients = new Map();
	const failures = { engine: false, redact: false };
	const driver = relayDriver();
	const fake = runner();
	const service = new BotService(bots, sessions, memories, {
		now: () => time.now,
		sources: fake.sources,
		agents: {
			botAgentContributions: () => [
				{ extensionId: 'fake', contribution: agent },
			],
			botAgentModels: async () => ({ available: true, value: [] }),
			botAgentStatus: async () => ({
				available: true,
				value: { state: 'ready' },
			}),
			botAgentLaunch: async () => ({
				available: true,
				value: { args: [], env: {} },
			}),
		},
		environment: {
			register() {},
			async prepareSession() {},
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
				if (options.acquire) await options.acquire();
				if (failures.redact) throw new Error('vault locked');
				return {
					redact: (v) => v.split(options.secret ?? SECRET).join('[redacted]'),
					release() {},
				};
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
				turns.push({ sessionId: o.sessionId, text });
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
				async close() {
					client.finish();
					await o.cleanupRuntime?.();
				},
			};
		},
	});
	await service.reconcile();
	const bot = bots.save({
		name: 'Docs',
		agentId: agent.id,
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
		...(options.bot ?? {}),
	});
	await service.triggers.start(engine, fanout, 'UTC');
	t.after(async () => {
		service.triggers.stop();
		engine.stop();
		fanout.stop();
		for (const c of clients.values()) c.finish();
		await flush();
		await service.shutdown();
		rmSync(root, { recursive: true, force: true });
		assert.deepEqual(errors, []);
	});
	return {
		root,
		time,
		engine,
		bots,
		sessions,
		service,
		triggers: service.triggers,
		bot,
		turns,
		clients,
		failures,
		fake,
	};
}
const firingOf = (r, trigger) =>
	r.triggers.firings(r.bot.id).find((f) => f.triggerId === trigger.id);
// The parts of health a failure would change; firing times move regardless.
const healthOf = (r, trigger) => {
	const h = r.triggers
		.list(r.bot.id)
		.triggers.find((x) => x.id === trigger.id).health;
	return { state: h.state, error: h.error ?? null, cause: h.cause ?? null };
};
const fire = async (r) => {
	await r.time.advance(start + MINUTE, r.engine);
	await settle();
};

// --- The gate command, run by a real bash -------------------------------

const bash = spawnSync('bash', ['--version']).status === 0;
test('the gate command runs exactly the named file', { skip: !bash }, (t) => {
	const home = mkdtempSync(join(tmpdir(), 'gate-home-'));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	mkdirSync(join(home, 'gates'));
	const run = (path) =>
		spawnSync('bash', ['-c', gateCommand(path)], {
			cwd: home,
			encoding: 'utf8',
		});
	writeFileSync(join(home, 'gates', 'exec.sh'), '#!/bin/sh\necho executable\n');
	chmodSync(join(home, 'gates', 'exec.sh'), 0o755);
	writeFileSync(join(home, 'gates', 'plain.sh'), 'echo "plain $0"\n');
	const odd = "we'ird $HOME; name.sh";
	writeFileSync(join(home, odd), 'echo odd\n');
	writeFileSync(join(home, 'marker'), 'untouched\n');

	assert.equal(run('gates/exec.sh').stdout, 'executable\n');
	assert.equal(run(join(home, 'gates', 'exec.sh')).stdout, 'executable\n');
	assert.match(run('./gates/plain.sh').stdout, /^plain /);
	const r = run(odd);
	assert.equal(r.stdout, 'odd\n');
	assert.equal(r.status, 0);
	// Shell syntax in the path is never executed.
	const injected = run('x; rm marker; echo injected');
	assert.equal(injected.stdout, '');
	assert.notEqual(injected.status, 0);
	assert.equal(readFileSync(join(home, 'marker'), 'utf8'), 'untouched\n');
	// A missing file is a non-zero exit with nothing on stdout.
	const missing = run('gates/missing.sh');
	assert.equal(missing.stdout, '');
	assert.notEqual(missing.status, 0);
	assert.match(missing.stderr, /missing\.sh/);
	// A directory is not executed as a program.
	const dir = run('gates');
	assert.equal(dir.stdout, '');
	assert.notEqual(dir.status, 0);
	assert.ok(execFileSync('bash', ['-n', '-c', gateCommand(odd)]) !== undefined);
});

test('gate paths are validated and normalised', () => {
	assert.deepEqual(triggerGate(undefined), {});
	assert.deepEqual(triggerGate(''), {});
	assert.deepEqual(triggerGate('   '), {});
	assert.deepEqual(triggerGate('  ./check.sh '), { gate: './check.sh' });
	assert.throws(() => triggerGate('a\nb'), /Gate/);
	assert.throws(() => triggerGate('a\n'), /Gate/);
	assert.throws(() => triggerGate('\r a'), /Gate/);
	assert.throws(() => triggerGate('a\rb'), /Gate/);
	assert.throws(() => triggerGate('a\0b'), /Gate/);
	assert.throws(() => triggerGate('x'.repeat(4097)), /Gate/);
	assert.throws(() => triggerGate(7), /Gate/);
	assert.deepEqual(triggerGate('é'.repeat(2048)), { gate: 'é'.repeat(2048) });
	assert.throws(() => triggerGate(`${'é'.repeat(2048)}x`), /Gate/);
});

test('UTF-8 cuts keep whole characters and drop a partial first line', () => {
	assert.equal(utf8Head('ab', 5), 'ab');
	assert.equal(Buffer.byteLength(utf8Head('é'.repeat(300), 511)), 510);
	assert.equal(utf8Tail('one\ntwo', 100), 'one\ntwo');
	assert.equal(utf8Tail('one\ntwo', 3), 'two');
	assert.equal(utf8Tail('long line without a newline', 5), '');
	assert.equal(utf8Tail(`${'x'.repeat(50)}\nlast`, 10), 'last');
	assert.ok(!utf8Tail('é'.repeat(600), 1001).includes('�'));
});

// --- Firings ---------------------------------------------------------------

test('a gate that prints nothing lets the firing start its session', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: './check.sh' }));
	r.fake.state.gate = async () => ({ stdout: ' \n', stderr: '', exitCode: 0 });
	await fire(r);
	assert.equal(r.fake.state.gateRuns.length, 1);
	const { src } = r.fake.state.gateRuns[0];
	assert.equal(src.cwd, '/home/bot');
	assert.equal(src.timeoutMs, 30000);
	assert.equal(src.command, gateCommand('./check.sh'));
	assert.equal(r.turns.length, 1);
	assert.ok(r.turns[0].text.includes(trigger.prompt));
	assert.ok(!r.turns[0].text.includes(GATE_FAILED_NOTE));
});

const daily = { kind: 'cron', cron: '* * * * *' };
test('a gate that prints text skips the firing without failing it', async (t) => {
	const r = await setup(t, { bot: { investigateFailures: true } });
	const trigger = r.triggers.create(
		r.bot.id,
		draft({ gate: './check.sh' }, daily),
	);
	const before = healthOf(r, trigger);
	r.fake.state.gate = async () => ({
		stdout: '  no pull\nrequests   today \n',
		stderr: '',
		exitCode: 3,
	});
	await fire(r);
	await r.service.failureFollowUps.idle(r.bot.id);
	await settle();
	const firing = firingOf(r, trigger);
	assert.equal(firing.outcome, 'skipped');
	assert.equal(firing.reason, 'gate: no pull requests today');
	assert.equal(firing.sessionId, null);
	assert.equal(r.turns.length, 0);
	assert.equal(r.sessions.list(r.bot.id).length, 0);
	assert.deepEqual(healthOf(r, trigger), before);
});

test('a gated once trigger is still disabled', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: './check.sh' }));
	r.fake.state.gate = async () => ({
		stdout: 'not needed',
		stderr: '',
		exitCode: 0,
	});
	await fire(r);
	assert.equal(firingOf(r, trigger).outcome, 'skipped');
	assert.equal(
		r.triggers.list(r.bot.id).triggers.find((x) => x.id === trigger.id).enabled,
		false,
	);
});

test('a skipped reason is redacted, then collapsed, then cut to 512 bytes', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.fake.state.gate = async () => ({
		stdout: `token ${SECRET}\n${'é'.repeat(5000)}`,
		stderr: '',
		exitCode: 0,
	});
	await fire(r);
	const { reason } = firingOf(r, trigger);
	assert.ok(reason.startsWith('gate: token [redacted] é'));
	assert.ok(!reason.includes(SECRET));
	assert.ok(Buffer.byteLength(reason.slice('gate: '.length)) <= 512);
	assert.ok(!reason.includes('�'));
});

test('a skipped reason is just "gate" when redaction is unavailable', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.fake.state.gate = async () => ({
		stdout: 'nothing to do',
		stderr: '',
		exitCode: 0,
	});
	r.failures.redact = true;
	await fire(r);
	const firing = firingOf(r, trigger);
	assert.equal(firing.outcome, 'skipped');
	assert.equal(firing.reason, 'gate');
});

test('Run now does not run the gate, and a trigger without a gate never runs one', async (t) => {
	const r = await setup(t);
	const gated = r.triggers.create(
		r.bot.id,
		draft({ gate: '/g.sh', enabled: false }),
	);
	r.fake.state.gate = async () => ({
		stdout: 'nothing to do',
		stderr: '',
		exitCode: 0,
	});
	const firing = await r.triggers.runNow(r.bot.id, gated.id);
	await settle();
	assert.equal(r.sessions.get(firing.sessionId).origin.kind, 'run-now');
	assert.equal(r.fake.state.gateRuns.length, 0);
	r.clients.get(firing.sessionId)?.finish();
	r.triggers.create(r.bot.id, draft());
	await fire(r);
	assert.equal(r.fake.state.gateRuns.length, 0);
});

for (const [label, gate, expect] of [
	[
		'a failing exit with no output',
		async () => ({
			stdout: '',
			stderr: `token expired ${SECRET}\n`,
			exitCode: 2,
		}),
		(g) => {
			assert.equal(g.exitCode, 2);
			assert.match(g.error, /status 2/);
			assert.equal(g.stderr, 'token expired [redacted]');
		},
	],
	[
		'a missing file',
		async () => ({
			stdout: '',
			stderr: 'bash: ./gates/check.sh: No such file or directory\n',
			exitCode: 127,
		}),
		(g) => {
			assert.equal(g.exitCode, 127);
			assert.match(g.stderr, /No such file/);
		},
	],
	[
		'a gate over its time limit',
		async () => {
			throw new SourceRunError(
				'deadline',
				'Source check exceeded its 30 s limit',
				{
					exitCode: null,
					stderr: 'partial',
				},
			);
		},
		(g) => {
			assert.equal(g.exitCode, null);
			assert.match(g.error, /30-second limit/);
			assert.equal(g.stderr, undefined);
		},
	],
	[
		'a worker error',
		async () => {
			throw new Error('Command output exceeds 1 MiB');
		},
		(g) => {
			assert.equal(g.exitCode, null);
			assert.match(g.error, /could not be run: Command output exceeds 1 MiB/);
			assert.equal(g.stderr, undefined);
		},
	],
])
	test(`a broken gate fails open: ${label}`, async (t) => {
		const r = await setup(t, { bot: { investigateFailures: true } });
		const trigger = r.triggers.create(
			r.bot.id,
			draft({ gate: './gates/check.sh' }, daily),
		);
		const before = healthOf(r, trigger);
		r.fake.state.gate = gate;
		await fire(r);
		assert.equal(r.turns.length, 1);
		const text = r.turns[0].text;
		assert.ok(text.includes(trigger.prompt));
		assert.ok(text.includes(GATE_FAILED_NOTE));
		assert.ok(
			text.indexOf(GATE_FAILED_NOTE) <
				text.indexOf('<untrusted-source-context>'),
		);
		assert.ok(!text.includes(SECRET));
		const context = JSON.parse(
			text
				.slice(
					text.indexOf('<untrusted-source-context>\n') +
						'<untrusted-source-context>\n'.length,
					text.indexOf('\n</untrusted-source-context>'),
				)
				.replace(/\\u003c/g, '<')
				.replace(/\\u003e/g, '>'),
		);
		assert.equal(context.gate.path, './gates/check.sh');
		assert.equal(context.gate.status, 'failed');
		expect(context.gate);
		assert.deepEqual(healthOf(r, trigger), before);
		assert.equal(
			r.sessions.list(r.bot.id).filter((s) => s.origin.kind === 'failure')
				.length,
			0,
		);
	});

test('a broken gate still fails the firing when the engine is unavailable', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.failures.engine = true;
	r.fake.state.gate = async () => {
		throw new Error('engine not running');
	};
	await fire(r);
	const firing = firingOf(r, trigger);
	assert.equal(firing.outcome, 'failed');
	assert.equal(firing.reason, 'container engine unavailable');
});

test('a verdict is kept while the firing waits, and a firing keeps the gate it had', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/old.sh' }));
	const release = pendingGate(r.fake.state);
	await r.time.advance(start + MINUTE, r.engine);
	await settle();
	assert.equal(r.fake.state.gateRuns.length, 1);
	// An edit while the gate runs neither aborts it nor changes this firing.
	r.triggers.update(r.bot.id, trigger.id, {
		...draft({ gate: '/new.sh' }, { kind: 'once', at: start + 10 * MINUTE }),
	});
	await settle();
	assert.equal(r.fake.state.gateRuns[0].options.signal.aborted, false);
	assert.equal(r.fake.state.gateRuns[0].src.command, gateCommand('/old.sh'));
	release({ stdout: '', stderr: '', exitCode: 0 });
	await settle();
	assert.equal(r.turns.length, 1);
	// Further drains of the bot do not run the gate again.
	r.service.invalidate(r.bot.id);
	await settle();
	assert.equal(r.fake.state.gateRuns.length, 1);
});

test('disabling or deleting a trigger ends its gate and starts nothing', async (t) => {
	for (const action of ['disable', 'delete']) {
		const r = await setup(t);
		const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
		pendingGate(r.fake.state);
		await r.time.advance(start + MINUTE, r.engine);
		await settle();
		const { signal } = r.fake.state.gateRuns[0].options;
		if (action === 'disable') r.triggers.enable(r.bot.id, trigger.id, false);
		else r.triggers.remove(r.bot.id, trigger.id);
		await settle();
		assert.equal(signal.aborted, true, action);
		assert.equal(r.turns.length, 0, action);
		if (action === 'disable')
			assert.equal(firingOf(r, trigger).reason, 'cancelled');
	}
});

test('a bot disabled during its gate runs the gate again when it is enabled', async (t) => {
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	pendingGate(r.fake.state);
	await r.time.advance(start + MINUTE, r.engine);
	await settle();
	const first = r.fake.state.gateRuns[0].options.signal;
	r.bots.save({ ...r.bots.get(r.bot.id), enabled: false });
	r.triggers.availability(r.bot.id, false);
	await settle();
	assert.equal(first.aborted, true);
	assert.equal(r.turns.length, 0);
	r.fake.state.gate = async () => ({ stdout: '', stderr: '', exitCode: 0 });
	r.bots.save({ ...r.bots.get(r.bot.id), enabled: true });
	r.triggers.availability(r.bot.id, true);
	await settle();
	assert.equal(r.fake.state.gateRuns.length, 2);
	assert.equal(r.turns.length, 1);
});

test('stopping the service ends a running gate without starting a session', async (t) => {
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	pendingGate(r.fake.state);
	await r.time.advance(start + MINUTE, r.engine);
	await settle();
	r.triggers.stop();
	await settle();
	assert.equal(r.fake.state.gateRuns[0].options.signal.aborted, true);
	assert.equal(r.turns.length, 0);
});

test('a firing accepted while a gate runs is dispatched when it ends', async (t) => {
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	const release = pendingGate(r.fake.state);
	await r.time.advance(start + MINUTE, r.engine);
	await settle();
	const plain = r.triggers.create(
		r.bot.id,
		draft({ name: 'Plain' }, { kind: 'once', at: start + 2 * MINUTE }),
	);
	await r.time.advance(start + 2 * MINUTE, r.engine);
	await settle();
	assert.equal(r.turns.length, 0, 'held behind the gate');
	release({ stdout: '', stderr: '', exitCode: 0 });
	await settle(20);
	assert.equal(r.turns.length, 2);
	assert.ok(firingOf(r, plain).sessionId);
	// Nothing keeps draining once the bot has no work it can admit.
	const runs = r.fake.state.gateRuns.length;
	await settle(20);
	assert.equal(r.fake.state.gateRuns.length, runs);
});

test('a gated item is not reported again by its source', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(
		r.bot.id,
		draft(
			{ gate: '/g.sh' },
			{
				kind: 'command',
				command: 'list.sh',
				intervalMs: MINUTE,
				match: { kind: 'items', items: '', identity: '/id' },
			},
		),
	);
	r.fake.state.items = [{ id: 7 }];
	r.fake.state.gate = async () => ({
		stdout: 'not interesting',
		stderr: '',
		exitCode: 0,
	});
	await r.time.advance(start + MINUTE, r.engine);
	await settle();
	await r.time.advance(start + 2 * MINUTE, r.engine);
	await settle();
	const firings = r.triggers
		.firings(r.bot.id)
		.filter((f) => f.triggerId === trigger.id);
	assert.equal(firings.length, 1);
	assert.equal(firings[0].outcome, 'skipped');
	assert.equal(r.fake.state.gateRuns.length, 1);
});

// --- Runtime trigger tools -------------------------------------------------

test('runtime trigger tools read and write the gate and explain it', async (t) => {
	const r = await setup(t);
	r.fake.state.gate = async () => ({ stdout: '', stderr: '', exitCode: 0 });
	const { sessionId } = await r.service.send(r.bot.id, 'Manage my triggers');
	const call = (name, args = {}) =>
		r.service.runtime.call(sessionId, name, args);
	const { revision } = await call('triggers_list');
	const created = await call('triggers_create', {
		revision,
		draft: draft(
			{ gate: '/home/bot/gates/new-pulls.sh' },
			{ kind: 'cron', cron: '0 0 * * *' },
		),
	});
	const got = await call('triggers_get', { triggerId: created.trigger.id });
	assert.equal(got.trigger.gate, '/home/bot/gates/new-pulls.sh');
	await assert.rejects(
		call('triggers_update', {
			triggerId: created.trigger.id,
			revision: created.revision,
			draft: draft(
				{ gate: 'x'.repeat(4097) },
				{ kind: 'cron', cron: '0 0 * * *' },
			),
		}),
		/Gate/,
	);
	const cleared = await call('triggers_update', {
		triggerId: created.trigger.id,
		revision: created.revision,
		draft: draft({ gate: '' }, { kind: 'cron', cron: '0 0 * * *' }),
	});
	assert.equal('gate' in cleared.trigger, false);
	const tools = await import('../dist/botService/runtimeTriggers.js');
	const byName = Object.fromEntries(
		tools.BOT_TRIGGER_TOOLS.map((x) => [x.name, x]),
	);
	for (const name of ['triggers_create', 'triggers_update']) {
		assert.match(byName[name].description, /gate/);
		assert.match(byName[name].description, /wasteful/);
		assert.match(
			byName[name].inputSchema.properties.draft.properties.gate.description,
			/prints any text/,
		);
	}
});

// Regression coverage for review findings and the durable admission contract.
test('runner error credentials are redacted before the diagnostic is cut', async (t) => {
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.fake.state.gate = async () => {
		throw new Error(`${'x'.repeat(505)}${SECRET}`);
	};
	await fire(r);
	assert.equal(r.turns.length, 1);
	assert.ok(!r.turns[0].text.includes('sk-GATE'));
});

test('stdout credentials are redacted before leading whitespace is trimmed', async (t) => {
	const secret = `  ${SECRET}\n`;
	const r = await setup(t, { secret });
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.fake.state.gate = async () => ({ stdout: secret, exitCode: 0 });
	await fire(r);
	assert.equal(firingOf(r, trigger).reason, 'gate: [redacted]');
});

for (const cancel of [false, true])
	test(`a firing arriving during gate redaction is drained (cancel=${cancel})`, async (t) => {
		let release;
		const wait = new Promise((resolve) => {
			release = resolve;
		});
		let entered = false;
		const r = await setup(t, {
			acquire: async () => {
				entered = true;
				await wait;
			},
		});
		t.after(() => release());
		r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
		r.fake.state.gate = async () => ({ stdout: 'nothing new', exitCode: 0 });
		await fire(r);
		assert.equal(entered, true);
		const next = r.triggers.create(
			r.bot.id,
			draft({}, { kind: 'once', at: start + 2 * MINUTE }),
		);
		await r.time.advance(start + 2 * MINUTE, r.engine);
		await settle();
		if (cancel) {
			r.bots.save({ ...r.bots.get(r.bot.id), enabled: false });
			r.triggers.availability(r.bot.id, false);
			r.bots.save({ ...r.bots.get(r.bot.id), enabled: true });
			r.triggers.availability(r.bot.id, true);
		}
		release();
		await settle(20);
		assert.ok(firingOf(r, next).sessionId);
		assert.equal(r.fake.state.gateRuns.length, cancel ? 2 : 1);
	});

test('failed cleanup after a gate result fails open', async (t) => {
	const r = await setup(t);
	r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.fake.sources.run = async (_bot, _src, _options, observe) => {
		await observe({ stdout: 'skip', exitCode: 0 });
		throw new Error('cleanup failed');
	};
	await fire(r);
	assert.equal(r.turns.length, 1);
	assert.ok(r.turns[0].text.includes('cleanup failed'));
});

test('a retained firing reuses its verdict without spinning on resource refusal', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	const send = r.service.send.bind(r.service);
	let calls = 0;
	r.service.send = async () => {
		calls++;
		throw new BotError('resource', 'capacity');
	};
	await fire(r);
	assert.equal(calls, 1);
	r.sessions.emit('changed', { botId: r.bot.id });
	await settle(20);
	assert.equal(calls, 2);
	assert.equal(r.fake.state.gateRuns.length, 1);
	assert.equal(r.turns.length, 0);
	r.service.send = send;
	r.sessions.emit('changed', { botId: r.bot.id });
	await settle(20);
	assert.ok(firingOf(r, trigger).sessionId);
	assert.equal(r.fake.state.gateRuns.length, 1);
});

test('gate definitions and pending snapshots survive loading, including absent gates', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '  /old.sh  ' }));
	assert.equal(
		new BotStore(join(r.root, 'bots.json')).trigger(r.bot.id, trigger.id).gate,
		'/old.sh',
	);
	const state = new BotSourceStore(join(r.root, 'pending-test'));
	const cp = state.checkpoint(trigger);
	const [event] = state.commit(trigger, cp, [{}], start, start);
	state.commit(trigger, cp, [{}], start, start, 'run-now');
	r.triggers.update(r.bot.id, trigger.id, draft({ gate: '/new.sh' }));
	const pending = new BotSourceStore(join(r.root, 'pending-test')).pending(
		r.bot.id,
	);
	assert.equal(pending.find((e) => e.id === event.id).gate, '/old.sh');
	assert.equal('gate' in pending.find((e) => e.origin === 'run-now'), false);
	r.triggers.update(r.bot.id, trigger.id, draft({ gate: '' }));
	assert.equal(
		'gate' in
			new BotStore(join(r.root, 'bots.json')).trigger(r.bot.id, trigger.id),
		false,
	);
});

test('waiting for the user skips a firing before running its gate', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	r.triggers.block(
		r.bot.id,
		trigger.id,
		'Login refused',
		'Sign in',
		'a'.repeat(24),
	);
	await fire(r);
	assert.equal(firingOf(r, trigger).reason, 'waiting for you');
	assert.equal(r.fake.state.gateRuns.length, 0);
});

test('a server restart reruns an unfinished gate from its durable firing', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }));
	pendingGate(r.fake.state);
	await fire(r);
	r.triggers.stop();
	await settle();
	assert.equal(r.turns.length, 0);
	const { BotTriggers } = await import('../dist/botService/triggers.js');
	const resumed = new BotTriggers(r.service, r.bots, () => r.time.now);
	t.after(() => resumed.stop());
	r.fake.state.gate = async () => ({
		stdout: 'nothing new after restart',
		exitCode: 0,
	});
	await resumed.start(r.engine, undefined, 'UTC');
	await settle(20);
	assert.equal(r.fake.state.gateRuns.length, 2);
	assert.equal(
		resumed.firings(r.bot.id).find((f) => f.triggerId === trigger.id).reason,
		'gate: nothing new after restart',
	);
});

test('a file source firing uses its gate and keeps its observation', async (t) => {
	const r = await setup(t);
	const trigger = r.triggers.create(
		r.bot.id,
		draft(
			{ gate: '/g.sh' },
			{ kind: 'files', path: '/home/bot/watch', debounceMs: 5000 },
		),
	);
	await settle();
	r.fake.state.gate = async () => ({
		stdout: 'only lock files changed',
		exitCode: 0,
	});
	await r.fake.state.fileObserve({ snapshot: { 'package-lock.json': 'new' } });
	await settle();
	assert.equal(firingOf(r, trigger).reason, 'gate: only lock files changed');
	assert.equal(r.turns.length, 0);
	await r.fake.state.fileObserve({ snapshot: { 'package-lock.json': 'new' } });
	await settle();
	assert.equal(r.fake.state.gateRuns.length, 1);
});

test('distinct gated firings retain ordinary concurrent queue admission', async (t) => {
	const r = await setup(t);
	for (let n = 0; n < 4; n++) await r.service.send(r.bot.id, 'hold');
	r.triggers.create(r.bot.id, draft({ gate: '/g.sh' }, daily));
	await fire(r);
	assert.equal(r.service.queue.list(r.bot.id).length, 1);
	assert.equal(r.fake.state.gateRuns.length, 1);
	await r.time.advance(start + 2 * MINUTE, r.engine);
	await settle();
	assert.equal(r.service.queue.list(r.bot.id).length, 2);
	assert.ok(r.triggers.firings(r.bot.id).every((f) => f.outcome === 'pending'));
	assert.equal(r.fake.state.gateRuns.length, 2);
});
