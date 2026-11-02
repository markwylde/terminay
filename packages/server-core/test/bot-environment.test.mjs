import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import {
	BotEnvironmentService,
	BotHelperIdleDeadline,
	BotIdleDeadline,
	BotLogTail,
	createBotEnvironmentOperations,
} from '../dist/botService/index.js';
import { botId, fakeClock, fakeDriver, name } from './fixtures/bot-driver.mjs';

const setup = (t, options = {}) => {
	const driver = fakeDriver(options);
	const clock = fakeClock();
	let fingerprint = 'fingerprint-1';
	const hooks = {
		engine: async () => driver,
		ensureImage: async () => fingerprint,
		currentFingerprint: () => fingerprint,
		closeHelper: async (id) => {
			driver.calls.push(['helper-close', id]);
		},
		stopSessions: async (id) => {
			driver.calls.push(['sessions-stop', id]);
		},
		bootstrap: async () => ({ vncPassword: 'fake-password' }),
		socketGid: async () => 999,
		secrets: async () => ['secret'],
		now: () => Date.parse('2026-11-01T00:01:00Z'),
		timers: clock,
	};
	const service = new BotEnvironmentService('server', hooks);
	service.register({ id: botId });
	t.after(() => service.close());
	return {
		service,
		driver,
		hooks,
		clock,
		fingerprint: (value) => {
			fingerprint = value;
		},
	};
};

test('4.3 lazy creation, defaults, bootstrap stdin and config restoration before sessions', async (t) => {
	const { service, driver } = setup(t);
	assert.equal(driver.calls.length, 0);
	assert.equal(service.state(botId), 'not-created');
	service.register({
		id: botId,
		configFiles: [{ path: '.codex/config.toml', content: 'fixed' }],
	});
	await Promise.all([service.start(botId), service.start(botId)]);
	assert.equal(service.state(botId), 'running');
	const create = driver.calls.find(
		(args) => args[0] === 'container' && args[1] === 'create',
	);
	assert.ok(create.includes('4294967296'));
	assert.ok(create.includes('1024'));
	assert.ok(create.includes('2'));
	assert.equal(
		create.some((arg) =>
			['-p', '--publish', '-P', '--publish-all'].includes(arg),
		),
		false,
	);
	assert.ok(
		create.includes(`type=volume,source=${name}-home,target=/home/bot`),
	);
	assert.ok(create.includes('--network'));
	assert.ok(create.includes('terminay.server=server'));
	assert.equal(
		driver.calls.filter(
			(args) => args[0] === 'container' && args[1] === 'create',
		).length,
		1,
	);
	const bootstrap = driver.calls.find(
		(args) => args[0] === 'exec' && args[2][1] === '--bootstrap',
	);
	assert.equal(bootstrap[3].user, 'root');
	assert.equal(JSON.parse(bootstrap[3].input).vncPassword, 'fake-password');
	assert.equal(create.join(' ').includes('fake-password'), false);
	await service.prepareSession(botId);
	const configs = driver.calls.filter(
		(args) => args[0] === 'exec' && args[2][1] === '--config',
	);
	assert.equal(configs.length, 2);
	assert.equal(JSON.parse(configs[1][3].input)[0].content, 'fixed');
});

test('4.3 stop/restart/recreate retain home, helpers close before removal, deletion can retain or remove home', async (t) => {
	const { service, driver } = setup(t);
	await service.start(botId);
	await service.stop(botId);
	assert.equal(service.state(botId), 'stopped');
	const stopIndex = driver.calls.findIndex(
		(args) => args[0] === 'container' && args[1] === 'stop',
	);
	assert.ok(
		driver.calls.findIndex((args) => args[0] === 'sessions-stop') < stopIndex,
	);
	await service.restart(botId);
	assert.equal(service.state(botId), 'running');
	const volume = driver.resources.get(`volume:${name}-home`);
	driver.calls.length = 0;
	await service.recreate(botId);
	assert.equal(driver.resources.get(`volume:${name}-home`), volume);
	assert.ok(
		driver.calls.findIndex((args) => args[0] === 'helper-close') <
			driver.calls.findIndex((args) => args[1] === 'rm'),
	);
	assert.equal(
		driver.calls.some((args) => args[0] === 'volume' && args[1] === 'rm'),
		false,
	);
	await service.remove(botId, false);
	assert.ok(driver.resources.has(`volume:${name}-home`));
	service.register({ id: botId });
	await service.start(botId);
	await service.remove(botId, true);
	assert.equal(driver.resources.size, 0);
});

