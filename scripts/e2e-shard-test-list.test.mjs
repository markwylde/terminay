import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	HEAVY_TEST_WEIGHT,
	dealToShards,
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
