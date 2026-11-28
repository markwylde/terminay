import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildAcknowledgementsFor,
	createBuildAcknowledgements,
} from './buildAcknowledgements.ts';

const ready = {
	id: 'build-1',
	state: 'completed',
	acknowledged: false,
} as const;
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('dismissing hides at once and sends from the same call', () => {
	const store = createBuildAcknowledgements();
	const sent: string[] = [];
	let notified = 0;
	store.subscribe(() => notified++);
	store.acknowledge(ready.id, async (id) => {
		sent.push(id);
	});
	assert.equal(store.isHidden(ready.id), true);
	assert.deepEqual(sent, [ready.id]);
	assert.equal(notified, 1);
});

test('only one send is in flight, and a failure is resent on a later status', async () => {
	const store = createBuildAcknowledgements();
	let calls = 0;
	let fail: (error: Error) => void = () => {};
	const send = () => {
		calls++;
		return new Promise<void>((_, reject) => {
			fail = reject;
		});
	};
	store.acknowledge(ready.id, send);
	store.reconcile(ready, send);
	assert.equal(calls, 1);
	fail(new Error('offline'));
	await settle();
	// A failure alone retries nothing: only a new status does.
	assert.equal(calls, 1);
	assert.equal(store.isHidden(ready.id), true);
	store.reconcile(ready, send);
	assert.equal(calls, 2);
});

test('nothing is resent once recorded, for another state, or if never dismissed', async () => {
	const store = createBuildAcknowledgements();
	let calls = 0;
	const send = async () => {
		calls++;
	};
	store.reconcile(ready, send);
	assert.equal(calls, 0);
	store.acknowledge(ready.id, send);
	await settle();
	store.reconcile({ ...ready, acknowledged: true }, send);
	store.reconcile({ ...ready, state: 'running' }, send);
	assert.equal(calls, 1);
});

test('servers with the same retained build id hide and deliver independently', async () => {
	const a = buildAcknowledgementsFor('server-a');
	const b = buildAcknowledgementsFor('server-b');
	let finish: () => void = () => {};
	const sent: string[] = [];
	a.acknowledge(
		ready.id,
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
				sent.push('a');
			}),
	);
	assert.equal(buildAcknowledgementsFor('server-a'), a);
	assert.equal(a.isHidden(ready.id), true);
	assert.equal(b.isHidden(ready.id), false);
	b.acknowledge(ready.id, async () => {
		sent.push('b');
	});
	assert.deepEqual(sent, ['a', 'b']);
	finish();
	await settle();
});