test('4.3 stale stopped containers recreate; running containers keep image until recreate; failure recovers', async (t) => {
	const { service, driver, hooks, fingerprint } = setup(t);
	await service.start(botId);
	fingerprint('fingerprint-2');
	await service.start(botId);
	assert.equal((await service.overview(botId)).current, false);
	await service.stop(botId);
	await service.start(botId);
	assert.equal((await service.overview(botId)).current, true);
	await service.stop(botId);
	driver.failExec = true;
	await assert.rejects(service.start(botId), /bootstrap failed/);
	assert.equal(service.state(botId), 'failed');
	assert.equal(driver.resources.get(`container:${name}`).State.Running, false);
	driver.failExec = false;
	await service.start(botId);
	assert.equal(service.state(botId), 'running');
	await service.stop(botId);
	hooks.ensureImage = async () => {
		throw new Error('build failed');
	};
	await assert.rejects(service.start(botId), /build failed/);
	assert.equal(service.state(botId), 'failed');
});

test('4.3 adoption refuses another server and reconciliation follows external removal/events', async (t) => {
	const { service, driver } = setup(t);
	await service.start(botId);
	driver.resources.get(`container:${name}`).Config.Labels['terminay.server'] =
		'other';
	await service.reconcile(botId);
	assert.equal(service.state(botId), 'not-created');
	await assert.rejects(service.start(botId), /another owner/);
	assert.equal(
		driver.calls.some((args) => args[1] === 'rm'),
		false,
	);
	driver.resources.delete(`container:${name}`);
	await service.reconcileAll();
	assert.equal(service.state(botId), 'not-created');
	await service.start(botId);
	const engine = new EventEmitter();
	engine.availability = { available: true };
	const unfollow = service.follow(engine);
	t.after(unfollow);
	driver.resources.delete(`container:${name}`);
	const changed = once(service, 'changed');
	engine.emit('container-event', {});
	await changed;
	assert.equal(service.state(botId), 'not-created');
	engine.availability = { available: false };
	engine.emit('availability');
	assert.equal(service.state(botId), 'failed');
});

test('4.7 socket disabled by default, engine-side socket and gid for Docker/rootful/rootless Podman, changes apply on recreate', async (t) => {
	for (const options of [
		{ kind: 'docker', socket: '/var/run/docker.sock' },
		{ kind: 'podman', socket: '/run/podman/podman.sock' },
		{
			kind: 'podman',
			rootless: true,
			socket: '/run/user/501/podman/podman.sock',
		},
	])
		await t.test(JSON.stringify(options), async (t) => {
			const { service, driver } = setup(t, options);
			await service.start(botId);
			let create = driver.calls.find(
				(args) => args[1] === 'create' && args[0] === 'container',
			);
			assert.equal(create.includes('--group-add'), false);
			service.register({ id: botId, shareEngineSocket: true });
			assert.equal((await service.overview(botId)).socketChangePending, true);
			assert.equal((await service.overview(botId)).shareEngineSocket, false);
			await service.recreate(botId);
			create = driver.calls.findLast(
				(args) => args[1] === 'create' && args[0] === 'container',
			);
			assert.ok(
				create.includes(
					`type=bind,source=${options.socket},target=/var/run/docker.sock`,
				),
			);
			assert.equal(create[create.indexOf('--group-add') + 1], '999');
			const overview = await service.overview(botId);
			assert.equal(overview.socketChangePending, false);
			assert.equal(overview.shareEngineSocket, true);
			assert.equal(
				overview.socketWarning,
				options.rootless ? 'server-account' : 'root-equivalent',
			);
			assert.equal(create.includes('--userns'), Boolean(options.rootless));
			if (options.rootless)
				assert.ok(create.includes('keep-id:uid=501,gid=20'));
		});
});

