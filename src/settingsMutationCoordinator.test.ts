import assert from 'node:assert/strict';
import test from 'node:test';
import { SettingsMutationCoordinator } from './settingsMutationCoordinator.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, reject, resolve };
}

test('overlapping saves reconcile in order and only the latest is current', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const firstRead = deferred<string>();
	const order: string[] = [];
	const one = coordinator.run(
		async () => {
			order.push('one');
		},
		() => firstRead.promise,
	);
	const two = coordinator.run(
		async () => {
			order.push('two');
		},
		async () => 'two',
	);
	await Promise.resolve();
	assert.deepEqual(order, ['one']);
	firstRead.resolve('one');
	assert.equal((await one).current, false);
	assert.deepEqual(await two, {
		current: true,
		error: undefined,
		pending: 0,
		snapshot: 'two',
	});
	assert.deepEqual(order, ['one', 'two']);
});

test('a first failure does not block a succeeding save', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const first = coordinator.run(
		async () => {
			throw new Error('first');
		},
		async () => 'after-first',
	);
	const second = coordinator.run(
		async () => undefined,
		async () => 'after-second',
	);
	assert.equal((await first).current, false);
	assert.equal((await second).snapshot, 'after-second');
});

test('reset and save share one queue', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const resetRead = deferred<string>();
	const order: string[] = [];
	const reset = coordinator.run(
		async () => {
			order.push('reset');
		},
		() => resetRead.promise,
	);
	const save = coordinator.run(
		async () => {
			order.push('save');
		},
		async () => 'save',
	);
	await Promise.resolve();
	assert.deepEqual(order, ['reset']);
	resetRead.resolve('reset');
	await Promise.all([reset, save]);
	assert.deepEqual(order, ['reset', 'save']);
});

for (const direction of ['server', 'device'] as const) {
	test(`re-reads canonical state after a ${direction} partial commit failure`, async () => {
		const coordinator = new SettingsMutationCoordinator<string>();
		let canonical = 'before';
		const result = await coordinator.run(
			async () => {
				canonical = `${direction}-committed`;
				throw new Error(`${direction} peer failed`);
			},
			async () => canonical,
		);
		assert.equal(result.snapshot, `${direction}-committed`);
		assert.match(String(result.error), /peer failed/);
	});
}

test('a pending observed snapshot is replayed when authoritative read fails', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const gate = deferred<void>();
	const result = coordinator.run(
		() => gate.promise,
		async () => {
			throw new Error('offline');
		},
	);
	assert.equal(coordinator.observe('event-snapshot'), null);
	gate.resolve();
	assert.equal((await result).snapshot, 'event-snapshot');
	assert.equal(coordinator.isPending, false);
});

test('a pending observed snapshot takes precedence over an earlier successful read', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const read = deferred<string>();
	const result = coordinator.run(
		async () => undefined,
		() => read.promise,
	);
	read.resolve('sampled-before-event');
	coordinator.observe('event-after-sample');
	assert.equal((await result).snapshot, 'event-after-sample');
});

test('a deferred event consumed by an older transaction cannot overwrite a newer read', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const firstRead = deferred<string>();
	const first = coordinator.run(
		async () => undefined,
		() => firstRead.promise,
	);
	const second = coordinator.run(
		async () => undefined,
		async () => 'canonical-b',
	);
	coordinator.observe('event-a');
	firstRead.resolve('canonical-a');
	assert.equal((await first).snapshot, 'event-a');
	assert.equal((await second).snapshot, 'canonical-b');
});

test('a current failure retains error and drains pending state', async () => {
	const coordinator = new SettingsMutationCoordinator<string>();
	const operation = deferred<void>();
	const result = coordinator.run(
		() => operation.promise,
		async () => {
			throw new Error('read unavailable');
		},
	);
	operation.reject(new Error('not saved'));
	const outcome = await result;
	assert.equal(outcome.current, true);
	assert.equal(outcome.pending, 0);
	assert.equal(outcome.snapshot, null);
	assert.match(String(outcome.error), /not saved/);
});
