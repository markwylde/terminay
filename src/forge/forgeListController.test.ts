import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
class ForgeSupersededError extends Error {
	constructor() {
		super('superseded');
		this.name = 'ForgeSupersededError';
	}
}
import { FORGE_FOCUS_REFRESH_MS, ForgeListController, type ForgeListState } from './forgeListController.ts';

type Request = { scope: string; fresh?: boolean; cursor?: string };

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const page = (numbers: number[], nextCursor?: string) => ({
	items: numbers.map((number) => ({
		sourceId: 's',
		item: {
			reference: { kind: 'pullRequest', origin: 'https://x', owner: 'o', name: 'r', number },
			title: `#${number}`,
			updatedAt: '2026-11-01T00:00:00Z',
		},
		worktrees: [],
	})),
	sources: [],
	...(nextCursor === undefined ? {} : { nextCursor }),
});

function harness(now = () => 0) {
	const calls: Array<{ request: Request; key: string; answer: ReturnType<typeof deferred<unknown>> }> = [];
	const states: ForgeListState[] = [];
	const controller = new ForgeListController<Request>(
		(request, key) => {
			const answer = deferred<unknown>();
			calls.push({ request, key, answer });
			return answer.promise;
		},
		'view',
		(state) => states.push(state),
		now,
	);
	return { controller, calls, states };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('nothing is asked while idle, however long it waits', async () => {
	mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
	try {
		const { controller, calls } = harness(() => Date.now());
		controller.setRequest({ scope: 'reviewRequested' });
		assert.equal(calls.length, 0, 'hidden: nothing asked');
		controller.setVisible(true);
		assert.equal(calls.length, 1, 'shown: asked once');
		calls[0]?.answer.resolve(page([1]));
		mock.timers.tick(60 * 60_000);
		assert.equal(calls.length, 1, 'an hour idle: no timer asked again');
	} finally {
		mock.timers.reset();
	}
});

test('a late answer for a replaced scope is ignored', async () => {
	const { controller, calls } = harness();
	controller.setVisible(true);
	controller.setRequest({ scope: 'reviewRequested' });
	controller.setRequest({ scope: 'authored' });
	assert.equal(calls.length, 2);
	calls[1]?.answer.resolve(page([2]));
	await flush();
	calls[0]?.answer.resolve(page([1]));
	await flush();
	assert.deepEqual(
		controller.current.items.map((entry) => entry.item.reference.number),
		[2],
	);
	// A superseded rejection says nothing either.
	controller.setRequest({ scope: 'involved' });
	controller.setRequest({ scope: 'all' });
	calls[2]?.answer.reject(new ForgeSupersededError());
	await flush();
	assert.equal(controller.current.error, undefined);
});

test('focus asks again only once the answer is a minute old', async () => {
	let clock = 1_000;
	const { controller, calls } = harness(() => clock);
	controller.setRequest({ scope: 'all' });
	controller.setVisible(true);
	calls[0]?.answer.resolve(page([1]));
	await flush();
	clock += FORGE_FOCUS_REFRESH_MS - 1;
	controller.focus();
	assert.equal(calls.length, 1);
	clock += 1;
	controller.focus();
	assert.equal(calls.length, 2);
});

test('a change while hidden is asked for when next shown, and Refresh is fresh', async () => {
	const { controller, calls } = harness();
	controller.setRequest({ scope: 'all' });
	controller.setVisible(true);
	calls[0]?.answer.resolve(page([1]));
	await flush();
	controller.setVisible(false);
	controller.changed();
	assert.equal(calls.length, 1);
	controller.setVisible(true);
	assert.equal(calls.length, 2);
	controller.setVisible(false);
	controller.setVisible(true);
	assert.equal(calls.length, 2, 'shown again with nothing changed: not asked');
	controller.refresh();
	assert.equal(calls[2]?.request.fresh, true);
});

test('Load more appends the next page', async () => {
	const { controller, calls } = harness();
	controller.setRequest({ scope: 'all' });
	controller.setVisible(true);
	calls[0]?.answer.resolve(page([1, 2], 'c1'));
	await flush();
	controller.loadMore();
	assert.equal(calls[1]?.request.cursor, 'c1');
	calls[1]?.answer.resolve(page([3]));
	await flush();
	assert.deepEqual(controller.current.items.map((entry) => entry.item.reference.number), [1, 2, 3]);
	assert.equal(controller.current.nextCursor, undefined);
});