test('4.8 idle deadlines arm once, cancel on each activity, honour never and never repeat', () => {
	const clock = fakeClock();
	let stopped = 0;
	const deadline = new BotIdleDeadline(() => stopped++, clock);
	const idle = {
		runningSessions: 0,
		queuedSessions: 0,
		shells: 0,
		desktops: 0,
	};
	deadline.update(true, idle);
	assert.equal([...clock.timers.values()][0].at, 1800000);
	for (const key of Object.keys(idle)) {
		deadline.update(true, { ...idle, [key]: 1 });
		assert.equal(clock.timers.size, 0);
		deadline.update(true, idle, 100);
		const timer = [...clock.timers.keys()][0];
		deadline.update(true, idle, 100);
		assert.equal([...clock.timers.keys()][0], timer);
		clock.tick(99);
		assert.equal(clock.timers.size, 1);
		clock.tick(1);
		assert.equal(clock.timers.size, 0);
	}
	assert.equal(stopped, 4);
	clock.tick(1000);
	assert.equal(stopped, 4);
	deadline.update(true, idle, null);
	assert.equal(clock.timers.size, 0);
	deadline.update(false, idle, 100);
	assert.equal(clock.timers.size, 0);
	deadline.close();
	const helper = new BotHelperIdleDeadline(() => stopped++, clock);
	const release1 = helper.acquire();
	const release2 = helper.acquire();
	release1();
	release1();
	assert.equal(clock.timers.size, 0);
	release2();
	assert.equal([...clock.timers.values()][0].at, clock.now + 300000);
	const release3 = helper.acquire();
	assert.equal(clock.timers.size, 0);
	release3();
	clock.tick(300000);
	assert.equal(stopped, 5);
	clock.tick(300000);
	assert.equal(stopped, 5);
	const never = new BotHelperIdleDeadline(() => stopped++, clock, null);
	never.acquire()();
	assert.equal(clock.timers.size, 0);
});

test('4.12 Overview reads figures on demand and Refresh rereads without creating timers, logs are bounded and redacted across chunks', async (t) => {
	const { service, driver, clock } = setup(t);
	await service.start(botId);
	const timersBefore = [...clock.timers.keys()];
	t.mock.method(globalThis, 'setTimeout', () => {
		throw new Error('Overview must not create timers');
	});
	const first = await service.overview(botId);
	const second = await service.overview(botId);
	assert.deepEqual([...clock.timers.keys()], timersBefore);
	assert.equal(driver.calls.filter((args) => args[0] === 'stats').length, 2);
	assert.equal(driver.calls.filter((args) => args[0] === 'run').length, 2);
	assert.equal(first.cpuPercent, 2.5);
	assert.equal(first.memoryBytes, 16 * 1024 ** 2);
	assert.equal(first.homeBytes, 123 * 1024);
	assert.equal(second.uptimeMs, 60000);
	assert.equal(Buffer.byteLength(second.log), 256 * 1024);
	assert.equal(second.log.includes('secret'), false);
	assert.ok(second.log.endsWith('key=[redacted]\n'));
	const log = new BotLogTail(['secret', 'secret-long'], 32);
	log.push('secret-long');
	log.push('secret');
	assert.equal(log.finish(), '[redacted][redacted]');
});

