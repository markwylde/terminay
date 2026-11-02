import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BotEnvironmentService,
	BotStore,
	createBotEnvironmentOperations,
} from '../dist/botService/index.js';
import { fakeClock, fakeDriver } from './fixtures/bot-driver.mjs';

function setup(t, options = {}) {
	const root = mkdtempSync(join(tmpdir(), 'bot-settings-'));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Settings bot', agentId: 'fake/agent' });
	const driver = fakeDriver(options);
	const clock = fakeClock();
	const hooks = {
		settings: store,
		engine: async () => driver,
		ensureImage: async () => 'fingerprint',
		currentFingerprint: () => 'fingerprint',
		closeHelper: async () => {},
		stopSessions: async () => {},
		bootstrap: async () => ({ vncPassword: 'fake' }),
		socketGid: async () => 999,
		secrets: async () => [],
		timers: clock,
	};
	const service = new BotEnvironmentService('server', hooks);
	service.register({ id: bot.id });
	t.after(() => {
		service.close();
		rmSync(root, { recursive: true, force: true });
	});
	const registry = createBotEnvironmentOperations(service);
	const request = (patch = {}, authScope = 'write') => ({
		envelope: { payload: { botId: bot.id, ...patch } },
		context: {
			clientId: 'client',
			authScope,
			signal: new AbortController().signal,
		},
	});
	const set = (patch) =>
		registry.commands['bots.environment.set-settings'](request(patch));
	return {
		botId: bot.id,
		path,
		store,
		service,
		driver,
		clock,
		hooks,
		registry,
		request,
		set,
	};
}

test('environment settings validate all bounds and flags without changing durable state', async (t) => {
	const f = setup(t);
	const initial = await f.registry.queries['bots.environment.settings'](
		f.request(),
	);
	assert.deepEqual(initial, {
		botId: f.botId,
		shareEngineSocket: false,
		idleStopMs: 1800000,
		limits: { cpus: 2, memoryBytes: 4294967296, pids: 1024 },
		limitsEnforced: true,
		socketWarning: 'root-equivalent',
		revision: 0,
	});
	for (const patch of [
		{ idleStopMs: 299999 },
		{ idleStopMs: 604800001 },
		{ idleStopMs: 300000.5 },
		{ idleStopMs: 'never' },
		{ shareEngineSocket: 1 },
		{ confirmed: 'yes' },
		{ expectedRevision: -1 },
		{ expectedRevision: 0.1 },
		{ expectedRevision: null },
		{ limits: null },
		{ limits: {} },
		{ limits: { ...initial.limits, cpus: 0 } },
		{ limits: { ...initial.limits, memoryBytes: 16777215 } },
		{ limits: { ...initial.limits, pids: 4194305 } },
		{ socketWarning: 'engine-control' },
	])
		await assert.rejects(f.set(patch), (error) => error.code === 'validation');
	assert.equal(f.store.revision, 1);
	for (const idleStopMs of [300000, 604800000, null])
		assert.equal((await f.set({ idleStopMs })).result.idleStopMs, idleStopMs);
	for (const operation of ['queries', 'commands']) {
		const name = operation === 'queries' ? 'settings' : 'set-settings';
		await assert.rejects(
			f.registry[operation][`bots.environment.${name}`](f.request({}, 'read')),
			/authority/,
		);
	}
});

test('socket confirmation returns a typed warning for each engine; stale revision wins and refuses atomically', async (t) => {
	for (const options of [
		{},
		{ kind: 'podman', rootless: true },
		{ platform: 'darwin' },
	]) {
		const f = setup(t, options);
		if (options.platform) f.driver.details.platform = options.platform;
		const warning = options.rootless
			? 'server-account'
			: options.platform
				? 'engine-control'
				: 'root-equivalent';
		await assert.rejects(
			f.set({ shareEngineSocket: true, idleStopMs: null }),
			(e) => {
				assert.equal(e.code, 'forbidden');
				assert.deepEqual(e.details, {
					reason: 'confirmation-required',
					socketWarning: warning,
				});
				return true;
			},
		);
		assert.equal(f.store.environmentSettings(f.botId).idleStopMs, 1800000);
		const changed = [];
		f.store.on('changed', (event) => changed.push(event));
		assert.equal(
			(
				await f.set({
					shareEngineSocket: true,
					confirmed: true,
					expectedRevision: 0,
				})
			).result.revision,
			1,
		);
		assert.equal(changed[0].botId, f.botId);
		await assert.rejects(
			f.set({ idleStopMs: null, expectedRevision: 0 }),
			(e) => e.code === 'conflict' && e.details.reason === 'conflict',
		);
		assert.equal(changed.length, 1);
		await f.set({ shareEngineSocket: true }); // Already enabled does not prompt again.
		await f.set({ shareEngineSocket: false });
		await assert.rejects(
			f.set({ shareEngineSocket: true }),
			(e) => e.details.reason === 'confirmation-required',
		);
	}
});

