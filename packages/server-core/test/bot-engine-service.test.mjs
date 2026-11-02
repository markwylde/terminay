import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
		new EngineProcess({ PATH: empty, HOME: empty }),
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
