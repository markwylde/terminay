import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BotBuildTracker } from '../dist/botService/buildProgress.js';
import { BOT_ENGINE_OPERATIONS } from '@terminay/protocol';
import {
	BotEngine,
	BotEngineService,
	EngineProcess,
	engineSearchPath,
} from '../dist/botService/index.js';

/** A service whose engine CLIs cannot be found, with nothing pinned: the
 * state an app started from the Dock was in before its PATH was fixed. */
async function noEngine(t) {
	const empty = await mkdtemp(path.join(tmpdir(), 'bot-engine-service-'));
	const store = { load: async () => undefined, save: async () => {} };
	const engine = new BotEngine(
		store,
		new EngineProcess({
			PATH: empty,
			HOME: empty,
			DOCKER_HOST: `unix://${empty}/missing.sock`,
		}),
		'linux',
	);
	const service = new BotEngineService(engine, store, empty, () => [], 'srv');
	const published = [];
	service.on('changed', (event) => published.push(event));
	t.after(async () => {
		engine.close();
		await rm(empty, { recursive: true, force: true });
	});
	return { service, published };
}

test('reading status checks the engine but publishes nothing, so a watcher that rereads on change settles', async (t) => {
	const { service, published } = await noEngine(t);
	for (let i = 0; i < 10; i++) {
		const status = await service.status();
		assert.equal(status.available, false);
		assert.equal(status.reason, 'not-installed');
	}
	assert.equal(published.length, 0);
});

test('a check with no pin and no engine publishes one final reason, never an intermediate one', async (t) => {
	const { service, published } = await noEngine(t);
	await service.check();
	assert.equal(published.length, 1);
	assert.equal(service.engine.availability.reason, 'not-installed');
	// The same outcome again is not a change.
	await service.check();
	await service.check();
	assert.equal(published.length, 1);
});

test('a watcher rereading status on every change stops after the first change', async (t) => {
	const { service, published } = await noEngine(t);
	let reads = 0;
	service.on('changed', () => {
		reads++;
		void service.status();
	});
	await service.check();
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(published.length, 1);
	assert.equal(reads, 1);
});

test('the engine search path keeps the inherited order and adds where engines install', () => {
	const found = engineSearchPath(
		'/usr/bin:/bin:/usr/sbin:/sbin',
		'/Users/a',
		'darwin',
	).split(':');
	assert.deepEqual(found.slice(0, 4), [
		'/usr/bin',
		'/bin',
		'/usr/sbin',
		'/sbin',
	]);
	for (const dir of [
		'/opt/podman/bin',
		'/opt/homebrew/bin',
		'/usr/local/bin',
		'/Applications/Docker.app/Contents/Resources/bin',
		'/Users/a/bin',
		'/Users/a/.docker/bin',
	])
		assert.ok(found.includes(dir), dir);
	assert.equal(new Set(found).size, found.length);
	const linux = engineSearchPath('/custom', '/home/a', 'linux').split(':');
	assert.equal(linux[0], '/custom');
	assert.ok(!linux.includes('/Applications/Docker.app/Contents/Resources/bin'));
	assert.ok(engineSearchPath(undefined, undefined).includes('/opt/podman/bin'));
});

test('acknowledging a ready image needs bot authority and publishes one change', async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'bot-engine-acknowledge-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const directory = path.join(root, 'state');
	await mkdir(directory);
	const record = path.join(directory, 'build.json');
	const tracker = new BotBuildTracker(record);
	tracker.start('engine', 'fp', false);
	tracker.finish(true);
	const buildId = tracker.snapshot.id;
	const store = { load: async () => undefined, save: async () => {} };
	const engine = new BotEngine(
		store,
		new EngineProcess({ PATH: root }),
		'linux',
	);
	const service = new BotEngineService(
		engine,
		store,
		root,
		() => [],
		'srv',
		record,
	);
	t.after(() => engine.close());
	const published = [];
	service.on('changed', (event) => published.push(event));
	const { commands, queries, policies } = service.operations();
	const operation = BOT_ENGINE_OPERATIONS.acknowledge;
	const context = (extra = {}) => ({
		clientId: 'client',
		authScope: 'write',
		signal: new AbortController().signal,
		...extra,
	});
	const call = (payload, ctx = context()) =>
		commands[operation]({ context: ctx, envelope: { payload } });
	const acknowledged = () =>
		queries[BOT_ENGINE_OPERATIONS.progress]({ context: context() })
			.acknowledged;

	assert.deepEqual(policies[operation], { scope: 'write' });
	for (const refused of [
		context({ authScope: 'read' }),
		context({ clientId: 'system:mcp' }),
		context({ claims: { projectId: 'project' } }),
		context({ claims: { sessionId: 'session' } }),
		...[
			'capability',
			'capabilityId',
			'mcpPrincipal',
			'chatId',
			'botExecutionId',
			'mcp',
		].map((key) => context({ claims: { [key]: 'restricted' } })),
	])
		await assert.rejects(call({ buildId }, refused), /authority/);
	for (const payload of [
		null,
		{},
		{ buildId: 7 },
		{ buildId: 'x'.repeat(129) },
	])
		await assert.rejects(call(payload), /build id/);
	await call({ buildId: 'some-other-build' });
	assert.equal(acknowledged(), false);
	assert.equal(published.length, 0);
	// A failed durable save must neither acknowledge nor publish a change.
	await rm(directory, { recursive: true });
	await writeFile(directory, '');
	await assert.rejects(call({ buildId }));
	assert.equal(acknowledged(), false);
	assert.equal(published.length, 0);
	await rm(directory);
	await mkdir(directory);
	await call({ buildId });
	await call({ buildId });
	assert.equal(acknowledged(), true);
	assert.equal(published.length, 1);
});
