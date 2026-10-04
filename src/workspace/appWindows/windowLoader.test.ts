import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowLoader } from './windowLoader.ts';

function setup() {
	const published: [string[], boolean][] = [];
	let answer: () => Promise<readonly string[]> = async () => [];
	const loader = createWindowLoader<string>({
		list: () => answer(),
		publish: (windows, loaded) => published.push([[...windows], loaded]),
	});
	return { loader, published, answers: (next: () => Promise<readonly string[]>) => { answer = next; } };
}

test('a list that is read is published as loaded', async () => {
	const { loader, published, answers } = setup();
	answers(async () => ['a', 'b']);
	await loader.load();
	assert.deepEqual(published, [[['a', 'b'], true]]);
});

test('before a server has ever answered, a failure shows no windows and says nothing was loaded', async () => {
	const { loader, published, answers } = setup();
	answers(async () => { throw new Error('not yet'); });
	await loader.load();
	assert.deepEqual(published, [[[], false]]);
});

test('a failed fetch after a good one leaves the windows as they were', async () => {
	const { loader, published, answers } = setup();
	answers(async () => ['a', 'b']);
	await loader.load();
	// One hiccup must not tear down every running view.
	answers(async () => { throw new Error('transient'); });
	await loader.load();
	await loader.load();
	assert.deepEqual(published, [[['a', 'b'], true]]);
	// The next fetch that succeeds is what is shown.
	answers(async () => ['a']);
	await loader.load();
	assert.deepEqual(published.at(-1), [['a'], true]);
});

test('of two overlapping fetches only the later is published, and nothing after disposal', async () => {
	const { loader, published, answers } = setup();
	let finishFirst: (windows: readonly string[]) => void = () => {};
	answers(() => new Promise((resolve) => { finishFirst = resolve; }));
	const first = loader.load();
	answers(async () => ['newer']);
	await loader.load();
	finishFirst(['older']);
	await first;
	assert.deepEqual(published, [[['newer'], true]]);

	loader.dispose();
	answers(async () => ['after']);
	await loader.load();
	assert.equal(published.length, 1);
});