test('settings persist through a new store/environment and profile saves; pending flags survive restart until recreate', async (t) => {
	const f = setup(t);
	await f.service.start(f.botId);
	const limits = { cpus: 3, memoryBytes: 2147483648, pids: 512 };
	await f.set({
		shareEngineSocket: true,
		confirmed: true,
		limits,
		idleStopMs: null,
	});
	const before = await f.service.overview(f.botId);
	assert.equal(before.socketChangePending, true);
	assert.equal(before.limitsChangePending, true);
	await f.service.restart(f.botId);
	assert.equal((await f.service.overview(f.botId)).limitsChangePending, true);
	const store = new BotStore(f.path);
	const restarted = new BotEnvironmentService('server', {
		...f.hooks,
		settings: store,
	});
	t.after(() => restarted.close());
	restarted.register({ id: f.botId });
	store.save({ ...store.get(f.botId), name: 'Renamed' });
	const settings = await restarted.settings(f.botId);
	assert.equal(settings.idleStopMs, null);
	assert.deepEqual(settings.limits, limits);
	assert.equal(settings.revision, 1);
	assert.equal((await restarted.overview(f.botId)).socketChangePending, true);
	assert.equal((await restarted.overview(f.botId)).limitsChangePending, true);
	assert.ok(readFileSync(`${f.path}.previous`, 'utf8'));
	await restarted.recreate(f.botId);
	const after = await restarted.overview(f.botId);
	assert.equal(after.socketChangePending, false);
	assert.equal(after.limitsChangePending, false);
	const create = f.driver.calls.findLast(
		(args) => args[0] === 'container' && args[1] === 'create',
	);
	assert.equal(create[create.indexOf('--cpus') + 1], '3');
	assert.equal(create[create.indexOf('--memory') + 1], '2147483648');
	assert.equal(create[create.indexOf('--pids-limit') + 1], '512');
	store.remove(f.botId);
	assert.deepEqual(JSON.parse(readFileSync(f.path, 'utf8')).environments, {});
});

test('idle settings immediately cancel and rearm the one-shot deadline, respecting active sessions', async (t) => {
	const f = setup(t);
	await f.service.start(f.botId);
	assert.equal([...f.clock.timers.values()][0].at, 1800000);
	f.clock.tick(1000);
	await f.set({ idleStopMs: 300000 });
	assert.equal(f.clock.timers.size, 1);
	assert.equal([...f.clock.timers.values()][0].at, 301000);
	const timer = [...f.clock.timers.keys()][0];
	await f.set({ limits: { cpus: 1, memoryBytes: 16777216, pids: 1 } });
	assert.equal([...f.clock.timers.keys()][0], timer);
	await f.set({ idleStopMs: null });
	assert.equal(f.clock.timers.size, 0);
	f.service.setActivity(f.botId, {
		runningSessions: 1,
		queuedSessions: 0,
		shells: 0,
		desktops: 0,
	});
	await f.set({ idleStopMs: 300000 });
	assert.equal(f.clock.timers.size, 0);
	f.service.setActivity(f.botId, {
		runningSessions: 0,
		queuedSessions: 0,
		shells: 0,
		desktops: 0,
	});
	f.clock.tick(300000);
	// Await lifecycle work enqueued by the fake deadline.
	await f.service.reconcile(f.botId);
	assert.equal(f.service.state(f.botId), 'stopped');
	assert.equal(f.clock.timers.size, 0);
});
