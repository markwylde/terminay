import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createWorkerDisplay } from '../e2e/support/worker-display.mjs';
import { shardWorkerPolicy } from './support/e2e-worker-policy.mjs';
import { durationSnapshot } from './update-e2e-duration-snapshot.mjs';
import {
	HEAVY_TEST_WEIGHT,
	DEFAULT_TEST_DURATION_MS,
	timingKey,
	dealToShards,
	dealToWorkerShards,
	listedTests,
	shardTestLists,
	shardUnits,
	sharesSetup,
} from './support/e2e-shard-test-list.mjs';

/** A listing shaped like `playwright test --list --reporter=json`. */
function report(files) {
	return {
		suites: Object.entries(files).map(([file, titles]) => ({
			title: file,
			file,
			specs: titles
				.filter((title) => typeof title === 'string')
				.map((title) => ({ title, file })),
			suites: titles
				.filter((title) => typeof title !== 'string')
				.map(([suite, nested]) => ({
					title: suite,
					file,
					specs: nested.map((title) => ({ title, file })),
				})),
		})),
	};
}

test('tests of one file are dealt to different shards', () => {
	const listing = report({
		'slow.spec.ts': ['a', 'b', 'c', 'd'],
		'fast.spec.ts': ['e', 'f'],
	});
	assert.deepEqual(shardTestLists(listing, () => false, 3), [
		['slow.spec.ts › a', 'slow.spec.ts › d'],
		['slow.spec.ts › b', 'fast.spec.ts › e'],
		['slow.spec.ts › c', 'fast.spec.ts › f'],
	]);
});

test('a described test is listed by its whole title path', () => {
	const listing = report({ 'a.spec.ts': [['suite', ['one', 'two']]] });
	assert.deepEqual(listedTests(listing), [
		{ file: 'a.spec.ts', titles: ['suite', 'one'], weight: 1 },
		{ file: 'a.spec.ts', titles: ['suite', 'two'], weight: 1 },
	]);
	assert.deepEqual(shardTestLists(listing, () => false, 2), [
		['a.spec.ts › suite › one'],
		['a.spec.ts › suite › two'],
	]);
});

test('a spec that shares setup stays whole and counts for all its tests', () => {
	const listing = report({
		'shared.spec.ts': ['a', 'b', 'c'],
		'other.spec.ts': ['d', 'e', 'f'],
	});
	const units = shardUnits(listedTests(listing), (file) => file === 'shared.spec.ts');
	assert.deepEqual(
		units.map((unit) => [unit.line, unit.tests.length]),
		[
			['shared.spec.ts', 3],
			['other.spec.ts › d', 1],
			['other.spec.ts › e', 1],
			['other.spec.ts › f', 1],
		],
	);
	// The whole file fills the first shard, so the single tests go to the second.
	assert.deepEqual(
		dealToShards(units, 2).map((dealt) => dealt.map((unit) => unit.line)),
		[['shared.spec.ts'], ['other.spec.ts › d', 'other.spec.ts › e', 'other.spec.ts › f']],
	);
});