test('4.13 sibling list excludes bot and unlabelled containers; actions recheck label and removal confirmation', async (t) => {
	const { service, driver } = setup(t);
	await service.start(botId);
	const sibling = {
		Id: 'f'.repeat(64),
		Name: '/database',
		Config: { Image: 'postgres', Labels: { 'terminay.bot': botId } },
		State: { Status: 'exited' },
		NetworkSettings: { Ports: { '5432/tcp': [] } },
		Created: '2026-11-01',
	};
	driver.resources.set('container:database', sibling);
	driver.resources.set('container:other', {
		...sibling,
		Id: 'e'.repeat(64),
		Config: { Labels: { 'terminay.bot': 'other' } },
	});
	const list = await service.containers(botId);
	assert.equal(list.length, 1);
	assert.equal(list[0].name, 'database');
	assert.equal(list[0].image, 'postgres');
	assert.match(list[0].ports, /5432/);
	for (const action of ['start', 'stop', 'restart', 'logs'])
		await service.containerAction(botId, sibling.Id, action);
	await assert.rejects(
		service.containerAction(botId, sibling.Id, 'remove'),
		/confirmation/,
	);
	await assert.rejects(
		service.containerAction(botId, 'e'.repeat(64), 'start'),
		/does not belong/,
	);
	await assert.rejects(
		service.containerAction(
			botId,
			driver.resources.get(`container:${name}`).Id,
			'stop',
		),
		/does not belong/,
	);
	await service.containerAction(botId, sibling.Id, 'remove', true);
	assert.ok(
		driver.calls.some(
			(args) =>
				args[0] === 'container' &&
				args[1] === 'rm' &&
				args.at(-1) === sibling.Id,
		),
	);
});

test('environment protocol refuses unauthorized reads/writes and capability-bound callers', async (t) => {
	const { service } = setup(t);
	const registry = createBotEnvironmentOperations(service);
	for (const context of [
		{ authScope: 'read' },
		{ authScope: 'write', claims: { projectId: 'p' } },
		{ authScope: 'admin', claims: { capabilityId: 'token' } },
		{ authScope: 'write', clientId: 'system:mcp' },
	]) {
		const request = {
			envelope: { payload: { botId } },
			context: {
				clientId: 'client',
				signal: new AbortController().signal,
				...context,
			},
		};
		await assert.rejects(
			registry.queries['bots.environment.overview'](request),
			/authority/,
		);
		await assert.rejects(
			registry.commands['bots.environment.start'](request),
			/authority/,
		);
	}
});

test('4.3 recreate requires confirmation for active sessions; 4.8 helper teardown cannot rearm stale deadlines', async (t) => {
	const { service } = setup(t);
	await service.start(botId);
	service.setActivity(botId, {
		runningSessions: 1,
		queuedSessions: 0,
		shells: 0,
		desktops: 0,
	});
	await assert.rejects(service.recreate(botId), /confirmation/);
	assert.equal(service.state(botId), 'running');
	await service.recreate(botId, true);
	const clock = fakeClock();
	const helper = new BotHelperIdleDeadline(
		() => assert.fail('closed helper fired'),
		clock,
	);
	const release = helper.acquire();
	helper.close();
	release();
	assert.equal(clock.timers.size, 0);
	assert.throws(() => helper.acquire(), /closed/);
});

test('4.7 discovers socket gid inside the engine namespace using a bounded local helper', async (t) => {
	const { service, driver, hooks } = setup(t, {
		kind: 'podman',
		rootless: true,
		socket: '/run/user/501/podman/podman.sock',
	});
	hooks.socketGid = undefined;
	service.register({ id: botId, shareEngineSocket: true });
	await service.start(botId);
	const helper = driver.calls.find(
		(args) => args[0] === 'run' && args.includes('stat'),
	);
	assert.ok(
		helper.includes(
			'type=bind,source=/run/user/501/podman/podman.sock,target=/run/engine.sock,readonly',
		),
	);
	assert.ok(helper.includes('keep-id:uid=501,gid=20'));
	assert.ok(helper.includes('--rm'));
	assert.ok(helper.includes('--pids-limit'));
	assert.ok(helper.includes('never'));
	assert.ok(helper.includes('none'));
	const create = driver.calls.find(
		(args) => args[0] === 'container' && args[1] === 'create',
	);
	assert.equal(create[create.indexOf('--group-add') + 1], '999');
});