test('a heavy test fills its shard as several tests would', () => {
	const listing = report({ 'a.spec.ts': ['packages the app', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
	listing.suites[0].specs[0].tags = ['heavy'];
	assert.equal(listedTests(listing)[0].weight, HEAVY_TEST_WEIGHT);
	assert.equal(listedTests(listing)[1].weight, 1);
	// The first shard holds the heavy test alone until the second has caught up.
	assert.deepEqual(shardTestLists(listing, () => false, 2), [
		['a.spec.ts › packages the app', 'a.spec.ts › h'],
		['b', 'c', 'd', 'e', 'f', 'g'].map((title) => `a.spec.ts › ${title}`),
	]);
});

test('a title the list format cannot tell apart fails the split', () => {
	// A test and a suite of the same title: the test's line would also select
	// the suite's tests, which another shard was dealt.
	const listing = report({ 'a.spec.ts': ['same', ['same', ['inner']]] });
	assert.throws(() => shardTestLists(listing, () => false, 2), /would run in 2 shards/u);
});

test('setup shared across a spec is recognised from its source', () => {
	assert.equal(sharesSetup("test.beforeAll(async () => {})"), true);
	assert.equal(sharesSetup("test.describe.configure({ mode: 'default' })"), true);
	assert.equal(sharesSetup("test.describe.configure({ mode: 'serial' })"), true);
	assert.equal(sharesSetup("test.describe.serial('x', () => {})"), true);
	assert.equal(sharesSetup("test.beforeEach(async () => {})"), false);
	assert.equal(sharesSetup("test.describe.configure({ mode: 'parallel' })"), false);
});

test('the real suite splits so every shard has work and whole specs stay whole', async () => {
	// Titles are read from source, so this needs no Playwright and no build.
	const directory = new URL('../e2e/', import.meta.url);
	const files = {};
	for (const name of (await readdir(directory)).sort()) {
		if (!name.endsWith('.spec.ts')) continue;
		const source = await readFile(new URL(name, directory), 'utf8');
		files[name] = { source, count: (source.match(/^\s*test\(/gmu) ?? []).length };
	}
	const listing = report(
		Object.fromEntries(
			Object.entries(files).map(([name, { count }]) => [
				name,
				Array.from({ length: count }, (_, index) => `test ${index}`),
			]),
		),
	);
	const lists = shardTestLists(listing, (file) => sharesSetup(files[file].source), 18);
	assert.equal(lists.length, 18);
	for (const lines of lists) assert.ok(lines.length > 0, 'a shard was dealt nothing');
	const whole = lists.flat().filter((line) => !line.includes('›'));
	assert.ok(whole.includes('server-ui-sandbox.spec.ts'), 'the sandbox spec shares one application');
	assert.equal(new Set(whole).size, whole.length, 'a whole spec was dealt twice');
});


test('duration estimates use successful measurements and conservative fallback weights', () => {
	const listing = report({ 'a.spec.ts': ['measured', 'unknown', 'new heavy'] });
	listing.suites[0].specs[2].tags = ['@heavy'];
	const durations = { [JSON.stringify(['a.spec.ts', 'measured'])]: 1234 };
	assert.deepEqual(listedTests(listing, durations).map((test) => test.weight), [
		1234, DEFAULT_TEST_DURATION_MS, DEFAULT_TEST_DURATION_MS * HEAVY_TEST_WEIGHT,
	]);
});

test('longest-first measured assignment avoids a slow unit arriving after all shards fill', () => {
	const listing = report({ 'a.spec.ts': ['short a', 'short b', 'short c', 'long'] });
	const durations = Object.fromEntries(listedTests(listing).map((test, index) => [timingKey(test), [10, 10, 10, 30][index]]));
	const lists = shardTestLists(listing, () => false, 2, durations);
	assert.deepEqual(lists, [
		['a.spec.ts › long'],
		['a.spec.ts › short a', 'a.spec.ts › short b', 'a.spec.ts › short c'],
	]);
	assert.deepEqual(shardTestLists(listing, () => false, 2, durations), lists);
});

test('delimiter characters inside actual title components are diagnosed', () => {
	assert.throws(() => shardTestLists(report({ 'bots.spec.ts': [['Home › Bots', ['build']]] }), () => false, 2), /would run in 0 shards/u);
	assert.throws(() => shardTestLists(report({ 'connection.spec.ts': ['This device › Servers'] }), () => false, 2), /would run in 0 shards/u);
});

test('snapshot refresh records successful attempt medians, evidence hashes and repaired titles', () => {
	const listing = report({ 'bots.spec.ts': [['Home: Bots', ['build', 'unknown']]] });
	const snapshot = durationSnapshot(listing, [{
		name: 'job-123.log',
		content: [
			'2026-11-14Z   ✓  1 e2e/bots.spec.ts:1:1 › Home › Bots › build (2.0s)',
			'2026-11-14Z   ✓  1 e2e/bots.spec.ts:1:1 › Home › Bots › build @heavy (retry #1) (4.0s)',
			'2026-11-14Z   ✘  1 e2e/bots.spec.ts:1:1 › Home › Bots › build (30.0s)',
		].join('\n'),
	}], 'https://git.example/actions/runs/123');
	assert.deepEqual(snapshot.durations, { [JSON.stringify(['bots.spec.ts', 'Home: Bots', 'build'])]: 3000 });
	assert.equal(snapshot.source, 'https://git.example/actions/runs/123');
	assert.match(snapshot.inputs[0].sha256, /^[a-f0-9]{64}$/u);
	assert.throws(() => durationSnapshot(listing, [{ name: 'empty', content: '' }], 'source'), /no successful test durations/u);
});


test('ordinary shards use two isolated workers but native packaging stays exclusive', () => {
	assert.equal(shardWorkerPolicy(['bots.spec.ts › Home: Bots › build']).workers, 2);
	assert.equal(shardWorkerPolicy(['shared.spec.ts', 'ordinary.spec.ts › a'], 1).workers, 1);
	assert.deepEqual(shardWorkerPolicy(['canonical-runtime-executable-parity.spec.ts › parity', 'ordinary.spec.ts › a'], 2), {
		workers: 1, reason: 'native packaging requires exclusive access',
	});
	assert.equal(shardWorkerPolicy(['canonical-runtime-executable-parity.spec.ts'], 4).workers, 1);
	assert.throws(() => shardWorkerPolicy(['a.spec.ts'], 0), /positive integer/u);
});


test('measured shards start with the longest predicted wall time including exclusive packaging', () => {
	const listing = report({ 'first.spec.ts': ['a'], 'canonical-runtime-executable-parity.spec.ts': ['pack'], 'last.spec.ts': ['b', 'c'] });
	const durations = Object.fromEntries(listedTests(listing).map((test) => [timingKey(test), 10]));
	const lists = shardTestLists(listing, () => false, 2, durations);
	assert.ok(lists[0].includes('canonical-runtime-executable-parity.spec.ts › pack'));
	assert.equal(shardWorkerPolicy(lists[0]).workers, 1);
	assert.equal(shardWorkerPolicy(lists[1]).workers, 2);
});

test('shared beforeAll fixtures declare a serial file group for parallel worker pools', async () => {
	const directory = new URL('../e2e/', import.meta.url);
	for (const name of await readdir(directory)) {
		if (!name.endsWith('.spec.ts')) continue;
		const source = await readFile(new URL(name, directory), 'utf8');
		if (!/\btest\.beforeAll\(/u.test(source)) continue;
		assert.match(source, /describe\.configure\(\{\s*mode:\s*['"](?:default|serial)['"]/u, name);
	}
});


test('worker displays allocate independently and restore parent display on teardown', async () => {
	let next = 100;
	const servers = [];
	const spawnServer = (command, args) => {
		assert.equal(command, 'Xvfb');
		assert.ok(args.includes('-nolisten') && args.includes('tcp') && args.includes('-ac'));
		const server = new EventEmitter();
		server.stdio = [null, null, new PassThrough(), new PassThrough()];
		server.stderr = server.stdio[2];
		server.exitCode = null;
		server.kill = (signal) => { server.exitCode = 0; server.emit('exit', 0, signal); };
		const number = next++;
		queueMicrotask(() => server.stdio[3].write(`${number}\n`));
		servers.push(server);
		return server;
	};
	const first = { DISPLAY: ':99' };
	const second = {};
	const a = await createWorkerDisplay({ enabled: true, env: first, spawnServer });
	const b = await createWorkerDisplay({ enabled: true, env: second, spawnServer });
	assert.equal(first.DISPLAY, ':100');
	assert.equal(second.DISPLAY, ':101');
	await a.close(); await a.close(); await b.close();
	assert.equal(first.DISPLAY, ':99');
	assert.equal(second.DISPLAY, undefined);
	assert.ok(servers.every((server) => server.exitCode === 0));
});

test('failed worker display startup kills only its server and retains the parent environment', async () => {
	let killed;
	const env = { DISPLAY: ':99' };
	const spawnServer = () => {
		const server = new EventEmitter();
		server.stdio = [null, null, new PassThrough(), new PassThrough()];
		server.stderr = server.stdio[2];
		server.kill = (signal) => { killed = signal; };
		queueMicrotask(() => server.emit('error', new Error('Xvfb unavailable')));
		return server;
	};
	await assert.rejects(createWorkerDisplay({ enabled: true, env, spawnServer }), /Xvfb unavailable/u);
	assert.equal(killed, 'SIGKILL');
	assert.equal(env.DISPLAY, ':99');
});


test('all E2E test definitions share the worker display fixture before hooks run', async () => {
	const directory = new URL('../e2e/', import.meta.url);
	for (const name of await readdir(directory)) {
		if (!name.endsWith('.spec.ts')) continue;
		const source = await readFile(new URL(name, directory), 'utf8');
		assert.doesNotMatch(source, /import\s*\{[^}]*\btest(?:\s+as\s+\w+)?[^}]*\}\s*from\s*['"]@playwright\/test['"]/u, name);
	}
});


test('capacity-aware allocation gives the exclusive worker half the work of two-worker shards', () => {
	const unit = (line, weight) => ({ line, tests: [{ weight }] });
	const units = [unit('canonical-runtime-executable-parity.spec.ts › pack', 40), ...Array.from({ length: 8 }, (_, index) => unit(`ordinary.spec.ts › ${index}`, 20))];
	const shards = dealToWorkerShards(units, 2);
	const loads = shards.map((entries) => entries.flatMap((entry) => entry.tests).reduce((sum, test) => sum + test.weight, 0));
	assert.deepEqual(loads, [60, 140]);
	assert.equal(shardWorkerPolicy(shards[0].map((entry) => entry.line)).workers, 1);
	assert.equal(shardWorkerPolicy(shards[1].map((entry) => entry.line)).workers, 2);
	assert.equal(new Set(shards.flat()).size, units.length);
	assert.deepEqual(dealToWorkerShards(units, 2), shards);
	// An equal-work deal would give each 100 units and a 100-unit wall-time
	// tail; the capacity-aware plan finishes in max(60, 140/2) = 70.
	assert.equal(Math.max(loads[0], loads[1] / 2), 70);
});

test('multiple native units stay together and shared file units never split', () => {
	const a = { line: 'canonical-runtime-executable-parity.spec.ts › first', tests: [{ weight: 20 }] };
	const b = { line: 'canonical-runtime-executable-parity.spec.ts › second', tests: [{ weight: 30 }] };
	const shared = { line: 'shared.spec.ts', tests: [{ weight: 10 }, { weight: 10 }] };
	const shards = dealToWorkerShards([a, shared, b], 2);
	assert.deepEqual(shards[0], [a, b]);
	assert.deepEqual(shards[1], [shared]);
	assert.deepEqual(shards[1][0].tests, [{ weight: 10 }, { weight: 10 }]);
	assert.deepEqual(dealToWorkerShards([a, shared, b], 1), [[a, b, shared]]);
});
